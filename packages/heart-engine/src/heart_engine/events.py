"""Eventos eléctricos discretos → ventanas de contracción por cámara.

La traducción no es un cambio de nombre: un `CardiacEvent` marca el pico de
una onda, y una contracción es un intervalo con inicio, máximo y final. El
inicio sale de la extensión temporal de la onda en la plantilla del latido;
la duración, del perfil mecánico del ritmo.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ecg_engine.beat import get_template, target_extent_s
from ecg_engine.mechanics import Chamber, ContractionMode, MechanicalProfile
from ecg_engine.types import CardiacEvent, EventKind, WaveTarget

_PEAK_FRACTION = 0.45
"""Dónde cae la contracción máxima dentro de la ventana. Antes de la mitad:
el corazón se contrae más deprisa de lo que se relaja."""


@dataclass(frozen=True, slots=True)
class MechanicalEvent:
    """Una contracción de una cámara, con su ventana temporal completa.

    `t_start_s` a `t_peak_s` es la contracción; `t_peak_s` a `t_end_s`, la
    relajación. El cliente interpola dentro de esa ventana; no calcula
    ninguno de los tres instantes.
    """

    chamber: Chamber
    t_start_s: float
    t_peak_s: float
    t_end_s: float
    amplitude: float
    index: int

    def as_payload(self) -> dict:
        """Forma serializable. Se redondea a milisegundos: el cliente
        interpola sobre esta ventana, y un microsegundo de precisión extra no
        cambia un solo píxel pero sí engorda cada mensaje."""
        return {
            "chamber": self.chamber.value,
            "t_start_s": round(self.t_start_s, 3),
            "t_peak_s": round(self.t_peak_s, 3),
            "t_end_s": round(self.t_end_s, 3),
            "amplitude": round(self.amplitude, 3),
            "index": self.index,
        }


def _produces_events(mode: ContractionMode) -> bool:
    """Solo la contracción organizada se temporiza con eventos. El temblor
    de una fibrilación o un flutter es continuo: el cliente lo genera del
    modo y la frecuencia, sin necesidad de que el servidor le mande nada."""
    return mode is ContractionMode.SYNCHRONOUS


def _atrial_window(
    event: CardiacEvent, profile: MechanicalProfile
) -> tuple[float, float]:
    template = get_template(event.template_id)
    p_start, _ = target_extent_s(template, WaveTarget.P)
    start_s = event.t_s + p_start
    return start_s, start_s + profile.atrial_systole_s


def _ventricular_window(
    event: CardiacEvent, profile: MechanicalProfile, rr_s: float
) -> tuple[float, float]:
    template = get_template(event.template_id)
    qrs_start, _ = target_extent_s(template, WaveTarget.QRS)
    start_s = event.t_s + qrs_start
    return start_s, start_s + rr_s * profile.ventricular_systole_fraction


def derive_mechanical_events(
    events: Sequence[CardiacEvent],
    profile: MechanicalProfile,
    rr_s: float,
) -> list[MechanicalEvent]:
    """Traduce eventos eléctricos en contracciones, ordenadas por inicio.

    `rr_s` es el intervalo RR vigente: la sístole ventricular escala con él,
    la auricular no. Se pasa como parámetro y no se deduce de `events` porque
    en un bloqueo completo la distancia entre dos QRS de escape no es el RR
    que gobierna nada.
    """
    result: list[MechanicalEvent] = []

    for event in events:
        if event.kind is EventKind.ATRIAL:
            chamber = Chamber.ATRIA
            mode = profile.atrial_mode
            amplitude = profile.atrial_amplitude
            start_s, end_s = _atrial_window(event, profile)
        else:
            chamber = Chamber.VENTRICLES
            mode = profile.ventricular_mode
            amplitude = profile.ventricular_amplitude
            start_s, end_s = _ventricular_window(event, profile, rr_s)

        if not _produces_events(mode):
            continue

        result.append(
            MechanicalEvent(
                chamber=chamber,
                t_start_s=start_s,
                t_peak_s=start_s + (end_s - start_s) * _PEAK_FRACTION,
                t_end_s=end_s,
                amplitude=amplitude,
                index=event.index,
            )
        )

    result.sort(key=lambda item: item.t_start_s)
    return result
