"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar.

Flujo de extremo a extremo, tal como lo vería un cliente real: conectar,
arrancar, comprobar los frames, cambiar la frecuencia en caliente, parar, y
confirmar que la sesión quedó escrita en la base de datos con lo que
realmente ocurrió.
"""

import asyncio
import json
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from ecg_api.db.models import SessionRow
from ecg_api.frames import decode_frame
from ecg_api.main import app


_MAX_CONTROL_MESSAGE_ATTEMPTS = 200  # ~4x los ~55 frames que maneja el test


def _receive_json_message(ws, expected_type: str) -> dict:
    """Lee mensajes hasta encontrar el JSON de control esperado.

    La tarea de streaming en segundo plano envía frames binarios de forma
    concurrente al bucle principal que responde a los mensajes de control:
    nada garantiza que el ack de `update` (o de `start`) llegue antes que un
    frame ya en cola. `WebSocketTestSession.receive()` expone el envoltorio
    ASGI crudo —type="websocket.send" para todo lo que envía el servidor,
    texto o binario— así que hay que mirar el contenido, no solo el tipo de
    evento, para distinguir un frame de un mensaje de control.

    `receive()` bloquea sin timeout (es una llamada síncrona sobre un
    `anyio.create_memory_object_stream`), así que sin este límite una
    regresión real en el servidor —justo lo que este test existe para
    atrapar— colgaría el test para siempre en vez de fallar.
    """
    for _ in range(_MAX_CONTROL_MESSAGE_ATTEMPTS):
        event = ws.receive()
        if event.get("type") == "websocket.send" and "text" in event:
            payload = json.loads(event["text"])
            if payload.get("type") == expected_type:
                return payload
    raise AssertionError(
        f"No llegó ningún mensaje de tipo {expected_type!r} en "
        f"{_MAX_CONTROL_MESSAGE_ATTEMPTS} intentos"
    )


def test_full_simulation_lifecycle_end_to_end(migrated_database):
    # `migrated_database` no se usa directamente: es session-scoped y
    # garantiza que el esquema existe antes de que `TestClient(app)`
    # dispare el `lifespan` y siembre el catálogo. Sin esta dependencia
    # explícita, pytest recoge los ficheros por orden alfabético y este
    # test —el único de la carpeta que no pide la fixture— se ejecutaría
    # antes que `test_migration.py`, fallando con "relation rhythms does
    # not exist" en vez de ejercitar el flujo que pretende probar.
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            # 1. Conectar y arrancar.
            ws.send_json(
                {
                    "type": "start",
                    "rhythm_id": "sinus_normal",
                    "seed": 20260725,
                    "params": {"heart_rate_hz": 60 / 60},
                }
            )
            started = _receive_json_message(ws, "started")
            session_id = started["session_id"]

            # 2. La cabecera de los frames es correcta y la secuencia
            #    monótona, sin huecos, en las primeras diez muestras.
            decoded_frames = [decode_frame(ws.receive_bytes()) for _ in range(10)]
            for frame in decoded_frames:
                assert frame.sample_rate_hz == 500
                assert frame.n_channels == 12
                assert frame.n_samples_per_channel == 50
                assert str(frame.session_id) == session_id
            sequence_numbers = [f.sequence_number for f in decoded_frames]
            assert sequence_numbers == list(range(10))

            # 3. `update` cambia la frecuencia, y el cambio es observable:
            #    el RR medio de los latidos que siguen se acorta. Se usa
            #    100 lpm, el extremo superior de editable_parameters para
            #    sinus_normal (60-100 lpm): 150 lpm queda fuera de rango
            #    clínico para este ritmo y el motor lo recortaría en
            #    silencio a 100, haciendo que esta aserción fallase contra
            #    un valor que el propio catálogo nunca deja aplicar.
            ws.send_json(
                {"type": "update", "params": {"heart_rate_hz": 100 / 60}}
            )
            updated = _receive_json_message(ws, "updated")
            assert updated["params"]["heart_rate_hz"] == 100 / 60

            # El renderer cachea eventos con `RENDER_MARGIN_S` (0,6 s) de
            # antelación sobre la ventana que pide cada trozo, así que los
            # primeros ~10 trozos tras `update` aún contienen algún latido
            # ya cacheado a la frecuencia vieja (comprobado con un script
            # de sonda: sin descartar, el periodo dominante medido es 0,958
            # en vez de 0,6; descartando 10 trozos cae limpio a 0,618).
            # Eso no es un defecto — el margen es necesario para que la T de
            # un latido anterior siga sumando en la ventana actual — así que
            # el test deja asentar la transición antes de medir.
            warmup_frames = [decode_frame(ws.receive_bytes()) for _ in range(10)]
            assert len(warmup_frames) == 10  # descartados a propósito

            # 35 trozos de medición (no 20): la persistencia solo se dispara
            # con >= 5,0 s simulados (`MIN_PERSISTABLE_DURATION_S`). Con 10
            # iniciales + 10 de calentamiento + 35 de medición son 55 trozos
            # de 0,1 s = 5,5 s, con margen sobre el umbral en vez de rozarlo.
            more_frames = [decode_frame(ws.receive_bytes()) for _ in range(35)]
            fast_signal = _concat_channel_ii(more_frames)
            assert _dominant_beat_period_s(fast_signal) < 60 / 100 * 1.5

            # 4. `stop` cierra la sesión con una duración positiva.
            ws.send_json({"type": "stop"})
            stopped = _receive_json_message(ws, "stopped")
            assert stopped["duration_s"] > 0.0

        # 5. La sesión quedó persistida con lo que realmente ocurrió: el
        #    ritmo, la semilla, y la duración total (no la frecuencia
        #    inicial, sino la vigente en el momento del `stop`).
        #
        #    No se reutiliza `app.state.session_factory`: sus conexiones
        #    están atadas al loop de asyncio que `TestClient` arranca en un
        #    hilo aparte para el `lifespan`. `asyncio.run()` aquí crea OTRO
        #    loop nuevo en el hilo del test, y asyncpg liga cada conexión al
        #    loop donde nació — usarla desde un loop distinto revienta con
        #    "attached to a different loop". Se abre una engine propia,
        #    igual que hace `db_session` en `conftest.py`.
        async def _fetch() -> SessionRow:
            engine = create_async_engine(migrated_database)
            try:
                session_factory = async_sessionmaker(engine, expire_on_commit=False)
                async with session_factory() as db:
                    return await db.get(SessionRow, uuid.UUID(session_id))
            finally:
                await engine.dispose()

        row = asyncio.run(_fetch())
        assert row is not None
        assert row.rhythm_id == "sinus_normal"
        assert row.seed == 20260725
        assert row.params["heart_rate_hz"] == 100 / 60
        assert float(row.duration_s) > 0.0


def _concat_channel_ii(frames) -> "list[float]":
    from ecg_engine.types import LEAD_ORDER

    lead_ii = LEAD_ORDER.index("II")
    signal: list[float] = []
    for frame in frames:
        signal.extend(frame.channels_v[lead_ii].tolist())
    return signal


def _dominant_beat_period_s(signal_v: "list[float]", sample_rate_hz: int = 500) -> float:
    """Periodo dominante por autocorrelación simple. No hace falta más
    precisión que la de distinguir 70 lpm (RR≈0,86 s) de 150 lpm (RR≈0,4 s)."""
    import numpy as np

    signal = np.asarray(signal_v) - np.mean(signal_v)
    autocorr = np.correlate(signal, signal, mode="full")[len(signal) - 1 :]
    min_lag = int(0.25 * sample_rate_hz)  # ritmos > 240 lpm quedan fuera de rango
    peak_lag = min_lag + int(np.argmax(autocorr[min_lag:]))
    return peak_lag / sample_rate_hz
