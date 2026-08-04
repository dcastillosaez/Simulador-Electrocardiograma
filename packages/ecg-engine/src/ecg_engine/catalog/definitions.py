"""Los doce ritmos del MVP, como datos.

Si algún ritmo obligara a escribir un `if` fuera de este paquete, la
arquitectura habría fallado. Todo lo que distingue un ritmo de otro cabe en
una `RhythmDefinition`: qué trenes lo componen, qué política de conducción
lo gobierna y qué overlays admite.

Las descripciones clínicas y las referencias no son adorno: son lo que hace
auditable la revisión por un profesional antes de cerrar la fase.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Mapping

import numpy as np

from ..conduction import (
    CompleteBlock,
    FixedPR,
    FixedRatioBlock,
    IrregularConduction,
    WenckebachPR,
)
from ..overlays import ST_ELEVATION_INFERIOR
from ..rhythm import EventTrain, RegularTrain
from ..sources import BeatBasedSource, VentricularFibrillationSource
from ..types import EventKind, SignalSource, VariabilityParams


class RhythmCategory(str, Enum):
    SINUS = "sinus"
    SUPRAVENTRICULAR = "supraventricular"
    VENTRICULAR = "ventricular"
    BLOCK = "block"
    ISCHEMIA = "ischemia"


@dataclass(frozen=True, slots=True)
class ParameterRange:
    """Rango válido de un parámetro editable por el usuario."""

    minimum: float
    maximum: float
    default: float

    def __post_init__(self) -> None:
        if self.minimum > self.maximum:
            raise ValueError(
                f"minimum {self.minimum} supera a maximum {self.maximum}"
            )
        if not self.minimum <= self.default <= self.maximum:
            raise ValueError(
                f"default {self.default} fuera del rango "
                f"[{self.minimum}, {self.maximum}]"
            )

    def clamp(self, value: float) -> float:
        return min(max(value, self.minimum), self.maximum)


@dataclass(frozen=True, slots=True)
class RhythmDefinition:
    """Contrato completo de un ritmo del catálogo.

    `heart_rate_hz`, dentro de `default_parameters` y `editable_parameters`,
    es la **frecuencia de mando**: el valor que el usuario mueve y que el
    motor propaga a quien gobierne el ritmo. En los ritmos sinusales es
    también el pulso del paciente, pero en los bloqueos no: en un Mobitz I
    manda la frecuencia sinusal y uno de cada cuatro latidos no llega al
    ventrículo, y en un bloqueo completo las aurículas van a su aire mientras
    el pulso lo marca el escape.

    `ventricular_rate_hz` es ese pulso: lo que un clínico llama frecuencia
    cardíaca y lo que una interfaz debe mostrar. Separarlos no es purismo.
    Mostrar 75 lpm en un bloqueo AV completo —la frecuencia auricular— cuando
    el paciente tiene un pulso de 40 basta para que un cardiólogo descarte el
    simulador de un vistazo.

    `pr_is_measurable` dice si en este ritmo existe siquiera un intervalo PR.
    Es un hecho del ritmo, no una propiedad de la señal: en la fibrilación
    auricular no hay onda P que medir, en el flutter la relación F-QRS no es
    lo que nadie llama PR, y en la taquicardia ventricular las aurículas van
    disociadas. Deducirlo de la dispersión de los datos —que fue el primer
    intento— publicaba un PR de 49,8 ms para una FA y de 140 ms para un
    flutter: números perfectamente calculados y clínicamente inexistentes.
    """

    rhythm_id: str
    display_name: str
    category: RhythmCategory
    build_source: Callable[[np.random.Generator], SignalSource]
    default_parameters: Mapping[str, float]
    editable_parameters: Mapping[str, ParameterRange]
    ventricular_rate_hz: float
    pr_is_measurable: bool
    clinical_description: str
    references: tuple[str, ...]
    allowed_overlays: tuple[str, ...] = field(default=())


def _bpm(value: float) -> float:
    """Latidos por minuto a hercios. La frontera con las unidades clínicas."""
    return value / 60.0


def _atrial_train(
    rate_hz: float, rng: np.random.Generator, template_id: str = "sinus_p"
) -> EventTrain:
    return EventTrain(
        kind=EventKind.ATRIAL,
        template_id=template_id,
        rate_hz=rate_hz,
        variability=VariabilityParams(),
        rng=rng,
    )


def _sinus_like(
    rate_bpm: float, pr_s: float = 0.16
) -> Callable[[np.random.Generator], SignalSource]:
    def build(rng: np.random.Generator) -> SignalSource:
        return BeatBasedSource(
            atrial=_atrial_train(_bpm(rate_bpm), rng),
            conduction=FixedPR(pr_s=pr_s),
            variability=VariabilityParams(),
            rng=rng,
        )

    return build


def _build_atrial_fibrillation(rng: np.random.Generator) -> SignalSource:
    # Dos generadores hijos independientes, y esto no es un detalle de
    # estilo. Aquí hay dos fuentes de aleatoriedad —el tren de ondas f y la
    # conducción irregular del nodo AV— y ambas cachean su línea temporal
    # hacia adelante. Si compartieran generador, el orden en que se
    # intercalan sus extracciones dependería de cómo se trocee el render, y
    # la señal dejaría de ser la misma pidiéndola entera o por trozos.
    atrial_rng, conduction_rng = rng.spawn(2)
    return BeatBasedSource(
        # Actividad auricular caótica: ondas f que llegan a destiempo, no un
        # flutter rápido. Con un tren regular la línea de base salía como un
        # serrucho perfecto —dientes de sierra a intervalo constante—, que es
        # justo la morfología del flutter y lo contrario de una fibrilación.
        # El jitter alto es lo que rompe esa regularidad.
        atrial=EventTrain(
            kind=EventKind.ATRIAL,
            template_id="af_f",
            rate_hz=_bpm(420),
            variability=VariabilityParams(
                rsa_fraction=0.0,
                amplitude_fraction=0.0,
                rr_jitter_fraction=0.30,
            ),
            rng=atrial_rng,
        ),
        conduction=IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.20),
        variability=VariabilityParams(),
        rng=conduction_rng,
    )


def _build_atrial_flutter(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=_bpm(300)
        ),
        conduction=FixedRatioBlock(ratio=2, pr_s=0.14),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_ventricular_tachycardia(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        # Las aurículas siguen en ritmo sinusal, a su propio paso y sin
        # relación con el foco ventricular: eso *es* la disociación
        # auriculoventricular, el hallazgo que distingue una TV de una
        # taquicardia supraventricular conducida con aberrancia.
        #
        # Ponerlas a la misma frecuencia que el foco las sincronizaba latido
        # a latido: la P caía exactamente sobre el pico de la R, le sumaba un
        # 10 % de amplitud y producía un PR de 0 ms. Lo contrario de lo que
        # la descripción clínica de este ritmo promete.
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="sinus_p", rate_hz=_bpm(75)
        ),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR, template_id="wide_qrst", rate_hz=_bpm(180)
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_ventricular_fibrillation(rng: np.random.Generator) -> SignalSource:
    return VentricularFibrillationSource(
        coarseness=0.7, amplitude_v=0.00040, dominant_hz=6.0, rng=rng
    )


def _build_av_block_second(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(75), rng),
        conduction=WenckebachPR(
            pr_base_s=0.16, pr_increment_s=0.05, cycle_length=4
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_av_block_third(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(75), rng),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR, template_id="escape_qrst", rate_hz=_bpm(40)
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_stemi_inferior(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(78), rng),
        conduction=FixedPR(pr_s=0.16),
        overlays=(ST_ELEVATION_INFERIOR,),
        variability=VariabilityParams(),
        rng=rng,
    )


_FIXED_RATE = ParameterRange(minimum=0.0, maximum=0.0, default=0.0)


def _fixed(rate_hz: float) -> ParameterRange:
    """Rango de un solo punto, para ritmos de frecuencia estructural.

    El flutter despolariza la aurícula a 300 por minuto con conducción 2:1, y
    un escape ventricular late a 40. Esas frecuencias definen el ritmo. Ofrecer
    un control deslizante que no hace nada sería mentirle al usuario, así que
    el catálogo declara el rango como fijo y la interfaz lo muestra
    deshabilitado.
    """
    return ParameterRange(minimum=rate_hz, maximum=rate_hz, default=rate_hz)


AXIS_PARAMETER_RANGES: Mapping[str, ParameterRange] = {
    "orientation_deg": ParameterRange(-180.0, 180.0, 50.0),
    "p_offset_deg": ParameterRange(-45.0, 45.0, 3.4),
    "qrs_offset_deg": ParameterRange(-90.0, 90.0, 0.0),
    "st_offset_deg": ParameterRange(-180.0, 180.0, 0.0),
    "t_offset_deg": ParameterRange(-180.0, 180.0, 0.0),
}
"""Rangos del eje, compartidos por los doce ritmos. Una sola definición: doce
copias serían doce sitios donde desincronizar. Se fusionan en cada ritmo desde
`catalog/__init__.py`. No son un límite del motor —sabe calcular cualquier
ángulo— sino la declaración de qué considera el sistema fisiológicamente
razonable, y viajan al cliente por la API."""


DEFINITIONS: tuple[RhythmDefinition, ...] = (
    RhythmDefinition(
        rhythm_id="sinus_normal",
        display_name="Ritmo sinusal normal",
        category=RhythmCategory.SINUS,
        build_source=_sinus_like(70),
        default_parameters={"heart_rate_hz": _bpm(70)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(60), _bpm(100), _bpm(70))
        },
        ventricular_rate_hz=_bpm(70),
        pr_is_measurable=True,
        clinical_description=(
            "Onda P precediendo a cada QRS con PR constante entre 120 y 200 ms, "
            "frecuencia entre 60 y 100 lpm y QRS estrecho."
        ),
        references=("Surawicz B, Knilans T. Chou's Electrocardiography, cap. 1",),
    ),
    RhythmDefinition(
        rhythm_id="sinus_tachycardia",
        display_name="Taquicardia sinusal",
        category=RhythmCategory.SINUS,
        build_source=_sinus_like(120),
        default_parameters={"heart_rate_hz": _bpm(120)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(101), _bpm(180), _bpm(120))
        },
        ventricular_rate_hz=_bpm(120),
        pr_is_measurable=True,
        clinical_description=(
            "Ritmo sinusal por encima de 100 lpm. La P puede fundirse con la T "
            "precedente a frecuencias altas."
        ),
        references=("Surawicz B, Knilans T. Chou's Electrocardiography, cap. 13",),
    ),
    RhythmDefinition(
        rhythm_id="sinus_bradycardia",
        display_name="Bradicardia sinusal",
        category=RhythmCategory.SINUS,
        build_source=_sinus_like(48),
        default_parameters={"heart_rate_hz": _bpm(48)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(30), _bpm(59), _bpm(48))
        },
        ventricular_rate_hz=_bpm(48),
        pr_is_measurable=True,
        clinical_description=(
            "Ritmo sinusal por debajo de 60 lpm. Frecuente y benigno en "
            "deportistas y durante el sueño."
        ),
        references=("Surawicz B, Knilans T. Chou's Electrocardiography, cap. 13",),
    ),
    RhythmDefinition(
        rhythm_id="atrial_fibrillation",
        display_name="Fibrilación auricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_build_atrial_fibrillation,
        default_parameters={"heart_rate_hz": _bpm(80)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(50), _bpm(180), _bpm(80))
        },
        ventricular_rate_hz=_bpm(80),
        pr_is_measurable=False,
        clinical_description=(
            "Ausencia de ondas P organizadas, sustituidas por ondas f de "
            "amplitud variable, con respuesta ventricular irregularmente "
            "irregular."
        ),
        references=(
            "Hindricks G, et al. 2020 ESC Guidelines for atrial fibrillation",
        ),
    ),
    RhythmDefinition(
        rhythm_id="atrial_flutter",
        display_name="Flutter auricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_build_atrial_flutter,
        default_parameters={"heart_rate_hz": _bpm(150)},
        editable_parameters={"heart_rate_hz": _fixed(_bpm(150))},
        ventricular_rate_hz=_bpm(150),
        pr_is_measurable=False,
        clinical_description=(
            "Ondas F en dientes de sierra a unos 300 por minuto, con conducción "
            "habitualmente 2:1, lo que da una respuesta ventricular en torno a "
            "150 lpm."
        ),
        references=(
            "Brugada J, et al. 2019 ESC Guidelines for supraventricular "
            "tachycardia",
        ),
    ),
    RhythmDefinition(
        rhythm_id="svt",
        display_name="Taquicardia supraventricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_sinus_like(180, pr_s=0.09),
        default_parameters={"heart_rate_hz": _bpm(180)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(150), _bpm(250), _bpm(180))
        },
        ventricular_rate_hz=_bpm(180),
        pr_is_measurable=True,
        clinical_description=(
            "Taquicardia regular de QRS estrecho entre 150 y 250 lpm, con la P "
            "habitualmente oculta dentro del QRS o de la T."
        ),
        references=(
            "Brugada J, et al. 2019 ESC Guidelines for supraventricular "
            "tachycardia",
        ),
    ),
    RhythmDefinition(
        rhythm_id="ventricular_tachycardia",
        display_name="Taquicardia ventricular",
        category=RhythmCategory.VENTRICULAR,
        build_source=_build_ventricular_tachycardia,
        default_parameters={"heart_rate_hz": _bpm(180)},
        editable_parameters={"heart_rate_hz": _fixed(_bpm(180))},
        ventricular_rate_hz=_bpm(180),
        pr_is_measurable=False,
        clinical_description=(
            "Taquicardia regular de QRS ancho por encima de 120 ms, con "
            "disociación auriculoventricular."
        ),
        references=(
            "Zeppenfeld K, et al. 2022 ESC Guidelines for ventricular "
            "arrhythmias",
        ),
    ),
    RhythmDefinition(
        rhythm_id="ventricular_fibrillation",
        display_name="Fibrilación ventricular",
        category=RhythmCategory.VENTRICULAR,
        build_source=_build_ventricular_fibrillation,
        default_parameters={"heart_rate_hz": 0.0},
        editable_parameters={"heart_rate_hz": _FIXED_RATE},
        ventricular_rate_hz=0.0,
        pr_is_measurable=False,
        clinical_description=(
            "Actividad eléctrica caótica sin complejos identificables ni línea "
            "isoeléctrica. No tiene frecuencia cardíaca medible."
        ),
        references=(
            "Zeppenfeld K, et al. 2022 ESC Guidelines for ventricular "
            "arrhythmias",
        ),
    ),
    RhythmDefinition(
        rhythm_id="av_block_first",
        display_name="Bloqueo AV de primer grado",
        category=RhythmCategory.BLOCK,
        build_source=_sinus_like(70, pr_s=0.26),
        default_parameters={"heart_rate_hz": _bpm(70)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(45), _bpm(100), _bpm(70))
        },
        ventricular_rate_hz=_bpm(70),
        pr_is_measurable=True,
        clinical_description=(
            "PR constante por encima de 200 ms, con conducción 1:1 conservada. "
            "Toda P va seguida de su QRS."
        ),
        references=(
            "Glikson M, et al. 2021 ESC Guidelines on cardiac pacing",
        ),
    ),
    RhythmDefinition(
        rhythm_id="av_block_second_mobitz_i",
        display_name="Bloqueo AV de segundo grado, Mobitz I",
        category=RhythmCategory.BLOCK,
        build_source=_build_av_block_second,
        default_parameters={"heart_rate_hz": _bpm(75)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(50), _bpm(100), _bpm(75))
        },
        ventricular_rate_hz=_bpm(56.25),
        pr_is_measurable=True,
        clinical_description=(
            "Alargamiento progresivo del PR latido a latido hasta que una onda "
            "P no conduce. Tras la pausa, el PR vuelve a su valor basal."
        ),
        references=(
            "Glikson M, et al. 2021 ESC Guidelines on cardiac pacing",
        ),
    ),
    RhythmDefinition(
        rhythm_id="av_block_third",
        display_name="Bloqueo AV completo",
        category=RhythmCategory.BLOCK,
        build_source=_build_av_block_third,
        default_parameters={"heart_rate_hz": _bpm(75)},
        editable_parameters={"heart_rate_hz": _fixed(_bpm(75))},
        ventricular_rate_hz=_bpm(40),
        pr_is_measurable=False,
        clinical_description=(
            "Disociación auriculoventricular completa: las aurículas y los "
            "ventrículos laten a frecuencias independientes, con un ritmo de "
            "escape ventricular en torno a 40 lpm."
        ),
        references=(
            "Glikson M, et al. 2021 ESC Guidelines on cardiac pacing",
        ),
    ),
    RhythmDefinition(
        rhythm_id="stemi_inferior",
        display_name="IAM inferior con elevación del ST",
        category=RhythmCategory.ISCHEMIA,
        build_source=_build_stemi_inferior,
        default_parameters={"heart_rate_hz": _bpm(78)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(50), _bpm(120), _bpm(78))
        },
        ventricular_rate_hz=_bpm(78),
        pr_is_measurable=True,
        allowed_overlays=("st_elevation_inferior",),
        clinical_description=(
            "Ritmo sinusal con elevación del segmento ST en II, III y aVF. No "
            "es un ritmo distinto: es sinusal más un overlay morfológico."
        ),
        references=(
            "Byrne RA, et al. 2023 ESC Guidelines for acute coronary syndromes",
        ),
    ),
)
