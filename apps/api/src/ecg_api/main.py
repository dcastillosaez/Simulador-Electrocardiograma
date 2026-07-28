"""Punto de entrada de la API.

Un solo worker de uvicorn: el estado de simulación vive en memoria del
proceso que sostiene cada WebSocket, y varios workers romperían ese
binding. Es una restricción de despliegue documentada, no un accidente.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from .config import get_settings
from .db.base import get_engine
from .db.seed import seed_catalog
from .routers.health import router as health_router
from .routers.rhythms import router as rhythms_router
from .routers.sessions import router as sessions_router
from .routers.simulation_ws import router as simulation_ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    engine = get_engine(settings.database_url)
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with app.state.session_factory() as session:
        await seed_catalog(session, settings)
    yield
    await engine.dispose()


app = FastAPI(title="Simulador de ECG — API", lifespan=lifespan)

app.include_router(health_router)
app.include_router(rhythms_router)
app.include_router(sessions_router)
app.include_router(simulation_ws_router)
