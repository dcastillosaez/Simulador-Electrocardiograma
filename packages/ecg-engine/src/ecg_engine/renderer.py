"""Conversión de eventos a muestras.

Este módulo es deliberadamente tonto. Recibe eventos, overlays y una rejilla
temporal, y devuelve muestras. No decide nada fisiológico: ni cuándo late el
corazón, ni si una P conduce, ni cuánto varía el RR. Toda esa lógica vive
antes, en `rhythm.py`, `conduction.py`, `variability.py` y `overlays.py`.

Criterio de revisión: si hay que preguntarle a este módulo *por qué* el ECG
hace algo, la lógica está en el sitio equivocado.

Respeta el tramo de la cadena que le corresponde:
señal base → overlays → variabilidad. El ruido lo aplica el orquestador.
"""

from __future__ import annotations

from typing import Mapping, Sequence

import numpy as np

from .beat import get_template
from .leads import ATRIAL_PROJECTION, NORMAL_AXIS_PROJECTION, LeadProjection
from .overlays import MorphologyOverlay
from .types import (
    N_LEADS,
    CardiacEvent,
    EventKind,
    VariabilityParams,
)
from .variability import amplitude_scale
from .waveform import render_component

RENDER_MARGIN_S: float = 0.6
"""Margen temporal que el llamante debe añadir al pedir eventos.

Una onda T se extiende hasta medio segundo después del pico de su R, así que
un latido anterior a la ventana sigue contribuyendo dentro de ella. Quien
llama a `render_events` debe pasar los eventos de `[t0 - margen, t1 + margen)`,
o aparecerán discontinuidades en las fronteras de chunk.
"""

DEFAULT_PROJECTIONS: dict[EventKind, LeadProjection] = {
    EventKind.ATRIAL: ATRIAL_PROJECTION,
    EventKind.VENTRICULAR: NORMAL_AXIS_PROJECTION,
}


def time_grid(start_index: int, n_samples: int, sample_rate_hz: int) -> np.ndarray:
    """Rejilla temporal absoluta de `n_samples` muestras desde `start_index`.

    Se construye desde el índice de muestra, `(start_index + i) / sample_rate_hz`,
    y no desde un tiempo en segundos ya sumado. Es la misma operación tanto si
    se generan 2500 muestras de una vez como si se generan en cinco trozos de
    500: el resultado es idéntico bit a bit en la frontera de cada trozo.
    Construir la rejilla como `t0_s + i / sample_rate_hz` sumaría dos
    redondeos de punto flotante distintos según la ruta (uno para `t0_s`, otro
    para el índice dentro del array), y esa diferencia de un ULP se amplifica
    al pasar por las gaussianas de `waveform.py` y la modulación de
    `variability.amplitude_scale`.
    """
    return (start_index + np.arange(n_samples, dtype=np.float64)) / float(sample_rate_hz)


def _trace_for_event(t_s: np.ndarray, event: CardiacEvent) -> np.ndarray:
    template = get_template(event.template_id)
    trace = np.zeros_like(t_s)
    for component in template.components:
        trace += render_component(t_s, component, offset_s=event.t_s)
    return trace


def render_events(
    events: Sequence[CardiacEvent],
    t_s: np.ndarray,
    projections: Mapping[EventKind, LeadProjection],
    overlays: Sequence[MorphologyOverlay] = (),
    variability: VariabilityParams | None = None,
) -> np.ndarray:
    """Convierte una lista de eventos en una señal de doce derivaciones."""
    signal = np.zeros((N_LEADS, t_s.size), dtype=np.float64)

    for event in events:
        trace = _trace_for_event(t_s, event)
        signal += projections[event.kind].as_column() * trace[np.newaxis, :]

    # Los overlays modifican morfología ventricular. No tocan la aurícula, y
    # por construcción no pueden crear ni mover eventos.
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    for overlay in overlays:
        overlay_trace = np.zeros_like(t_s)
        for event in ventricular:
            for component in overlay.components():
                overlay_trace += render_component(
                    t_s, component, offset_s=event.t_s
                )
        signal += overlay.lead_mask() * overlay_trace[np.newaxis, :]

    if variability is not None:
        signal *= amplitude_scale(t_s, variability)[np.newaxis, :]

    return signal
