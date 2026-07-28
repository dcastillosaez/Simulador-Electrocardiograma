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


# --- WebSocket: parámetros del motor --------------------------------------

import json
import uuid
from dataclasses import asdict
from typing import Literal, Union

from pydantic import Field, ValidationError

from ecg_engine import EngineParams, NoiseParams, VariabilityParams


class NoiseParamsPayload(BaseModel):
    emg_v: float = 0.0
    mains_v: float = 0.0
    baseline_v: float = 0.0
    motion_v: float = 0.0
    clip_v: float | None = None


class VariabilityParamsPayload(BaseModel):
    respiration_hz: float = 0.25
    rsa_fraction: float = 0.04
    amplitude_fraction: float = 0.03
    rr_jitter_fraction: float = 0.015


class EngineParamsPayload(BaseModel):
    heart_rate_hz: float
    noise: NoiseParamsPayload = Field(default_factory=NoiseParamsPayload)
    variability: VariabilityParamsPayload = Field(
        default_factory=VariabilityParamsPayload
    )

    def to_engine_params(self) -> EngineParams:
        return EngineParams(
            heart_rate_hz=self.heart_rate_hz,
            noise=NoiseParams(**self.noise.model_dump()),
            variability=VariabilityParams(**self.variability.model_dump()),
        )


def engine_params_to_dict(params: EngineParams) -> dict:
    """El sentido inverso de `to_engine_params`, para mensajes salientes y
    para la columna `params` de la sesión persistida. Sin Pydantic de por
    medio: `EngineParams` y sus dataclasses anidadas ya son inmutables y
    completas, no hace falta validarlas otra vez, solo volcarlas."""
    return {
        "heart_rate_hz": params.heart_rate_hz,
        "noise": asdict(params.noise),
        "variability": asdict(params.variability),
    }


# --- WebSocket: mensajes del cliente ---------------------------------------

class StartMessage(BaseModel):
    type: Literal["start"]
    rhythm_id: str
    params: EngineParamsPayload | None = None
    seed: int | None = None


class UpdateMessage(BaseModel):
    type: Literal["update"]
    params: EngineParamsPayload


class PauseMessage(BaseModel):
    type: Literal["pause"]


class ResumeMessage(BaseModel):
    type: Literal["resume"]


class StopMessage(BaseModel):
    type: Literal["stop"]


class PingMessage(BaseModel):
    """Reservado. Se reconoce pero no se despacha en fase 1: la versión del
    contrato queda lista para medir latencia sin romper clientes existentes
    cuando haga falta en fase 2."""

    type: Literal["ping"]


ClientMessage = Union[
    StartMessage, UpdateMessage, PauseMessage, ResumeMessage, StopMessage,
    PingMessage,
]

_MESSAGE_TYPES: dict[str, type[BaseModel]] = {
    "start": StartMessage,
    "update": UpdateMessage,
    "pause": PauseMessage,
    "resume": ResumeMessage,
    "stop": StopMessage,
    "ping": PingMessage,
}


class ClientMessageError(ValueError):
    """JSON inválido, tipo desconocido, o el cuerpo no valida contra su
    esquema. El llamante la traduce a `error {code: "INVALID_PARAMS"}`."""


def parse_client_message(raw: str) -> ClientMessage:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ClientMessageError(f"JSON inválido: {exc}") from exc
    if not isinstance(payload, dict) or "type" not in payload:
        raise ClientMessageError("falta el campo 'type'")
    model = _MESSAGE_TYPES.get(payload["type"])
    if model is None:
        raise ClientMessageError(
            f"tipo de mensaje desconocido: {payload['type']!r}"
        )
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise ClientMessageError(str(exc)) from exc


# --- WebSocket: mensajes del servidor ---------------------------------------

def started_message(
    *, session_id: uuid.UUID, seed: int, sample_rate_hz: int, channels: int
) -> dict:
    return {
        "type": "started",
        "session_id": str(session_id),
        "seed": seed,
        "sample_rate_hz": sample_rate_hz,
        "channels": channels,
    }


def updated_message(*, params: EngineParams) -> dict:
    return {"type": "updated", "params": engine_params_to_dict(params)}


def paused_message() -> dict:
    return {"type": "paused"}


def resumed_message() -> dict:
    return {"type": "resumed"}


def stopped_message(*, duration_s: float) -> dict:
    return {"type": "stopped", "duration_s": duration_s}


def error_message(*, code: str, detail: str) -> dict:
    return {"type": "error", "code": code, "detail": detail}
