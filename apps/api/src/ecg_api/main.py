"""Punto de entrada de la API.

Un solo worker de uvicorn: el estado de simulación vive en memoria del
proceso que sostiene cada WebSocket, y varios workers romperían ese
binding. Es una restricción de despliegue documentada, no un accidente.
"""

from __future__ import annotations

from fastapi import FastAPI

from .config import get_settings
from .routers.health import router as health_router
from .routers.rhythms import router as rhythms_router

app = FastAPI(title="Simulador de ECG — API")
app.state.settings = get_settings()

app.include_router(health_router)
app.include_router(rhythms_router)
