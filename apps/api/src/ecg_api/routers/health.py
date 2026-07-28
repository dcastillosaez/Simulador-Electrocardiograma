"""Salud del servicio. Plano de control, sin dependencias externas."""

from __future__ import annotations

from fastapi import APIRouter

import ecg_engine

router = APIRouter()


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine_version": ecg_engine.__version__}
