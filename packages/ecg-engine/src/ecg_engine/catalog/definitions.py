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

from ..mechanics import NORMAL_PROFILE, ContractionMode, MechanicalProfile
from ..conduction import (
    CompleteBlock,
    FixedPR,
    FixedRatioBlock,
    IrregularConduction,
    WenckebachPR,
)
from ..overlays import ST_ELEVATION_INFERIOR
from ..patient import PatientSpec, build_patient_source
from ..rhythm import EventTrain, RegularTrain
from ..sources import BeatBasedSource, VentricularFibrillationSource
from ..types import EventKind, SignalSource, VariabilityParams


class AtrialActivity(str, Enum):
    """Qué hay en la línea de base entre QRS y QRS.

    Es un hecho del ritmo y no de la señal, por la misma razón que
    `pr_is_measurable`: contar los eventos auriculares que el motor genera da
    siempre un número, y en una fibrilación ese número —unas 420 por
    minuto— no es una frecuencia auricular, es el ruido de una aurícula que
    no se contrae. Un informe dice «actividad fibrilatoria», nunca «frecuencia
    auricular de 420 lpm».

    `ORGANIZED` incluye el flutter: sus ondas F son regulares, se cuentan y
    su frecuencia —300 por minuto— es un hallazgo diagnóstico de primera
    línea.
    """

    ORGANIZED = "organized"
    FIBRILLATORY = "fibrillatory"
    ABSENT = "absent"


class RhythmCategory(str, Enum):
    SINUS = "sinus"
    SUPRAVENTRICULAR = "supraventricular"
    VENTRICULAR = "ventricular"
    BLOCK = "block"
    ISCHEMIA = "ischemia"
    CUSTOM = "custom"
    """El paciente personalizado. Categoría propia y no «sinus» porque no es
    un hallazgo clínico: es un hueco que el usuario rellena, y la interfaz
    tiene que poder separarlo de los ritmos auditados."""


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

    `atrial_activity` es lo mismo aplicado a la frecuencia auricular: dice si
    lo que hay entre QRS y QRS se cuenta o no se cuenta. Ver `AtrialActivity`.
    """

    rhythm_id: str
    display_name: str
    category: RhythmCategory
    build_source: SourceFactory
    default_parameters: Mapping[str, float]
    editable_parameters: Mapping[str, ParameterRange]
    ventricular_rate_hz: float
    pr_is_measurable: bool
    clinical_description: str
    references: tuple[str, ...]
    # Los ocho ritmos con aurícula organizada no lo declaran: solo la FA y
    # la FV escriben algo.
    atrial_activity: AtrialActivity = AtrialActivity.ORGANIZED
    #: Los mandos propios de este ritmo, además de la frecuencia y el eje.
    #:
    #: Un ritmo con un solo marcapasos gobernable se maneja entero con
    #: `heart_rate_hz` y deja esto vacío. Los que tienen dos —un flutter con
    #: su aurícula y su grado de bloqueo, un bloqueo completo con su sinusal
    #: y su escape— no caben en un número: forzarlos producía el control
    #: deshabilitado que la interfaz enseñaba como «150 lpm (fija)», que era
    #: cierto en el programa y falso en la clínica.
    rhythm_parameters: Mapping[str, ParameterRange] = field(default_factory=dict)
    #: De dónde sale el pulso cuando no es `heart_rate_hz`.
    #:
    #: `heart_rate_hz` significa lo mismo en todo el sistema: el pulso
    #: ventricular, que es lo que un clínico llama frecuencia cardíaca y lo
    #: que toma la farmacología como basal. En los ritmos de arriba ese pulso
    #: es una consecuencia —la aurícula partida por el grado de bloqueo, el
    #: escape de un bloqueo completo— y esta función es la que lo calcula.
    #: Sin ella harían falta dos verdades para el mismo número.
    derived_rate_hz: Callable[[Mapping[str, float]], float] | None = None
    allowed_overlays: tuple[str, ...] = field(default=())
    # Los ocho ritmos con mecánica normal no lo declaran: solo los cuatro
    # que se apartan escriben algo.
    mechanical_profile: MechanicalProfile = field(default=NORMAL_PROFILE)


CUSTOM_PATIENT_ID: str = "custom_patient"
"""Identificador del paciente personalizado.

Es una constante y no un literal repartido porque tres capas preguntan por
él: el motor, para saber que la fuente sale de una especificación; la API,
para exigir esa especificación al arrancar; y la interfaz, para abrir el
editor en vez de los controles normales.
"""


#: Una fábrica de fuentes recibe su generador y los mandos propios del ritmo.
#:
#: El segundo argumento es opcional y casi todas las fábricas lo ignoran: un
#: ritmo sinusal no tiene nada que leer ahí. Lo usan las tres que no caben en
#: una sola frecuencia.
SourceFactory = Callable[..., SignalSource]


def _param(
    params: Mapping[str, float] | None, name: str, default: float
) -> float:
    """Un mando del ritmo, o su valor de catálogo si nadie lo ha tocado."""
    if params is None or name not in params:
        return default
    return float(params[name])


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


def _sinus_like(rate_bpm: float, pr_s: float = 0.16) -> SourceFactory:
    def build(
        rng: np.random.Generator, params: Mapping[str, float] | None = None
    ) -> SignalSource:
        return BeatBasedSource(
            atrial=_atrial_train(_bpm(rate_bpm), rng),
            conduction=FixedPR(pr_s=pr_s),
            variability=VariabilityParams(),
            rng=rng,
        )

    return build


def _build_atrial_fibrillation(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
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


def _build_atrial_flutter(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
    """El circuito auricular y el filtro del nodo AV, cada uno por su lado.

    Son dos hechos independientes y por eso son dos mandos. La macrorreentrada
    gira a su propia velocidad —entre 250 y 350 por minuto— y el nodo AV deja
    pasar una de cada dos, tres o cuatro. Lo que se ve en el trazado, esos 150
    lpm de libro, no es ninguno de los dos: es su cociente.
    """
    return BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL,
            template_id="flutter_f",
            rate_hz=_param(params, "atrial_rate_hz", _bpm(300)),
        ),
        conduction=FixedRatioBlock(
            ratio=int(_param(params, "conduction_ratio", 2)), pr_s=0.14
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_ventricular_tachycardia(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
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
        # Lo que manda aquí es el foco ventricular, y su velocidad separa una
        # TV lenta de una que degenera: entre 100 y 250 hay tres decisiones
        # clínicas distintas.
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR,
            template_id="wide_qrst",
            rate_hz=_param(params, "ventricular_rate_hz", _bpm(180)),
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_ventricular_fibrillation(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
    return VentricularFibrillationSource(
        coarseness=0.7, amplitude_v=0.00040, dominant_hz=6.0, rng=rng
    )


def _build_av_block_second(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(75), rng),
        conduction=WenckebachPR(
            pr_base_s=0.16, pr_increment_s=0.05, cycle_length=4
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_av_block_third(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
    """Dos marcapasos que no se hablan, y por eso dos mandos.

    La sinusal sigue a lo suyo mientras el pulso lo pone el escape, y de dónde
    salga ese escape cambia el pronóstico: uno de la unión ronda los 45 y uno
    ventricular baja de 30. Un solo control no podía decir eso.
    """
    return BeatBasedSource(
        atrial=_atrial_train(_param(params, "atrial_rate_hz", _bpm(75)), rng),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR,
            template_id="escape_qrst",
            rate_hz=_param(params, "escape_rate_hz", _bpm(40)),
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_stemi_inferior(
    rng: np.random.Generator, params: Mapping[str, float] | None = None
) -> SignalSource:
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


#: Los mandos del flutter. La aurícula gira entre 250 y 350 —fuera de ahí ya
#: no es un flutter típico— y el nodo AV deja pasar una de cada dos, tres o
#: cuatro; el 1:1 es excepcional y peligroso, y el 5:1 no se ve.
FLUTTER_PARAMETERS: Mapping[str, ParameterRange] = {
    "atrial_rate_hz": ParameterRange(_bpm(250), _bpm(350), _bpm(300)),
    "conduction_ratio": ParameterRange(2.0, 4.0, 2.0),
}

#: El foco de una taquicardia ventricular. Por debajo de 100 es un ritmo
#: idioventricular acelerado y por encima de 250 es un flutter ventricular:
#: los dos extremos son otra cosa, y el catálogo los deja fuera.
VENTRICULAR_TACHYCARDIA_PARAMETERS: Mapping[str, ParameterRange] = {
    "ventricular_rate_hz": ParameterRange(_bpm(100), _bpm(250), _bpm(180)),
}

#: Los dos marcapasos de un bloqueo completo. El escape llega a 45 si nace en
#: la unión y baja de 30 si nace en el ventrículo; esa diferencia es la que
#: decide si el paciente está mareado o inconsciente.
AV_BLOCK_THIRD_PARAMETERS: Mapping[str, ParameterRange] = {
    "atrial_rate_hz": ParameterRange(_bpm(60), _bpm(100), _bpm(75)),
    "escape_rate_hz": ParameterRange(_bpm(20), _bpm(45), _bpm(40)),
}


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
        # Las ondas f del motor van a 420 por minuto y con jitter alto. Ese
        # número existe en el generador, no en la clínica: nadie mide la
        # frecuencia auricular de una FA.
        atrial_activity=AtrialActivity.FIBRILLATORY,
        # La aurícula no bombea; el ventrículo sí, aunque irregular.
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.FIBRILLATING,
            ventricular_mode=ContractionMode.SYNCHRONOUS,
            atrial_amplitude=0.06,
            ventricular_amplitude=1.0,
            flutter_hz=7.0,
        ),
    ),
    RhythmDefinition(
        rhythm_id="atrial_flutter",
        display_name="Flutter auricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_build_atrial_flutter,
        default_parameters={"heart_rate_hz": _bpm(150)},
        # La frecuencia ventricular no se manda: se deduce de los dos mandos
        # de abajo. El rango sigue declarado como fijo porque nadie escribe
        # este número — lo escribe la aritmética.
        editable_parameters={"heart_rate_hz": _fixed(_bpm(150))},
        rhythm_parameters=FLUTTER_PARAMETERS,
        derived_rate_hz=lambda p: (
            _param(p, "atrial_rate_hz", _bpm(300))
            / max(1.0, _param(p, "conduction_ratio", 2.0))
        ),
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
        # Aurícula vibrando a unas 300/min, conducción parcial.
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.FLUTTERING,
            ventricular_mode=ContractionMode.SYNCHRONOUS,
            atrial_amplitude=0.18,
            ventricular_amplitude=1.0,
            flutter_hz=5.0,
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
        rhythm_parameters=VENTRICULAR_TACHYCARDIA_PARAMETERS,
        derived_rate_hz=lambda p: _param(p, "ventricular_rate_hz", _bpm(180)),
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
        # Ambas cámaras siguen contrayéndose --en una TV las aurículas
        # no dejan de hacerlo-- pero con mal llenado: lo que cae es la
        # eficacia, y eso se expresa bajando la amplitud, no cambiando
        # el modo.
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.SYNCHRONOUS,
            ventricular_mode=ContractionMode.SYNCHRONOUS,
            atrial_amplitude=0.5,
            ventricular_amplitude=0.55,
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
        # Su fuente no emite eventos: no hay onda que contar en ninguna de
        # las dos cámaras.
        atrial_activity=AtrialActivity.ABSENT,
        # No hay sístole: solo temblor. Es la diferencia entre un
        # corazón que bombea y uno que no.
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.FIBRILLATING,
            ventricular_mode=ContractionMode.FIBRILLATING,
            atrial_amplitude=0.05,
            ventricular_amplitude=0.10,
            flutter_hz=6.0,
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
        default_parameters={"heart_rate_hz": _bpm(40)},
        # El pulso de este ritmo es el escape, no la sinusal: `heart_rate_hz`
        # vale 40, no 75. Publicar 75 aquí sería anunciar la frecuencia
        # auricular de un paciente cuyo pulso es 40 — el error que el panel
        # de las dos frecuencias existe para no cometer.
        editable_parameters={"heart_rate_hz": _fixed(_bpm(40))},
        rhythm_parameters=AV_BLOCK_THIRD_PARAMETERS,
        derived_rate_hz=lambda p: _param(p, "escape_rate_hz", _bpm(40)),
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
        rhythm_id=CUSTOM_PATIENT_ID,
        display_name="Paciente personalizado",
        category=RhythmCategory.CUSTOM,
        # Sin especificación, un adulto sano: quien abre el editor parte de
        # alguien normal y lo enferma. La `PatientSpec` real llega con los
        # parámetros de la sesión y sustituye a esta fuente por completo.
        build_source=lambda rng, params=None: build_patient_source(
            PatientSpec(), rng
        ),
        default_parameters={"heart_rate_hz": _bpm(70)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(0), _bpm(400), _bpm(70))
        },
        ventricular_rate_hz=_bpm(70),
        pr_is_measurable=True,
        clinical_description=(
            "Paciente definido por el usuario: frecuencias, conducción "
            "auriculoventricular, intervalos y morfología se fijan a mano. No "
            "es un hallazgo clínico auditado, sino el material con el que "
            "construir uno."
        ),
        references=(
            "Sin referencia clínica: el contenido lo aporta quien lo configura",
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
