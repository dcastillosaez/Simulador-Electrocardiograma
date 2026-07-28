"""Esquemas Pydantic de la API: REST y WebSocket.

Este módulo crece con cada tarea del plan. Los esquemas REST del catálogo
van primero; los del WebSocket y las sesiones se añaden en tareas
posteriores.
"""

from __future__ import annotations

from pydantic import BaseModel


class ParameterRangePayload(BaseModel):
    minimum: float
    maximum: float
    default: float


class RhythmSummary(BaseModel):
    rhythm_id: str
    display_name: str
    category: str
    ventricular_rate_hz: float
    pr_is_measurable: bool


class RhythmDetail(RhythmSummary):
    default_parameters: dict[str, float]
    editable_parameters: dict[str, ParameterRangePayload]
    clinical_description: str
    references: tuple[str, ...]
    allowed_overlays: tuple[str, ...]
