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
from typing import Sequence

import numpy as np

from .beat import get_template, qrs_duration_s, qt_duration_s
from .types import LEAD_ORDER, CardiacEvent, EventKind

PR_DISSOCIATION_THRESHOLD_S: float = 0.05
"""Por encima de esta dispersión, el PR deja de considerarse medible.

En un bloqueo AV completo cada QRS cae a una distancia arbitraria de la P
anterior. Promediar esas distancias daría un número perfectamente calculado y
clínicamente falso, así que se devuelve NaN.
"""


@dataclass(frozen=True, slots=True)
class Measurements:
    heart_rate_hz: float
    rr_mean_s: float
    rr_std_s: float
    pr_mean_s: float
    qrs_duration_s: float
    qt_s: float
    r_amplitude_lead_ii_v: float

    def as_dict(self) -> dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


def _pr_mean_s(
    atrial_times: np.ndarray, ventricular_times: np.ndarray
) -> float:
    if atrial_times.size == 0 or ventricular_times.size == 0:
        return math.nan
    intervals: list[float] = []
    for qrs_s in ventricular_times:
        preceding = atrial_times[atrial_times <= qrs_s]
        if preceding.size:
            intervals.append(float(qrs_s - preceding[-1]))
    if not intervals:
        return math.nan
    if float(np.std(intervals)) > PR_DISSOCIATION_THRESHOLD_S:
        return math.nan  # disociación auriculoventricular
    return float(np.mean(intervals))


def measure(
    events: Sequence[CardiacEvent],
    signal_v: np.ndarray,
    sample_rate_hz: int,
) -> Measurements:
    """Extrae las medidas fisiológicas de una simulación."""
    atrial = np.array(
        [e.t_s for e in events if e.kind is EventKind.ATRIAL], dtype=np.float64
    )
    ventricular = np.array(
        [e.t_s for e in events if e.kind is EventKind.VENTRICULAR], dtype=np.float64
    )

    duration_s = signal_v.shape[1] / float(sample_rate_hz)
    heart_rate_hz = (
        float(ventricular.size) / duration_s if ventricular.size else math.nan
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
        heart_rate_hz=heart_rate_hz,
        rr_mean_s=rr_mean_s,
        rr_std_s=rr_std_s,
        pr_mean_s=_pr_mean_s(atrial, ventricular),
        qrs_duration_s=qrs_s,
        qt_s=qt_s,
        r_amplitude_lead_ii_v=float(signal_v[LEAD_ORDER.index("II")].max()),
    )
