"""Medidas fisiológicas derivadas de una simulación.

Son la base de los golden measurements. Su valor está en que fallan con un
mensaje que se entiende: «el PR medio pasó de 160 a 190 ms» dice algo, «el
array difiere en la posición 4127» no dice nada.

Los tiempos se miden sobre los **eventos**, no sobre la señal: detectar picos
en una señal con ruido introduce sus propios errores, y aquí lo que interesa
es verificar la fisiología que el motor pretende generar.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from fractions import Fraction
from typing import Sequence

import numpy as np

from .beat import get_template, qrs_duration_s, qt_duration_s
from .types import LEAD_ORDER, CardiacEvent, EventKind

PR_DISSOCIATION_THRESHOLD_S: float = 0.05
"""Por encima de esta dispersión, el PR deja de considerarse medible.

En un bloqueo AV completo cada QRS cae a una distancia arbitraria de la P
anterior. Promediar esas distancias daría un número perfectamente calculado y
clínicamente falso, así que se devuelve NaN.

El mismo umbral decide la disociación en `av_relationship`, y es el mismo
hecho visto dos veces: un PR que no se puede promediar es exactamente un PR
que no existe porque nadie manda sobre nadie.
"""

MAX_CONDUCTION_PERIOD: int = 6
"""Cada cuántos latidos, como mucho, puede repetirse un patrón de conducción.

Un Wenckebach conduce con un PR distinto en cada posición del ciclo y vuelve
a empezar: sus intervalos P-QRS son dispersos pero **periódicos**. Sin mirar
esa periodicidad, la dispersión sola lo confunde con una disociación, y basta
un ciclo de cinco para que ocurra.

El tope tiene que ser bajo, y no por rendimiento. Dos cámaras disociadas
también repiten patrón —si van a 75 y a 40, la distancia P-QRS se repite cada
ocho latidos— así que un tope alto acabaría llamando «conducción» a una
disociación. Seis cubre los ciclos de Wenckebach que se ven y se queda por
debajo de los periodos que producen los escapes del catálogo.

Queda un caso que ni esto ni nadie resuelve: la disociación isorrítmica, con
las dos cámaras al mismo paso. Ahí el trazado es genuinamente ambiguo y un
cardiólogo tampoco puede distinguirla de una conducción fija sin más datos.
"""

AV_RATIO_MAX_TERM: int = 6
"""Mayor número que puede aparecer a un lado de la relación.

Cubre lo que se ve en la práctica —1:1, 2:1, 3:1, 4:1, y los Wenckebach 3:2,
4:3, 5:4— y deja fuera las fracciones que solo describen ruido. Sin este
tope, cualquier par de frecuencias produce una proporción exacta y que nadie
escribiría jamás en un informe, del tipo 22:3.
"""

DISSOCIATED: str = "dissociated"
"""Aurícula y ventrículo laten cada uno por su cuenta."""

VARIABLE: str = "variable"
"""Hay conducción, pero sin una proporción que se pueda escribir."""

AV_RATIO_TOLERANCE: float = 0.03
"""Error relativo que se admite entre la fracción y las frecuencias reales.

Las frecuencias se miden sobre una ventana finita, así que un 2:1 perfecto
llega como 2,004:1. Por encima de este margen la relación se declara
variable en vez de inventar un ratio.
"""


@dataclass(frozen=True, slots=True)
class Measurements:
    """Las medidas de una tira, en unidades SI.

    Hay dos frecuencias y no una porque en el corazón hay dos relojes. En
    un ritmo sinusal marcan lo mismo y la distinción parece pedante; en un
    bloqueo AV completo la aurícula va a 75 y el ventrículo a 40, y decir
    «la frecuencia» sin apellido es decir un número que no describe a nadie.
    El pulso del paciente, lo que un clínico llama frecuencia cardíaca, es
    siempre `ventricular_rate_hz`.
    """

    atrial_rate_hz: float
    ventricular_rate_hz: float
    rr_mean_s: float
    rr_std_s: float
    pr_mean_s: float
    qrs_duration_s: float
    qt_s: float
    r_amplitude_lead_ii_v: float

    def as_dict(self) -> dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


def qtc_bazett_s(qt_s: float, rr_s: float) -> float:
    """QT corregido por frecuencia, fórmula de Bazett: QTc = QT / √RR.

    Se expone como función suelta y no como campo de `Measurements` a
    propósito: añadir un campo obligaría a regenerar los golden measurements
    de los doce ritmos, que es mucha superficie de cambio para una raíz
    cuadrada. Quien quiera el QTc lo compone con `qt_s` y `rr_mean_s`.

    Bazett sobrecorrige en los extremos —infla el QTc en taquicardia y lo
    hunde en bradicardia— y eso es sabido desde 1920. Se usa igualmente
    porque es la que llevan los monitores de cabecera y la que el alumno va a
    encontrarse en la planta; enseñar otra distinta sería enseñar mal.

    Un valor no medible se propaga como no medible: `measure` devuelve NaN
    ante una disociación AV o morfologías mezcladas, y corregir un NaN no lo
    convierte en un número.
    """
    if math.isnan(qt_s) or math.isnan(rr_s) or rr_s <= 0.0:
        return math.nan
    return qt_s / math.sqrt(rr_s)


def _event_times(events: Sequence[CardiacEvent], kind: EventKind) -> np.ndarray:
    return np.array([e.t_s for e in events if e.kind is kind], dtype=np.float64)


def _atrioventricular_intervals(
    atrial_times: np.ndarray, ventricular_times: np.ndarray
) -> list[float]:
    """Distancia de cada QRS a la actividad auricular que lo precede.

    Es la materia prima de dos lecturas distintas: su media es el PR, y su
    dispersión dice si alguien manda sobre alguien. Se calcula una vez.
    """
    if atrial_times.size == 0 or ventricular_times.size == 0:
        return []
    intervals: list[float] = []
    for qrs_s in ventricular_times:
        preceding = atrial_times[atrial_times <= qrs_s]
        if preceding.size:
            intervals.append(float(qrs_s - preceding[-1]))
    return intervals


def _is_steady(values: Sequence[float]) -> bool:
    return bool(values) and float(np.std(values)) <= PR_DISSOCIATION_THRESHOLD_S


def _is_dissociated(intervals: list[float]) -> bool:
    """Cierto cuando cada QRS cae a una distancia arbitraria de su P.

    No confundir con «no hay PR»: en un flutter 2:1 tampoco se publica un PR,
    pero cada QRS sigue a su onda F a distancia fija y la conducción existe.
    Lo que delata la disociación es que la distancia no siga ninguna regla.

    Dos reglas cuentan como conducción. La distancia constante es la
    evidente. La otra es la periódica: un Wenckebach alarga el PR latido a
    latido y vuelve a empezar, así que sus intervalos están dispersos —hasta
    150 ms de diferencia entre el primero y el último del ciclo— mientras el
    ventrículo obedece a la aurícula sin fallar. Mirar solo la dispersión
    llamaba «disociación» a un ritmo perfectamente conducido.
    """
    if not intervals:
        return False
    if _is_steady(intervals):
        return False  # conducción con PR constante
    for period in range(2, MAX_CONDUCTION_PERIOD + 1):
        if len(intervals) < 2 * period:
            break
        if all(_is_steady(intervals[start::period]) for start in range(period)):
            return False  # conducción con patrón periódico
    return True


def _pr_mean_s(
    atrial_times: np.ndarray,
    ventricular_times: np.ndarray,
    pr_is_measurable: bool,
) -> float:
    if not pr_is_measurable:
        # El ritmo no tiene PR por definición. No hay nada que promediar y el
        # umbral estadístico de abajo no basta: en un flutter la relación
        # F-QRS es perfectamente regular, así que la dispersión es cero y
        # cualquier guardarraíl basado en dispersión la daría por buena.
        return math.nan
    intervals = _atrioventricular_intervals(atrial_times, ventricular_times)
    if not intervals:
        return math.nan
    if _is_dissociated(intervals):
        return math.nan  # disociación auriculoventricular
    return float(np.mean(intervals))


def av_relationship(
    events: Sequence[CardiacEvent],
    atrial_rate_hz: float,
    ventricular_rate_hz: float,
) -> str | None:
    """Cómo se relacionan las dos frecuencias, dicho como lo diría un informe.

    Devuelve `"2:1"`, `"4:3"` y demás cuando hay conducción con una relación
    reconocible; `"variable"` cuando la hay pero sin proporción estable —la
    respuesta ventricular de una fibrilación—; `"dissociated"` cuando no hay
    mando alguno; y `None` cuando falta una de las dos frecuencias y no hay
    nada que relacionar.

    Va suelta y no como campo de `Measurements` por lo mismo que
    `qtc_bazett_s`: es una lectura derivada de dos medidas que ya están
    publicadas, y meterla dentro obligaría a que los golden measurements
    —que son números— guardaran texto.

    Dos números iguales no bastan para decir 1:1. En una taquicardia
    ventricular las aurículas pueden ir casualmente al mismo paso que el
    foco sin que ninguna gobierne a la otra, así que la disociación se
    comprueba antes, y sobre los eventos: es la dispersión de la distancia
    P-QRS la que lo dice.
    """
    if (
        math.isnan(atrial_rate_hz)
        or math.isnan(ventricular_rate_hz)
        or atrial_rate_hz <= 0.0
        or ventricular_rate_hz <= 0.0
    ):
        return None

    atrial_times = _event_times(events, EventKind.ATRIAL)
    ventricular_times = _event_times(events, EventKind.VENTRICULAR)
    if _is_dissociated(_atrioventricular_intervals(atrial_times, ventricular_times)):
        return DISSOCIATED

    measured = atrial_rate_hz / ventricular_rate_hz
    ratio = Fraction(measured).limit_denominator(AV_RATIO_MAX_TERM)
    if ratio.numerator > AV_RATIO_MAX_TERM or ratio.numerator < 1:
        return VARIABLE
    if abs(float(ratio) - measured) / float(ratio) > AV_RATIO_TOLERANCE:
        return VARIABLE
    return f"{ratio.numerator}:{ratio.denominator}"


def measure(
    events: Sequence[CardiacEvent],
    signal_v: np.ndarray,
    sample_rate_hz: int,
    pr_is_measurable: bool = True,
    atrial_rate_is_measurable: bool = True,
) -> Measurements:
    """Extrae las medidas fisiológicas de una simulación.

    `pr_is_measurable` lo aporta el catálogo, porque es un hecho del ritmo y
    no de la señal. Sin él, un flutter publicaría un PR de 140 ms: la
    relación entre la onda F que conduce y su QRS es regular como un reloj,
    así que ningún guardarraíl estadístico la delata.

    `atrial_rate_is_measurable` es lo mismo para la frecuencia auricular, y
    viene del mismo sitio: contar ondas siempre da un número, pero las 420
    ondas f por minuto de una fibrilación no son una frecuencia auricular.
    Cuando el ritmo dice que no se cuentan, se publica NaN.
    """
    atrial = _event_times(events, EventKind.ATRIAL)
    ventricular = _event_times(events, EventKind.VENTRICULAR)

    duration_s = signal_v.shape[1] / float(sample_rate_hz)
    ventricular_rate_hz = (
        float(ventricular.size) / duration_s if ventricular.size else math.nan
    )
    atrial_rate_hz = (
        float(atrial.size) / duration_s
        if atrial_rate_is_measurable and atrial.size
        else math.nan
    )

    rr = np.diff(ventricular) if ventricular.size > 1 else np.array([])
    rr_mean_s = float(rr.mean()) if rr.size else math.nan
    rr_std_s = float(rr.std()) if rr.size else math.nan

    ventricular_events = [e for e in events if e.kind is EventKind.VENTRICULAR]
    template_ids = {e.template_id for e in ventricular_events}
    if len(template_ids) == 1:
        template = get_template(next(iter(template_ids)))
        qrs_s = qrs_duration_s(template)
        qt_s = qt_duration_s(template)
    else:
        # Sin latidos ventriculares no hay nada que medir. Y con latidos de
        # morfología distinta en el mismo trazado —conducidos y de escape
        # conviviendo— tampoco existe «el» QRS: hay dos. Devolver el del
        # primero sería un número arbitrario con apariencia de medida, el
        # mismo error que el PR evita ante una disociación.
        qrs_s = math.nan
        qt_s = math.nan

    return Measurements(
        atrial_rate_hz=atrial_rate_hz,
        ventricular_rate_hz=ventricular_rate_hz,
        rr_mean_s=rr_mean_s,
        rr_std_s=rr_std_s,
        pr_mean_s=_pr_mean_s(atrial, ventricular, pr_is_measurable),
        qrs_duration_s=qrs_s,
        qt_s=qt_s,
        r_amplitude_lead_ii_v=float(signal_v[LEAD_ORDER.index("II")].max()),
    )
