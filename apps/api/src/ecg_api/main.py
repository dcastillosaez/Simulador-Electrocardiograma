"""Punto de entrada de la API.

Un solo worker de uvicorn: el estado de simulación vive en memoria del
proceso que sostiene cada WebSocket, y varios workers romperían ese
binding. Es una restricción de despliegue documentada, no un accidente.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import async_sessionmaker

from .config import get_settings
from .db.base import get_engine
from .db.seed import seed_catalog
from .desktop_auth import DesktopTokenMiddleware
from .limits import ConnectionLimiter
from .routers.drugs import router as drugs_router
from .routers.health import router as health_router
from .routers.patients import router as patients_router
from .routers.rhythms import router as rhythms_router
from .routers.sessions import router as sessions_router
from .routers.simulation_ws import router as simulation_ws_router
from .security_headers import SecurityHeadersMiddleware

logger = logging.getLogger("ecg_api.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    # El aforo vive en el estado de la app y no en un global del módulo: es
    # estado por proceso, como los propios sockets que cuenta, y así los tests
    # arrancan cada `TestClient` con el contador a cero.
    app.state.limiter = ConnectionLimiter(
        max_total=settings.max_ws_connections,
        max_per_client=settings.max_ws_connections_per_client,
    )
    # La base de datos NO es un requisito para simular.
    #
    # El catálogo de ritmos sale del motor (`routers/rhythms.py` importa
    # `list_rhythms` de `ecg_engine`), y la tabla `rhythms` solo ancla la clave
    # foránea de `sessions`. Es decir: la persistencia guarda historial y nada
    # más. Simular, medir, administrar fármacos y exportar no la tocan.
    #
    # Antes, un fallo aquí tumbaba el arranque entero: sin base de datos no
    # había simulador. En un servidor eso casi da igual —alguien mira el log y
    # levanta Postgres—, pero en el escritorio de alguien que va a dar clase en
    # cinco minutos, la diferencia entre «no se guardará el historial» y «no
    # arranca» es toda la diferencia que hay.
    engine = get_engine(settings.database_url)
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    app.state.persistence_error = None
    try:
        async with app.state.session_factory() as session:
            await seed_catalog(session, settings)
    except Exception as exc:  # noqa: BLE001 — cualquier fallo de la base
        app.state.persistence_error = str(exc)
        app.state.session_factory = None
        logger.error(
            "sin persistencia: el historial de sesiones no estará disponible",
            exc_info=True,
        )
    yield
    await engine.dispose()


app = FastAPI(title="Simulador de ECG — API", lifespan=lifespan)

# El WebSocket no pasa por CORSMiddleware — Starlette solo lo aplica a
# peticiones HTTP normales, y los navegadores no bloquean conexiones WS
# entre orígenes distintos por CORS (solo por la cabecera Origin, que el
# servidor tendría que comprobar él mismo si quisiera restringirlo). Esto
# cubre las rutas REST: catálogo, sesiones, salud.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    # La lista es explícita y no `*`. Hasta la biblioteca de pacientes, la API
    # REST era de solo lectura y bastaba `GET`; los tres métodos nuevos son
    # exactamente los que necesita `/api/patients` —crear, editar y borrar
    # casos— y ninguno más. Un comodín aquí abriría también los que no
    # existen todavía.
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Solo hace algo cuando hay `DESKTOP_TOKEN`: en servidor se queda mirando pasar
# las peticiones. Ver `desktop_auth.py`.
app.add_middleware(DesktopTokenMiddleware)

# El WebSocket sí comprueba el origen, pero lo hace en su propio handler
# (`simulation_ws`): el handshake no pasa por los middlewares de HTTP.
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(health_router)
app.include_router(rhythms_router)
app.include_router(drugs_router)
app.include_router(sessions_router)
app.include_router(patients_router)
app.include_router(simulation_ws_router)
