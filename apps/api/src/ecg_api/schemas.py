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

from pydantic import ConfigDict, Field, ValidationError

from ecg_engine import AxisParams, EngineParams, NoiseParams, VariabilityParams
from pharmacology_engine import DrugAdministration


class FinitePayload(BaseModel):
    """Base de todo lo que llega del cliente con números dentro.

    `allow_inf_nan=False` no es celo: `json.loads` acepta los literales `NaN`,
    `Infinity` y `-Infinity`, Pydantic los admite en un `float` por defecto, y
    el `clamp` del catálogo los deja pasar enteros —toda comparación con NaN es
    falsa, así que `min(max(nan, x), y)` devuelve `nan`—. Es decir, el clamp
    protege de una frecuencia de mil millones pero no de un NaN, que se
    propagaría a la señal, donde no significa nada.
    """

    model_config = ConfigDict(allow_inf_nan=False)


# Techos, no valores clínicos. El rango bueno de cada ritmo lo impone el
# catálogo del motor, que sigue clampando después; esto solo descarta lo que no
# es una señal: negativos donde no caben, y magnitudes que ningún ECG produce.
MAX_HEART_RATE_HZ = 20.0  # 1200 lpm
MAX_NOISE_V = 0.05  # diez veces la amplitud de una R grande
MAX_DEG = 360.0
# Identificadores y texto libre. Sin tope, un cliente escribe megabytes en la
# base de datos y nadie se lo impide.
MAX_ID_LEN = 64
MAX_ROUTE_LEN = 16
MAX_OPERATOR_LEN = 80
MAX_NOTES_LEN = 500


class NoiseParamsPayload(FinitePayload):
    emg_v: float = Field(default=0.0, ge=0.0, le=MAX_NOISE_V)
    mains_v: float = Field(default=0.0, ge=0.0, le=MAX_NOISE_V)
    baseline_v: float = Field(default=0.0, ge=0.0, le=MAX_NOISE_V)
    motion_v: float = Field(default=0.0, ge=0.0, le=MAX_NOISE_V)
    clip_v: float | None = Field(default=None, gt=0.0, le=MAX_NOISE_V)


class VariabilityParamsPayload(FinitePayload):
    respiration_hz: float = Field(default=0.25, ge=0.0, le=MAX_HEART_RATE_HZ)
    rsa_fraction: float = Field(default=0.04, ge=0.0, le=1.0)
    amplitude_fraction: float = Field(default=0.03, ge=0.0, le=1.0)
    rr_jitter_fraction: float = Field(default=0.015, ge=0.0, le=1.0)


class AxisParamsPayload(FinitePayload):
    orientation_deg: float = Field(default=50.0, ge=-MAX_DEG, le=MAX_DEG)
    p_offset_deg: float = Field(default=3.4, ge=-MAX_DEG, le=MAX_DEG)
    qrs_offset_deg: float = Field(default=0.0, ge=-MAX_DEG, le=MAX_DEG)
    st_offset_deg: float = Field(default=0.0, ge=-MAX_DEG, le=MAX_DEG)
    t_offset_deg: float = Field(default=0.0, ge=-MAX_DEG, le=MAX_DEG)


class EngineParamsPayload(FinitePayload):
    heart_rate_hz: float = Field(gt=0.0, le=MAX_HEART_RATE_HZ)
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

class StartMessage(FinitePayload):
    type: Literal["start"]
    rhythm_id: str = Field(max_length=MAX_ID_LEN)
    params: EngineParamsPayload | None = None
    # La misma cota con la que el servidor sortea uno cuando el cliente no lo
    # manda (`_SEED_UPPER_BOUND` en simulation.py): un seed fuera de rango no
    # reproduce nada, que es lo único para lo que sirve un seed.
    seed: int | None = Field(default=None, ge=0, lt=2**31)


class UpdateMessage(FinitePayload):
    type: Literal["update"]
    params: EngineParamsPayload


class PauseMessage(BaseModel):
    type: Literal["pause"]


class ResumeMessage(BaseModel):
    type: Literal["resume"]


class StopMessage(BaseModel):
    type: Literal["stop"]


class AdministerMessage(FinitePayload):
    """Administración de un fármaco (fase F).

    No lleva instante: se administra en el momento del reloj de simulación
    en que llega el mensaje. Dejar que el cliente eligiera el `t_s` abriría
    la puerta a administraciones en el pasado, que romperían la monotonía
    que el replay da por hecha.
    """

    type: Literal["administer"]
    drug_id: str = Field(max_length=MAX_ID_LEN)
    dose: float = Field(gt=0.0)
    route: str = Field(default="IV", max_length=MAX_ROUTE_LEN)
    operator: str | None = Field(default=None, max_length=MAX_OPERATOR_LEN)
    notes: str | None = Field(default=None, max_length=MAX_NOTES_LEN)


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
