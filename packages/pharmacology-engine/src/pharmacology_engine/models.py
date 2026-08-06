"""Contratos de dominio del motor farmacológico.

Este módulo es el **único** sitio donde se declaran tipos que cruzan
fronteras entre módulos, igual que `ecg_engine.types` lo es para el motor de
señal. Aquí no se importa nada de `ecg_engine`: la Fase F exige que los dos
motores permanezcan desacoplados y que el único objeto que viaje entre
ellos sea `PhysiologyState`.

Convenio de unidades y de neutralidad, invariable en todo el paquete:

* Los campos **aditivos** llevan sufijo de unidad (`_ms`, `_bpm`, `_deg`,
  `_mv`, `_mmhg`) y su valor neutro es `0.0`.
* Los campos **multiplicativos** no llevan sufijo y su valor neutro es
  `1.0`. Un multiplicador de `0.8` significa «el 80 % de lo basal».

Esa distinción no es cosmética: es lo que permite que `combine()` sume unos
y multiplique los otros sin una tabla de casos, y que sumar el efecto nulo
sea realmente una operación identidad.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field, fields, replace
from enum import Enum
from typing import Iterable, Mapping

# --- vocabulario ------------------------------------------------------------


class Route(str, Enum):
    """Vías de administración soportadas.

    Cerrada a propósito: una vía nueva cambia la cinética (una vía oral
    tiene un onset de minutos, no de segundos) y debe entrar por revisión,
    no por un string suelto en un YAML.
    """

    IV = "IV"
    IM = "IM"
    SC = "SC"
    IO = "IO"
    SL = "SL"
    PO = "PO"
    NEB = "NEB"


class DrugCategory(str, Enum):
    """Familias de la biblioteca base de la Fase F."""

    ANTIARRHYTHMIC = "antiarrhythmic"
    BETA_BLOCKER = "beta_blocker"
    CALCIUM_BLOCKER = "calcium_blocker"
    SYMPATHOMIMETIC = "sympathomimetic"
    PARASYMPATHOLYTIC = "parasympatholytic"
    ELECTROLYTE = "electrolyte"


# --- efecto -----------------------------------------------------------------

#: Campos aditivos de `DrugEffect`, con su valor neutro `0.0`.
ADDITIVE_FIELDS: tuple[str, ...] = (
    "heart_rate_delta_bpm",
    "pr_delta_ms",
    "qrs_delta_ms",
    "qt_delta_ms",
    "axis_delta_deg",
    "st_shift_mv",
    "blood_pressure_delta_mmhg",
)

#: Campos multiplicativos de `DrugEffect`, con su valor neutro `1.0`.
MULTIPLICATIVE_FIELDS: tuple[str, ...] = (
    "sinus_rate",
    "automaticity",
    "av_conduction",
    "atrial_conduction",
    "ventricular_conduction",
    "t_amplitude",
    "contractility",
    "stroke_volume",
    "respiratory_rate",
    "oxygen_consumption",
)

EFFECT_FIELDS: tuple[str, ...] = ADDITIVE_FIELDS + MULTIPLICATIVE_FIELDS


@dataclass(frozen=True, slots=True)
class DrugEffect:
    """Lo único que un fármaco produce: modificadores fisiológicos.

    Ningún campo describe una onda, un trazado ni un píxel. El motor de ECG
    verá el resultado de aplicarlos sobre el estado basal y nunca sabrá qué
    molécula los generó — que es exactamente el punto de la Fase F.

    Los campos de conducción son multiplicadores de **velocidad**: `0.7` en
    `av_conduction` significa que el nodo AV conduce al 70 % de lo normal,
    o sea un PR más largo. La inversión la hace `apply_effect`, no el
    catálogo, para que un YAML nunca tenga que razonar al revés.
    """

    # aditivos — neutro 0.0
    heart_rate_delta_bpm: float = 0.0
    pr_delta_ms: float = 0.0
    qrs_delta_ms: float = 0.0
    qt_delta_ms: float = 0.0
    axis_delta_deg: float = 0.0
    st_shift_mv: float = 0.0
    blood_pressure_delta_mmhg: float = 0.0

    # multiplicativos — neutro 1.0
    sinus_rate: float = 1.0
    automaticity: float = 1.0
    av_conduction: float = 1.0
    atrial_conduction: float = 1.0
    ventricular_conduction: float = 1.0
    t_amplitude: float = 1.0
    contractility: float = 1.0
    stroke_volume: float = 1.0
    respiratory_rate: float = 1.0
    oxygen_consumption: float = 1.0

    def is_neutral(self) -> bool:
        return self == NEUTRAL_EFFECT

    def as_dict(self) -> dict[str, float]:
        return {name: getattr(self, name) for name in EFFECT_FIELDS}


NEUTRAL_EFFECT = DrugEffect()
"""El efecto identidad. `combine([])` lo devuelve, y sumarlo no cambia nada."""


def combine(effects: Iterable[DrugEffect]) -> DrugEffect:
    """Superpone efectos: los aditivos se suman, los multiplicativos se
    multiplican.

    La superposición es conmutativa y asociativa por construcción, así que
    el orden en que llegan los fármacos no altera el resultado. Es lo que
    hace que el replay sea exacto sin tener que conservar el orden de
    administración dentro de un mismo instante.
    """
    totals: dict[str, float] = {name: 0.0 for name in ADDITIVE_FIELDS}
    totals.update({name: 1.0 for name in MULTIPLICATIVE_FIELDS})
    for effect in effects:
        for name in ADDITIVE_FIELDS:
            totals[name] += getattr(effect, name)
        for name in MULTIPLICATIVE_FIELDS:
            totals[name] *= getattr(effect, name)
    return DrugEffect(**totals)


def scale(effect: DrugEffect, intensity: float) -> DrugEffect:
    """Escala un efecto por una intensidad ∈ [0, ∞).

    Con `intensity == 0` devuelve el efecto neutro; con `1.0`, el efecto
    íntegro. Los aditivos se escalan linealmente y los multiplicativos se
    interpolan desde 1.0, que es la forma correcta de «medio efecto» cuando
    el campo es una ganancia: la mitad de un multiplicador de 0.8 es 0.9, no
    0.4.
    """
    if intensity <= 0.0:
        return NEUTRAL_EFFECT
    if intensity == 1.0:
        # Atajo por exactitud, no por velocidad: `1 + (0.05 - 1) * 1.0`
        # devuelve 0.05000000000000004 en coma flotante, y ese residuo se
        # propaga a un estado fisiológico que los tests golden comparan por
        # igualdad. La identidad tiene que ser identidad.
        return effect
    values: dict[str, float] = {
        name: getattr(effect, name) * intensity for name in ADDITIVE_FIELDS
    }
    values.update(
        {
            name: 1.0 + (getattr(effect, name) - 1.0) * intensity
            for name in MULTIPLICATIVE_FIELDS
        }
    )
    return DrugEffect(**values)


# --- administración ---------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DrugAdministration:
    """Un evento de administración. Nunca se borra ni se modifica.

    `t_s` es el reloj **de simulación**, no el de pared: es lo que hace que
    un replay con la misma semilla y la misma lista de administraciones
    reproduzca la sesión exactamente. `wall_clock` se guarda solo para la
    trazabilidad del registro y no participa en ningún cálculo.
    """

    id: uuid.UUID
    drug_id: str
    dose: float
    dose_unit: str
    route: Route
    t_s: float
    operator: str | None = None
    notes: str | None = None
    wall_clock: dt.datetime | None = None

    def as_dict(self) -> dict:
        return {
            "id": str(self.id),
            "drug_id": self.drug_id,
            "dose": self.dose,
            "dose_unit": self.dose_unit,
            "route": self.route.value,
            "t_s": self.t_s,
            "operator": self.operator,
            "notes": self.notes,
        }


@dataclass(frozen=True, slots=True)
class ActiveDrug:
    """Lo que la interfaz necesita saber de un fármaco vivo en el instante t.

    `concentration` es la fracción normalizada de la curva (0–1) y sirve
    para la barra de progreso; `intensity` incluye ya la dosis acumulada y
    puede pasar de 1.0. Son dos números distintos a propósito: una barra
    llena no significa dosis máxima.
    """

    drug_id: str
    display_name: str
    category: DrugCategory
    concentration: float
    intensity: float
    cumulative_dose: float
    dose_unit: str
    elapsed_s: float
    remaining_s: float
    administration_ids: tuple[uuid.UUID, ...]

    def as_dict(self) -> dict:
        return {
            "drug_id": self.drug_id,
            "display_name": self.display_name,
            "category": self.category.value,
            "concentration": round(self.concentration, 4),
            "intensity": round(self.intensity, 4),
            "cumulative_dose": self.cumulative_dose,
            "dose_unit": self.dose_unit,
            "elapsed_s": round(self.elapsed_s, 2),
            "remaining_s": round(self.remaining_s, 2),
        }


# --- estado fisiológico -----------------------------------------------------


@dataclass(frozen=True, slots=True)
class PhysiologyState:
    """La interfaz oficial entre motores.

    El motor de ECG, el corazón 3D y el panel de constantes consumen este
    objeto y ninguno de ellos conoce la existencia de un fármaco. Añadir una
    molécula nueva jamás cambia esta clase; añadir un eje fisiológico nuevo
    sí, y por eso lleva valores por defecto: un consumidor antiguo sigue
    compilando.
    """

    heart_rate_bpm: float = 70.0
    sinus_rate_bpm: float = 70.0
    automaticity: float = 1.0
    av_conduction: float = 1.0
    atrial_conduction: float = 1.0
    ventricular_conduction: float = 1.0
    pr_interval_ms: float = 160.0
    qrs_duration_ms: float = 90.0
    qt_interval_ms: float = 400.0
    axis_deg: float = 50.0
    st_shift_mv: float = 0.0
    t_amplitude: float = 1.0
    contractility: float = 1.0
    stroke_volume_ml: float = 70.0
    systolic_bp_mmhg: float = 120.0
    diastolic_bp_mmhg: float = 75.0
    respiratory_rate_bpm: float = 14.0
    oxygen_consumption: float = 1.0

    @property
    def cardiac_output_l_min(self) -> float:
        """Gasto cardíaco derivado, en litros por minuto.

        Derivado y no almacenado: es exactamente FC × VS, y guardarlo como
        campo propio habría creado un segundo sitio donde puede quedar
        desincronizado.
        """
        return self.heart_rate_bpm * self.stroke_volume_ml / 1000.0

    @property
    def mean_bp_mmhg(self) -> float:
        return self.diastolic_bp_mmhg + (
            self.systolic_bp_mmhg - self.diastolic_bp_mmhg
        ) / 3.0

    def as_dict(self) -> dict[str, float]:
        payload = {f.name: getattr(self, f.name) for f in fields(self)}
        payload["cardiac_output_l_min"] = self.cardiac_output_l_min
        payload["mean_bp_mmhg"] = self.mean_bp_mmhg
        return {k: round(v, 3) for k, v in payload.items()}


#: Límites fisiológicos duros. Un fármaco puede empujar el estado, no
#: sacarlo del terreno de lo vivo: sin esto, tres dosis de adrenalina
#: producirían una frecuencia de 400 lpm y un QT negativo, y el motor de ECG
#: recibiría parámetros que ninguna sesión clínica podría justificar.
PHYSIOLOGY_BOUNDS: Mapping[str, tuple[float, float]] = {
    "heart_rate_bpm": (15.0, 260.0),
    "sinus_rate_bpm": (15.0, 260.0),
    "automaticity": (0.0, 4.0),
    "av_conduction": (0.05, 3.0),
    "atrial_conduction": (0.05, 3.0),
    "ventricular_conduction": (0.05, 3.0),
    "pr_interval_ms": (80.0, 600.0),
    "qrs_duration_ms": (60.0, 220.0),
    "qt_interval_ms": (240.0, 700.0),
    "axis_deg": (-90.0, 180.0),
    "st_shift_mv": (-0.6, 0.9),
    "t_amplitude": (-1.5, 3.0),
    "contractility": (0.1, 3.0),
    "stroke_volume_ml": (15.0, 160.0),
    "systolic_bp_mmhg": (40.0, 260.0),
    "diastolic_bp_mmhg": (20.0, 160.0),
    "respiratory_rate_bpm": (4.0, 60.0),
    "oxygen_consumption": (0.2, 4.0),
}


def clamp_physiology(state: PhysiologyState) -> PhysiologyState:
    """Recorta el estado a `PHYSIOLOGY_BOUNDS` y ordena las dos presiones.

    El orden importa: recortar sístole y diástole por separado puede dejar
    una diastólica por encima de la sistólica, que es un estado imposible y
    que el panel de constantes pintaría tal cual.
    """
    values = {f.name: getattr(state, f.name) for f in fields(state)}
    for name, (low, high) in PHYSIOLOGY_BOUNDS.items():
        values[name] = min(max(values[name], low), high)
    if values["diastolic_bp_mmhg"] > values["systolic_bp_mmhg"]:
        values["diastolic_bp_mmhg"] = values["systolic_bp_mmhg"]
    return PhysiologyState(**values)


@dataclass(frozen=True, slots=True)
class PatientBaseline:
    """El paciente antes de cualquier fármaco.

    Es el punto de partida sobre el que se aplica el efecto combinado. Lo
    fija el escenario (o, mientras no haya escenarios, el ritmo elegido y la
    frecuencia de mando), nunca el motor farmacológico.
    """

    state: PhysiologyState = field(default_factory=PhysiologyState)

    def with_heart_rate(self, bpm: float) -> "PatientBaseline":
        """Reencuadra el basal a una frecuencia distinta.

        La usa la API cada vez que el usuario mueve el mando de frecuencia:
        el basal cambia, los fármacos activos siguen siendo los mismos y su
        efecto se recalcula sobre el basal nuevo.
        """
        return PatientBaseline(
            state=replace(self.state, heart_rate_bpm=bpm, sinus_rate_bpm=bpm)
        )
