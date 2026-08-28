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
    rhythm_parameters: dict[str, ParameterRangePayload] = {}
    """Los mandos propios de este ritmo, si tiene alguno.

    La interfaz pinta un control por cada uno en lugar del de frecuencia
    cuando existen: es lo que convierte el «150 lpm (fija)» del flutter en una
    aurícula y un grado de bloqueo que se pueden mover.
    """

    patient_parameters: dict[str, ParameterRangePayload] | None = None
    """Los rangos del editor de paciente, solo en `custom_patient`.

    Van por el mismo camino que `editable_parameters` y por el mismo motivo:
    los límites clínicos los decide el motor, y una interfaz que los copiara
    en su propio código acabaría ofreciendo un deslizador que llega a donde
    el servidor no acepta. Un rechazo así se ve como un fallo del programa,
    no como un límite fisiológico.
    """


# --- WebSocket: parámetros del motor --------------------------------------

import json
import uuid
from dataclasses import asdict
from typing import Literal, Union

from pydantic import (
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from ecg_engine import (
    AvConduction,
    AxisParams,
    EngineParams,
    NoiseParams,
    PatientSpec,
    VariabilityParams,
)
from ecg_engine.custom_beat import MAX_QRS_MS, MAX_QT_MS, MIN_QRS_MS, MIN_QT_MS
from ecg_engine.measurements import MAX_CONDUCTION_PERIOD
from ecg_engine.patient import (
    MAX_PR_MS,
    MAX_RATE_BPM,
    MAX_ST_SHIFT_MV,
    MAX_T_SCALE,
    MIN_PR_MS,
)
from pharmacology_engine import DrugAdministration

from .pharmacology.projection import PatientVitals


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
# Un flutter conduce 2:1 o 4:1; por encima de 6:1 el ventrículo iría tan lento
# que el escape tomaría el mando, y eso se describe con un bloqueo completo.
MAX_CONDUCTION_RATIO = 6
# Ningún ritmo declara más de un puñado de mandos propios. El tope solo existe
# para que un cliente no mande un diccionario enorme por el WebSocket.
MAX_RHYTHM_PARAMETERS = 16


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


class PatientPayload(FinitePayload):
    """Un paciente inventado, tal y como lo escribe la interfaz.

    Un solo objeto plano en el cable, dos destinos en el servidor: lo
    eléctrico construye la `PatientSpec` del motor de señal y lo hemodinámico
    el basal del motor farmacológico. La interfaz no tiene por qué conocer esa
    frontera —para quien configura, todo esto es «el paciente»— y el servidor
    no debería mezclar los dos dominios por comodidad de la interfaz. Aquí es
    donde se reparte.

    Los rangos duplican los del motor a propósito. Este es el borde de la
    red, y un payload malformado tiene que morir aquí con un mensaje que se
    entienda, no cuatro capas más adentro con un `ValueError` de un
    dataclass. El motor vuelve a comprobarlo porque tampoco se fía de quien
    le llama.
    """

    atrial_rate_bpm: float = Field(default=70.0, ge=0.0, le=MAX_RATE_BPM)
    av_conduction: Literal["conducted", "ratio", "wenckebach", "complete_block"] = (
        "conducted"
    )
    conduction_ratio: int = Field(default=2, ge=2, le=MAX_CONDUCTION_RATIO)
    wenckebach_cycle: int = Field(default=4, ge=2, le=MAX_CONDUCTION_PERIOD)
    wenckebach_increment_ms: float = Field(default=50.0, ge=0.0, le=200.0)
    escape_rate_bpm: float = Field(default=40.0, ge=0.0, le=MAX_RATE_BPM)

    pr_ms: float = Field(default=160.0, ge=MIN_PR_MS, le=MAX_PR_MS)
    qrs_ms: float = Field(default=90.0, ge=MIN_QRS_MS, le=MAX_QRS_MS)
    qt_ms: float = Field(default=400.0, ge=MIN_QT_MS, le=MAX_QT_MS)

    st_shift_mv: float = Field(default=0.0, ge=-MAX_ST_SHIFT_MV, le=MAX_ST_SHIFT_MV)
    t_amplitude_scale: float = Field(default=1.0, ge=-MAX_T_SCALE, le=MAX_T_SCALE)
    p_amplitude_scale: float = Field(default=1.0, ge=0.0, le=MAX_T_SCALE)

    # --- constantes, que no son del motor de señal -------------------------
    systolic_bp_mmhg: float = Field(default=120.0, ge=0.0, le=260.0)
    diastolic_bp_mmhg: float = Field(default=75.0, ge=0.0, le=200.0)
    respiratory_rate_bpm: float = Field(default=14.0, ge=0.0, le=60.0)
    stroke_volume_ml: float = Field(default=70.0, ge=0.0, le=200.0)

    @model_validator(mode="after")
    def _check_pairs(self) -> "PatientPayload":
        if self.qt_ms <= self.qrs_ms:
            raise ValueError(
                f"qt_ms ({self.qt_ms}) debe ser mayor que qrs_ms ({self.qrs_ms}): "
                "el QT se mide desde el inicio del QRS"
            )
        if self.diastolic_bp_mmhg > self.systolic_bp_mmhg:
            raise ValueError(
                f"la diastólica ({self.diastolic_bp_mmhg}) no puede superar a "
                f"la sistólica ({self.systolic_bp_mmhg})"
            )
        return self

    def to_vitals(self) -> PatientVitals:
        """La mitad hemodinámica: el basal que empujarán los fármacos."""
        return PatientVitals(
            systolic_bp_mmhg=self.systolic_bp_mmhg,
            diastolic_bp_mmhg=self.diastolic_bp_mmhg,
            respiratory_rate_bpm=self.respiratory_rate_bpm,
            stroke_volume_ml=self.stroke_volume_ml,
        )

    def to_spec(self) -> PatientSpec:
        """La mitad eléctrica: lo que el motor de señal sabe generar."""
        return PatientSpec(
            atrial_rate_bpm=self.atrial_rate_bpm,
            av_conduction=AvConduction(self.av_conduction),
            conduction_ratio=self.conduction_ratio,
            wenckebach_cycle=self.wenckebach_cycle,
            wenckebach_increment_ms=self.wenckebach_increment_ms,
            escape_rate_bpm=self.escape_rate_bpm,
            pr_ms=self.pr_ms,
            qrs_ms=self.qrs_ms,
            qt_ms=self.qt_ms,
            st_shift_mv=self.st_shift_mv,
            t_amplitude_scale=self.t_amplitude_scale,
            p_amplitude_scale=self.p_amplitude_scale,
        )


class EngineParamsPayload(FinitePayload):
    # `ge` y no `gt`: cero es la frecuencia de la fibrilación ventricular, que
    # es la que el propio catálogo publica como valor por defecto de ese
    # ritmo. Con `gt=0` el cliente mandaba ese valor, el servidor lo rechazaba
    # y la FV no se podía arrancar: la sesión seguía emitiendo el ritmo
    # anterior bajo el rótulo del nuevo.
    #
    # Cero no llega a ninguna división: la fuente de la FV ignora la
    # frecuencia —no tiene latidos que espaciar— y cualquier otro ritmo la
    # recorta antes a su propio rango, que nunca incluye el cero.
    heart_rate_hz: float = Field(ge=0.0, le=MAX_HEART_RATE_HZ)
    noise: NoiseParamsPayload = Field(default_factory=NoiseParamsPayload)
    variability: VariabilityParamsPayload = Field(
        default_factory=VariabilityParamsPayload
    )
    axis: AxisParamsPayload = Field(default_factory=AxisParamsPayload)
    rhythm: dict[str, float] = Field(default_factory=dict)
    """Los mandos propios del ritmo: la aurícula y el grado de bloqueo de un
    flutter, el foco de una TV, la sinusal y el escape de un bloqueo completo.

    Mapa abierto y con tope de tamaño: el catálogo decide qué nombres son
    válidos y el motor recorta los valores a su rango, así que aquí solo hace
    falta impedir que alguien mande un diccionario de un millón de claves.
    Lo que no esté declarado en el ritmo elegido se descarta al llegar al
    motor, no se guarda.
    """

    patient: PatientPayload | None = None
    """Presente solo en el ritmo `custom_patient`. Los doce del catálogo lo
    dejan vacío y siguen exactamente el mismo camino que antes."""

    @field_validator("rhythm")
    @classmethod
    def _bounded_rhythm(cls, value: dict[str, float]) -> dict[str, float]:
        if len(value) > MAX_RHYTHM_PARAMETERS:
            raise ValueError(
                f"demasiados mandos de ritmo: {len(value)} (máximo "
                f"{MAX_RHYTHM_PARAMETERS})"
            )
        for name in value:
            if len(name) > MAX_ID_LEN:
                raise ValueError(f"nombre de mando demasiado largo: {name[:20]!r}")
        return value

    def to_engine_params(self) -> EngineParams:
        return EngineParams(
            heart_rate_hz=self.heart_rate_hz,
            noise=NoiseParams(**self.noise.model_dump()),
            variability=VariabilityParams(**self.variability.model_dump()),
            axis=AxisParams(**self.axis.model_dump()),
            rhythm=dict(self.rhythm),
            patient=self.patient.to_spec() if self.patient is not None else None,
        )


def engine_params_to_dict(params: EngineParams) -> dict:
    """El sentido inverso de `to_engine_params`, para mensajes salientes y
    para la columna `params` de la sesión persistida. Sin Pydantic de por
    medio: `EngineParams` y sus dataclasses anidadas ya son inmutables y
    completas, no hace falta validarlas otra vez, solo volcarlas."""
    payload = {
        "heart_rate_hz": params.heart_rate_hz,
        "noise": asdict(params.noise),
        "variability": asdict(params.variability),
        "axis": asdict(params.axis),
    }
    if params.rhythm:
        payload["rhythm"] = dict(params.rhythm)
    if params.patient is not None:
        # El paciente entero, no un identificador: la fila de `sessions` tiene
        # que bastar para reconstruir la simulación años después, y un puntero
        # a una tabla que alguien puede editar o borrar no basta. Es la misma
        # razón por la que la sesión guarda la versión del motor.
        patient = asdict(params.patient)
        patient["av_conduction"] = params.patient.av_conduction.value
        payload["patient"] = patient
    return payload


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
    *,
    session_id: uuid.UUID,
    seed: int,
    sample_rate_hz: int,
    channels: int,
    params: EngineParams,
) -> dict:
    """Acuse de arranque, con los parámetros que el motor acabó aplicando.

    Los params van dentro porque no siempre son los que el cliente mandó: el
    motor recorta al rango del ritmo y, en los que tienen mandos propios,
    **calcula** la frecuencia en vez de aceptarla —el pulso de un flutter es
    su aurícula partida por el grado de bloqueo—. Sin esto, la interfaz seguía
    enseñando los parámetros del ritmo anterior hasta el primer `update`, y en
    un bloqueo completo eso significaba anunciar el pulso de la taquicardia
    que se acababa de dejar atrás.
    """
    return {
        "type": "started",
        "session_id": str(session_id),
        "seed": seed,
        "sample_rate_hz": sample_rate_hz,
        "channels": channels,
        "params": engine_params_to_dict(params),
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


# --- REST: pacientes personalizados -----------------------------------------

MAX_PATIENT_NAME_LEN = 120


class CustomPatientWrite(BaseModel):
    """Lo que la interfaz manda al guardar.

    El nombre es lo que un docente lee en la lista, así que se recorta de
    espacios y se exige no vacío: un paciente llamado «   » existe en la base
    de datos y no existe en la pantalla.
    """

    name: str = Field(min_length=1, max_length=MAX_PATIENT_NAME_LEN)
    patient: PatientPayload

    @model_validator(mode="after")
    def _clean_name(self) -> "CustomPatientWrite":
        cleaned = self.name.strip()
        if not cleaned:
            raise ValueError("el nombre no puede estar en blanco")
        object.__setattr__(self, "name", cleaned)
        return self


class CustomPatientSummary(BaseModel):
    id: uuid.UUID
    name: str
    created_at: dt.datetime
    updated_at: dt.datetime


class CustomPatientDetail(CustomPatientSummary):
    engine_semver: str
    # Validado también al leer: una fila guardada por una versión anterior del
    # editor puede no tener todos los campos de hoy, y pasarla por el esquema
    # actual rellena los que falten con su valor por defecto en vez de romper
    # el navegador.
    patient: PatientPayload
