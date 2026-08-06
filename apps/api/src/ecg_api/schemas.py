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

from ecg_engine import AxisParams, EngineParams, NoiseParams, VariabilityParams
from pharmacology_engine import DrugAdministration


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


class AxisParamsPayload(BaseModel):
    orientation_deg: float = 50.0
    p_offset_deg: float = 3.4
    qrs_offset_deg: float = 0.0
    st_offset_deg: float = 0.0
    t_offset_deg: float = 0.0


class EngineParamsPayload(BaseModel):
    heart_rate_hz: float
    noise: NoiseParamsPayload = Field(default_factory=NoiseParamsPayload)
    variability: VariabilityParamsPayload = Field(
        default_factory=VariabilityParamsPayload
    )
    axis: AxisParamsPayload = Field(default_factory=AxisParamsPayload)

    def to_engine_params(self) -> EngineParams:
        return EngineParams(
            heart_rate_hz=self.heart_rate_hz,
            noise=NoiseParams(**self.noise.model_dump()),
            variability=VariabilityParams(**self.variability.model_dump()),
            axis=AxisParams(**self.axis.model_dump()),
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
        "axis": asdict(params.axis),
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


class AdministerMessage(BaseModel):
    """Administración de un fármaco (fase F).

    No lleva instante: se administra en el momento del reloj de simulación
    en que llega el mensaje. Dejar que el cliente eligiera el `t_s` abriría
    la puerta a administraciones en el pasado, que romperían la monotonía
    que el replay da por hecha.
    """

    type: Literal["administer"]
    drug_id: str
    dose: float
    route: str = "IV"
    operator: str | None = None
    notes: str | None = None


class PingMessage(BaseModel):
    """Reservado. Se reconoce pero no se despacha en fase 1: la versión del
    contrato queda lista para medir latencia sin romper clientes existentes
    cuando haga falta en fase 2."""

    type: Literal["ping"]


ClientMessage = Union[
    StartMessage, UpdateMessage, PauseMessage, ResumeMessage, StopMessage,
    AdministerMessage, PingMessage,
]

_MESSAGE_TYPES: dict[str, type[BaseModel]] = {
    "start": StartMessage,
    "update": UpdateMessage,
    "pause": PauseMessage,
    "resume": ResumeMessage,
    "stop": StopMessage,
    "administer": AdministerMessage,
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


def administered_message(*, administration: DrugAdministration) -> dict:
    return {"type": "administered", "administration": administration.as_dict()}


# --- REST: catálogo de fármacos ---------------------------------------------


class DrugSummary(BaseModel):
    drug_id: str
    display_name: str
    category: str
    routes: list[str]
    dose_unit: str
    reference_dose: float
    max_cumulative_dose: float
    onset_s: float
    peak_s: float
    duration_s: float


class DrugDetail(DrugSummary):
    half_life_s: float
    clinical_note: str
    references: list[str]
    effects: dict[str, float]


class InteractionSummary(BaseModel):
    """Las reglas declaradas, para que la interfaz pueda avisar **antes** de
    administrar. Es catálogo, no estado: no dice qué está pasando en una
    sesión sino qué puede pasar."""

    rule_id: str
    description: str
    clinical_note: str
    references: list[str]
    participants: list[dict]


# --- REST: sesiones ---------------------------------------------------------

import datetime as dt


class SessionSummary(BaseModel):
    id: uuid.UUID
    rhythm_id: str
    started_at: dt.datetime
    duration_s: float | None


class AdministrationRecord(BaseModel):
    id: uuid.UUID
    drug_id: str
    dose: float
    dose_unit: str
    route: str
    t_s: float
    operator: str | None
    notes: str | None


class SessionDetail(SessionSummary):
    params: dict
    seed: int
    engine_semver: str
    engine_commit: str
    ended_at: dt.datetime | None
    # El replay de una sesión medicada solo es fiel si coinciden semilla,
    # versión del motor de señal y versión del motor farmacológico: cambiar
    # una curva de concentración cambia el trazado sin cambiar ni una
    # administración.
    pharmacology_semver: str | None = None
    administrations: list[AdministrationRecord] = Field(default_factory=list)
