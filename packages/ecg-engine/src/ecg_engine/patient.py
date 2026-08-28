"""El paciente personalizado, como especificación declarativa.

Un ritmo del catálogo es un hecho clínico versionado: la fibrilación
auricular es la que es, y su definición vive en `catalog/definitions.py` para
que un revisor pueda auditarla. Un paciente personalizado es lo contrario —lo
que un docente inventa para una clase concreta— y por eso no es una
definición más del catálogo sino un dato: se escribe, viaja por la red, se
guarda con un nombre y se vuelve a cargar.

La `PatientSpec` describe **lo eléctrico**: quién marca el paso arriba, qué
deja pasar el nodo AV, cuánto duran los intervalos y qué forma tienen las
ondas. Lo hemodinámico —tensión, respiración, volumen sistólico— no está
aquí: eso es el basal del paciente y vive en `pharmacology_engine`, que es
quien sabe empujarlo con fármacos. Cada motor conserva su dominio; la API los
compone.

Todo lo que hay debajo ya existía
---------------------------------
Este módulo no añade fisiología: compone las piezas del motor —trenes,
políticas de conducción, plantillas— desde números en vez de desde una
definición fija. Si algún día un paciente personalizado necesitara un
comportamiento que ningún ritmo del catálogo pueda expresar, la pieza que
falta se escribe en `conduction.py` o en `rhythm.py`, no aquí.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np

from .conduction import CompleteBlock, FixedPR, FixedRatioBlock, WenckebachPR
from .custom_beat import (
    MAX_QRS_MS,
    MAX_QT_MS,
    MIN_QRS_MS,
    MIN_QT_MS,
    custom_atrial_id,
    custom_ventricular_id,
)
from .measurements import MAX_CONDUCTION_PERIOD
from .mechanics import NORMAL_PROFILE, ContractionMode, MechanicalProfile
from .rhythm import EventTrain, RegularTrain, SilentTrain
from .sources import BeatBasedSource
from .types import EventKind, SignalSource, VariabilityParams


class AvConduction(str, Enum):
    """Qué hace el nodo AV con lo que le llega de arriba."""

    CONDUCTED = "conducted"
    """Todo pasa, con el mismo PR. Es el sinusal, y con un PR largo es el
    bloqueo de primer grado: no hace falta distinguirlos."""

    RATIO = "ratio"
    """Pasa una de cada `conduction_ratio`. El 2:1 de un flutter, o un
    Mobitz II."""

    WENCKEBACH = "wenckebach"
    """El PR se alarga hasta que un latido cae. Mobitz I."""

    COMPLETE_BLOCK = "complete_block"
    """No pasa nada, y el ventrículo late por su cuenta a
    `escape_rate_bpm`."""


MIN_RATE_BPM: float = 0.0
MAX_RATE_BPM: float = 400.0
"""Hasta 400 por minuto para que quepan las ondas de un flutter rápido.
El cero está permitido y significa silencio: una aurícula que no despolariza,
o un ventrículo sin escape."""

MIN_PR_MS: float = 80.0
MAX_PR_MS: float = 600.0
"""Un PR por debajo de 80 ms es preexcitación, que necesita una onda delta y
no solo un número menor; por encima de 600 la P se solaparía con el QRS
siguiente a cualquier frecuencia razonable."""

MAX_ST_SHIFT_MV: float = 1.0
MAX_T_SCALE: float = 3.0

DEFAULT_ESCAPE_RATE_BPM: float = 40.0
DEFAULT_WENCKEBACH_INCREMENT_MS: float = 50.0
DEFAULT_WENCKEBACH_CYCLE: int = 4


def _check(name: str, value: float, low: float, high: float) -> None:
    if not low <= value <= high:
        raise ValueError(
            f"{name} fuera del rango clínico [{low}, {high}]: {value}"
        )


@dataclass(frozen=True, slots=True)
class PatientSpec:
    """Un paciente inventado, descrito por completo.

    Los valores por defecto son un adulto sano en ritmo sinusal: quien abre
    el editor parte de alguien normal y lo enferma, que es como se construye
    un caso clínico.
    """

    atrial_rate_bpm: float = 70.0
    """Frecuencia de la aurícula. Cero significa que no despolariza: sin
    ondas P, el ventrículo depende del escape."""

    av_conduction: AvConduction = AvConduction.CONDUCTED
    conduction_ratio: int = 2
    wenckebach_cycle: int = DEFAULT_WENCKEBACH_CYCLE
    wenckebach_increment_ms: float = DEFAULT_WENCKEBACH_INCREMENT_MS
    escape_rate_bpm: float = DEFAULT_ESCAPE_RATE_BPM

    pr_ms: float = 160.0
    qrs_ms: float = 90.0
    qt_ms: float = 400.0

    st_shift_mv: float = 0.0
    """Desplazamiento del segmento ST en milivoltios. Positivo es elevación.
    A calibración estándar, 0,1 mV es 1 mm, el umbral diagnóstico."""

    t_amplitude_scale: float = 1.0
    """Amplitud de la T relativa a la normal. Negativo la invierte."""

    p_amplitude_scale: float = 1.0
    """Amplitud de la P relativa a la sinusal. Cero la borra sin quitar la
    despolarización: la aurícula sigue mandando latidos al nodo AV aunque no
    se vea, que es lo que ocurre cuando la P queda enterrada en el QRS."""

    def __post_init__(self) -> None:
        _check("atrial_rate_bpm", self.atrial_rate_bpm, MIN_RATE_BPM, MAX_RATE_BPM)
        _check("escape_rate_bpm", self.escape_rate_bpm, MIN_RATE_BPM, MAX_RATE_BPM)
        _check("pr_ms", self.pr_ms, MIN_PR_MS, MAX_PR_MS)
        _check("qrs_ms", self.qrs_ms, MIN_QRS_MS, MAX_QRS_MS)
        _check("qt_ms", self.qt_ms, MIN_QT_MS, MAX_QT_MS)
        _check("st_shift_mv", self.st_shift_mv, -MAX_ST_SHIFT_MV, MAX_ST_SHIFT_MV)
        _check("t_amplitude_scale", self.t_amplitude_scale, -MAX_T_SCALE, MAX_T_SCALE)
        _check("p_amplitude_scale", self.p_amplitude_scale, 0.0, MAX_T_SCALE)
        if self.conduction_ratio < 2:
            raise ValueError(
                f"conduction_ratio debe ser al menos 2, recibido "
                f"{self.conduction_ratio}"
            )
        # El techo no es estético: la periodicidad es lo que permite leer un
        # Wenckebach como conducción y no como disociación, y esa lectura
        # solo llega hasta `MAX_CONDUCTION_PERIOD` latidos. Un ciclo más
        # largo produciría un paciente que el propio panel describiría mal.
        if not 2 <= self.wenckebach_cycle <= MAX_CONDUCTION_PERIOD:
            raise ValueError(
                f"wenckebach_cycle debe estar entre 2 y {MAX_CONDUCTION_PERIOD}, "
                f"recibido {self.wenckebach_cycle}"
            )
        # El QT contiene al QRS por definición: es del inicio del QRS al final
        # de la T. Un QT más corto que su propio QRS no es un paciente
        # enfermo, es una descripción imposible, y produciría una T pintada
        # dentro del complejo.
        if self.qt_ms <= self.qrs_ms:
            raise ValueError(
                f"qt_ms ({self.qt_ms}) debe ser mayor que qrs_ms ({self.qrs_ms}): "
                "el QT se mide desde el inicio del QRS"
            )

    # --- lecturas derivadas -------------------------------------------------

    @property
    def has_atrial_activity(self) -> bool:
        return self.atrial_rate_bpm > 0.0

    @property
    def ventricular_rate_bpm(self) -> float:
        """La frecuencia que tendrá el ventrículo, antes de generar nada.

        Es aritmética de la conducción, no una medida: sirve para que la
        interfaz pueda anticipar el pulso mientras el usuario mueve los
        controles, y para que la sesión sepa qué paciente está describiendo
        antes del primer latido.
        """
        if not self.has_atrial_activity:
            return self.escape_rate_bpm
        if self.av_conduction is AvConduction.COMPLETE_BLOCK:
            return self.escape_rate_bpm
        if self.av_conduction is AvConduction.RATIO:
            return self.atrial_rate_bpm / self.conduction_ratio
        if self.av_conduction is AvConduction.WENCKEBACH:
            # De cada ciclo de N ondas P, conducen N-1.
            return self.atrial_rate_bpm * (self.wenckebach_cycle - 1) / (
                self.wenckebach_cycle
            )
        return self.atrial_rate_bpm

    @property
    def ventricular_template_id(self) -> str:
        return custom_ventricular_id(
            qrs_ms=self.qrs_ms,
            qt_ms=self.qt_ms,
            st_shift_mv=self.st_shift_mv,
            t_scale=self.t_amplitude_scale,
        )

    @property
    def atrial_template_id(self) -> str:
        return custom_atrial_id(p_scale=self.p_amplitude_scale)

    @property
    def mechanical_profile(self) -> MechanicalProfile:
        """Lo que este paciente hace mecánicamente.

        Un paciente al que se le quitan la aurícula y el escape no tiene
        latidos: es una asistolia, y publicar para ella las constantes de
        alguien que camina es el mismo error que se corrigió para la
        fibrilación ventricular. El perfil sale de aquí porque es
        consecuencia de la especificación, no una opción aparte que el
        usuario pudiera dejar incoherente.
        """
        if self.ventricular_rate_bpm <= 0.0:
            return MechanicalProfile(
                atrial_mode=ContractionMode.ABSENT,
                ventricular_mode=ContractionMode.ABSENT,
                atrial_amplitude=0.0,
                ventricular_amplitude=0.0,
            )
        if not self.has_atrial_activity:
            # El ventrículo late; la aurícula no se contrae.
            return MechanicalProfile(
                atrial_mode=ContractionMode.ABSENT,
                ventricular_mode=ContractionMode.SYNCHRONOUS,
                atrial_amplitude=0.0,
                ventricular_amplitude=1.0,
            )
        return NORMAL_PROFILE

    @property
    def pr_is_measurable(self) -> bool:
        """Hay PR cuando alguien de arriba manda sobre alguien de abajo."""
        return (
            self.has_atrial_activity
            and self.av_conduction is not AvConduction.COMPLETE_BLOCK
        )


def _conduction_policy(spec: PatientSpec):
    template_id = spec.ventricular_template_id
    if spec.av_conduction is AvConduction.COMPLETE_BLOCK:
        return CompleteBlock()
    if spec.av_conduction is AvConduction.RATIO:
        return FixedRatioBlock(
            ratio=spec.conduction_ratio,
            pr_s=spec.pr_ms / 1000.0,
            template_id=template_id,
        )
    if spec.av_conduction is AvConduction.WENCKEBACH:
        return WenckebachPR(
            pr_base_s=spec.pr_ms / 1000.0,
            pr_increment_s=spec.wenckebach_increment_ms / 1000.0,
            cycle_length=spec.wenckebach_cycle,
            template_id=template_id,
        )
    return FixedPR(pr_s=spec.pr_ms / 1000.0, template_id=template_id)


def build_patient_source(
    spec: PatientSpec,
    rng: np.random.Generator,
    variability: VariabilityParams | None = None,
) -> SignalSource:
    """Compone la fuente de señal que describe la especificación.

    El escape se monta siempre que el ventrículo no dependa de la aurícula, y
    solo entonces: añadirlo también en un ritmo conducido produciría latidos
    de más —dos marcapasos compitiendo— que nadie ha pedido.
    """
    atrial_rng, escape_rng = rng.spawn(2)

    if spec.has_atrial_activity:
        atrial = EventTrain(
            kind=EventKind.ATRIAL,
            template_id=spec.atrial_template_id,
            rate_hz=spec.atrial_rate_bpm / 60.0,
            variability=variability if variability is not None else VariabilityParams(),
            rng=atrial_rng,
        )
    else:
        atrial = SilentTrain()

    needs_escape = (
        not spec.has_atrial_activity
        or spec.av_conduction is AvConduction.COMPLETE_BLOCK
    )
    escape = None
    if needs_escape and spec.escape_rate_bpm > 0.0:
        escape = RegularTrain(
            kind=EventKind.VENTRICULAR,
            template_id=spec.ventricular_template_id,
            rate_hz=spec.escape_rate_bpm / 60.0,
        )

    return BeatBasedSource(
        atrial=atrial,
        conduction=_conduction_policy(spec),
        escape=escape,
        variability=variability,
        rng=escape_rng,
    )
