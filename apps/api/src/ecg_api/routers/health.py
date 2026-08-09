"""Salud del servicio. Plano de control, sin dependencias externas."""

from __future__ import annotations

from fastapi import APIRouter, Request

import ecg_engine

router = APIRouter()


@router.get("/api/health")
def health(request: Request) -> dict[str, object]:
    """Estado del servicio.

    Responde `ok` aunque no haya base de datos, y lo dice en `persistence`. Es
    deliberado: el lanzador del escritorio espera a este endpoint para abrir la
    ventana, y devolver un error por no tener historial dejaría al usuario sin
    simulador por algo con lo que se puede simular perfectamente.
    """
    persistence_error = getattr(request.app.state, "persistence_error", None)
    return {
        "status": "ok",
        "engine_version": ecg_engine.__version__,
        "persistence": "unavailable" if persistence_error else "ok",
    }
