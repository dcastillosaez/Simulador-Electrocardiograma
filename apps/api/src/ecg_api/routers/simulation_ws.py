"""WS /ws/simulation — la ruta caliente.

Controla el ciclo de vida completo de una simulación: recibe mensajes de
control en JSON, produce chunks en tareas de fondo, y los envía en binario
a través de una cola con descarte de lo más antiguo. Persiste la sesión
exactamente una vez, al cerrarse — nunca durante el streaming.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import uuid

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ecg_engine.types import DEFAULT_SAMPLE_RATE_HZ

from ..errors import SimulationError
from ..limits import client_key
from ..outbox import FrameOutbox
from ..persistence import persist_session, should_persist
from ..schemas import (
    AdministerMessage,
    ClientMessageError,
    PauseMessage,
    PingMessage,
    ResumeMessage,
    StartMessage,
    StopMessage,
    UpdateMessage,
    administered_message,
    error_message,
    parse_client_message,
    paused_message,
    resumed_message,
    started_message,
    stopped_message,
    updated_message,
)
from ..simulation import SimulationManager
from ..streaming import stream_chunks, stream_measurements, stream_pharmacology

router = APIRouter()
logger = logging.getLogger("ecg_api.simulation_ws")

OUTBOX_MAXSIZE = 20

# La frecuencia de muestreo no es una opción de configuración: es
# `DEFAULT_SAMPLE_RATE_HZ` del motor, la misma constante que `EcgEngine` usa
# quien no le pase `sample_rate_hz` explícito. Convertirla en un valor de
# `Settings` independiente habría creado dos fuentes de verdad que podían
# desincronizarse — el servidor anunciando en `started` y en cada cabecera
# de frame una frecuencia distinta de la que el motor realmente genera.


async def _sender_loop(websocket: WebSocket, outbox: FrameOutbox) -> None:
    while True:
        frame = await outbox.get()
        await websocket.send_bytes(frame)


def _log_engine_failure(manager: SimulationManager, exc: BaseException) -> str:
    """Registra el fallo y devuelve la referencia que se le da al cliente.

    El cliente recibe la referencia y nada más. El texto de la excepción
    —`str(exc)`, que es lo que se enviaba antes— describe la estructura interna:
    un error de asyncpg o de SQLAlchemy cuenta el esquema de la base de datos a
    quien no debería conocerlo. Con la referencia, quien reporta el fallo y
    quien lee el log siguen hablando del mismo suceso.
    """
    reference = uuid.uuid4().hex[:12]
    logger.error(
        "fallo del motor: ref=%s session_id=%s seed=%s",
        reference,
        manager.session_id,
        manager.seed if manager.session_id else None,
        exc_info=exc,
    )
    return reference


def _engine_failure_detail(reference: str) -> str:
    return f"fallo interno del simulador (referencia {reference})"


async def _close_after_engine_failure(websocket: WebSocket, detail: str) -> None:
    # Acotado a 5 s: sin `fail_after`, un cliente que dejó de leer bloquea
    # `send_json`/`close` en el drenaje del transporte para siempre, el
    # mismo defecto que `_maybe_persist` (tarea 14) ya tuvo que corregir.
    with anyio.move_on_after(5.0):
        try:
            await websocket.send_json(
                error_message(code="ENGINE_FAILURE", detail=detail)
            )
        except Exception:  # noqa: BLE001 — el socket puede estar ya cerrado
            pass
        try:
            await websocket.close(code=1011)
        except Exception:  # noqa: BLE001
            pass


def _on_background_task_done(
    task: asyncio.Task,
    *,
    websocket: WebSocket,
    manager: SimulationManager,
    close_tasks: set[asyncio.Task],
) -> None:
    """Un fallo del motor durante el streaming corre en una tarea de fondo,
    no en el bucle que despacha mensajes. Sin este enganche, el cliente se
    quedaría sin datos y sin ningún `error` que lo explique."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    reference = _log_engine_failure(manager, exc)
    # Se guarda la referencia en `close_tasks` (y se espera en el `finally`
    # del handler): una tarea de `asyncio.create_task` sin referencia fuerte
    # es candidata a recolección de basura a mitad de ejecución, así que el
    # cierre 1011 que exige la especificación podía simplemente no llegar a
    # ocurrir.
    close_task = asyncio.create_task(
        _close_after_engine_failure(websocket, _engine_failure_detail(reference))
    )
    close_tasks.add(close_task)
    close_task.add_done_callback(close_tasks.discard)


async def _stop_background_tasks(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _reject_if_no_active_session(
    websocket: WebSocket, manager: SimulationManager
) -> bool:
    """True si ya se envió un error y el mensaje debe descartarse."""
    if manager.session_id is not None:
        return False
    await websocket.send_json(
        error_message(
            code="INVALID_PARAMS",
            detail="no hay ninguna simulación activa; envía 'start' primero",
        )
    )
    return True


def _origin_is_allowed(origin: str | None, allowed: list[str]) -> bool:
    """Si el handshake viene de una página web, de cuál.

    CORS no cubre el WebSocket: Starlette solo lo aplica a peticiones HTTP
    normales, y el navegador tampoco bloquea por su cuenta una conexión WS
    entre orígenes distintos. Sin esta comprobación, cualquier web que un
    alumno tenga abierta puede conectarse al servidor del aula y ocupar plazas
    —y el día que haya cookie de sesión, hacerlo *con la sesión de quien la
    visita*, que es el cross-site WebSocket hijacking de manual—.

    Sin cabecera `Origin` se acepta: eso es un cliente que no es un navegador
    (un test, un script, un simulador de laboratorio), y el ataque que esto
    previene solo existe dentro de un navegador, que siempre la envía. Cerrar
    aquí no añadiría seguridad y rompería a todos los clientes legítimos que no
    son páginas web.
    """
    if origin is None:
        return True
    return origin in allowed


@router.websocket("/ws/simulation")
async def simulation_ws(websocket: WebSocket) -> None:
    settings = websocket.app.state.settings
    session_factory = websocket.app.state.session_factory
    limiter = websocket.app.state.limiter

    origin = websocket.headers.get("origin")
    if not _origin_is_allowed(origin, settings.cors_origins_list):
        logger.warning("handshake rechazado por origen: origin=%s", origin)
        await websocket.close(code=1008, reason="origen no permitido")
        return

    client = client_key(
        websocket.client.host if websocket.client else None,
        websocket.headers.get("x-forwarded-for"),
        settings.trust_proxy,
    )
    # El aforo se mira ANTES de aceptar. Cerrar sin aceptar rechaza el
    # handshake, así que la conexión no llega a existir: no hay tareas de
    # fondo que parar ni motor que arrancar, que es justo lo que se quiere
    # evitar cuando el servidor está lleno.
    if not limiter.try_acquire(client):
        logger.warning("conexión rechazada por aforo: client=%s", client)
        await websocket.close(code=1013, reason="servidor al completo")
        return

    try:
        await _run_session(websocket, settings, session_factory)
    finally:
        limiter.release(client)


async def _run_session(websocket: WebSocket, settings, session_factory) -> None:
    await websocket.accept()

    manager = SimulationManager()
    outbox = FrameOutbox(maxsize=OUTBOX_MAXSIZE)
    background_tasks: list[asyncio.Task] = []
    close_tasks: set[asyncio.Task] = set()
    persisted = False

    async def _maybe_persist() -> None:
        nonlocal persisted
        if persisted or not should_persist(manager):
            return
        # `shield=True`: si el cliente cierra el socket justo tras enviar
        # `stop` sin esperar el `stopped` de vuelta (como hacen los tests de
        # REST que solo comprueban la sesión ya persistida), Starlette
        # cancela esta corrutina al desconectar. Sin blindar la escritura,
        # esa cancelación puede llegar a mitad de `session.commit()` y la
        # sesión —que ya cumplió el umbral de 5 s— se pierde en silencio.
        # El shield bloquea a propósito la única vía de escape (la
        # cancelación del cliente), así que si la conexión a la base de
        # datos está realmente muerta, `commit()` colgaría para siempre sin
        # el `fail_after`: mejor fallar en 5 s que no fallar nunca.
        try:
            with anyio.CancelScope(shield=True):
                with anyio.fail_after(5.0):
                    async with session_factory() as db:
                        await persist_session(db, manager, settings)
        except Exception:  # noqa: BLE001 — cualquier fallo de persistencia,
            # no solo el timeout: `_maybe_persist()` se llama tanto al
            # recibir `stop` como, otra vez, en el `finally` de
            # `simulation_ws()`. Si no marcamos `persisted` aquí ante CUALQUIER
            # fallo (timeout, conexión caída, error de Postgres), el `finally`
            # reintentaría contra la misma conexión rota y dejaría escapar un
            # segundo error sin capturar, tumbando el handler del WebSocket en
            # vez de cerrarlo con gracia.
            logger.error(
                "No se pudo persistir la sesión %s: se descarta sin reintentar",
                manager.session_id,
                exc_info=True,
            )
        persisted = True

    try:
        while True:
            # Mientras no haya simulación, la espera está acotada. Una pestaña
            # que se abrió y se olvidó retiene su plaza del aforo
            # indefinidamente, y son cinco por máquina: bastan cinco descuidos
            # para no poder entrar desde ese equipo. El plazo solo corre antes
            # del primer `start` —una simulación en marcha puede pasar horas
            # sin que el cliente diga nada, y eso es uso normal— y va holgado,
            # porque abrir la aplicación y tardar en elegir ritmo también lo es.
            if manager.session_id is None:
                try:
                    with anyio.fail_after(settings.idle_start_timeout_s):
                        raw = await websocket.receive_text()
                except TimeoutError:
                    logger.info("conexión cerrada por inactividad sin 'start'")
                    await websocket.close(
                        code=1000, reason="sin actividad: cierre por inactividad"
                    )
                    return
            else:
                raw = await websocket.receive_text()

            # El tamaño se mira antes de parsear: un JSON de megabytes cuesta
            # más en el parser que en la red, y ese es justo el trabajo que un
            # cliente abusivo quiere que el servidor haga.
            if len(raw) > settings.max_ws_message_bytes:
                await websocket.send_json(
                    error_message(
                        code="INVALID_PARAMS",
                        detail=(
                            "mensaje demasiado largo "
                            f"(máximo {settings.max_ws_message_bytes} bytes)"
                        ),
                    )
                )
                continue

            try:
                message = parse_client_message(raw)
            except ClientMessageError as exc:
                await websocket.send_json(
                    error_message(code="INVALID_PARAMS", detail=str(exc))
                )
                continue

            if isinstance(message, StartMessage):
                if manager.session_id is not None:
                    # Un `start` sobre un socket con una sesión ya activa
                    # reemplaza esa sesión. Sin este bloque, el par de tareas
                    # de fondo anterior queda huérfano (duplicando la
                    # cadencia de chunks que llegan al mismo `outbox`,
                    # renderizándose al doble de la frecuencia real) y la
                    # sesión saliente, aunque cumpliera el umbral de
                    # persistencia, se pierde en silencio en cuanto
                    # `manager.start` reinicie el motor y sobrescriba
                    # `session_id`. Se para, se persiste si corresponde, y
                    # se libera `persisted` para el ciclo de vida de la
                    # sesión nueva.
                    await _stop_background_tasks(background_tasks)
                    background_tasks = []
                    outbox.clear()
                    await _maybe_persist()
                    persisted = False

                try:
                    session_id = manager.start(
                        message.rhythm_id,
                        message.params.to_engine_params()
                        if message.params
                        else None,
                        message.seed,
                    )
                except SimulationError as exc:
                    await websocket.send_json(
                        error_message(code=exc.code, detail=str(exc))
                    )
                    continue
                await websocket.send_json(
                    started_message(
                        session_id=session_id,
                        seed=manager.seed,
                        sample_rate_hz=DEFAULT_SAMPLE_RATE_HZ,
                        channels=12,
                    )
                )
                producer_task = asyncio.create_task(
                    stream_chunks(manager, outbox, DEFAULT_SAMPLE_RATE_HZ)
                )
                sender_task = asyncio.create_task(_sender_loop(websocket, outbox))
                # Las medidas salen por JSON y no por el outbox binario: son
                # un canal aparte, a una cadencia diez veces mas lenta, y
                # mezclarlas con los frames obligaria a versionar el formato
                # binario cada vez que se anada una metrica nueva.
                measurements_task = asyncio.create_task(
                    stream_measurements(manager, websocket.send_json)
                )
                pharmacology_task = asyncio.create_task(
                    stream_pharmacology(manager, websocket.send_json)
                )
                for task in (
                    producer_task,
                    sender_task,
                    measurements_task,
                    pharmacology_task,
                ):
                    task.add_done_callback(
                        functools.partial(
                            _on_background_task_done,
                            websocket=websocket,
                            manager=manager,
                            close_tasks=close_tasks,
                        )
                    )
                background_tasks = [
                    producer_task,
                    sender_task,
                    measurements_task,
                    pharmacology_task,
                ]

            elif isinstance(message, UpdateMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                applied = manager.update(message.params.to_engine_params())
                await websocket.send_json(updated_message(params=applied))

            elif isinstance(message, AdministerMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                try:
                    administration = manager.administer(
                        message.drug_id,
                        message.dose,
                        message.route,
                        operator=message.operator,
                        notes=message.notes,
                    )
                except SimulationError as exc:
                    await websocket.send_json(
                        error_message(code=exc.code, detail=str(exc))
                    )
                    continue
                await websocket.send_json(
                    administered_message(administration=administration)
                )
                # Y el estado farmacológico completo de inmediato, sin
                # esperar al siguiente tic del bucle de 1 Hz: el usuario
                # acaba de pulsar «administrar» y la lista de fármacos
                # activos tiene que responder al gesto, no un segundo
                # después.
                payload = manager.pharmacology_payload()
                if payload is not None:
                    await websocket.send_json(payload)

            elif isinstance(message, PauseMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                manager.pause()
                await websocket.send_json(paused_message())

            elif isinstance(message, ResumeMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                manager.resume()
                await websocket.send_json(resumed_message())

            elif isinstance(message, StopMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                duration_s = manager.stop()
                await _stop_background_tasks(background_tasks)
                await websocket.send_json(stopped_message(duration_s=duration_s))
                await _maybe_persist()
                return

            elif isinstance(message, PingMessage):
                continue  # reservado: se reconoce, no se despacha en fase 1

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — cualquier fallo no anticipado en
        # el bucle principal se trata como ENGINE_FAILURE: el catálogo de
        # códigos de la spec no distingue más granularidad, y cerrar la
        # conexión es lo seguro cuando no se sabe en qué estado quedó la
        # sesión.
        reference = _log_engine_failure(manager, exc)
        await _close_after_engine_failure(websocket, _engine_failure_detail(reference))
    finally:
        await _stop_background_tasks(background_tasks)
        await _maybe_persist()
        if close_tasks:
            await asyncio.gather(*close_tasks, return_exceptions=True)
