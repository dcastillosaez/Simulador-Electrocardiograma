"""Mecánica cardíaca publicada durante el streaming.

La calcula `heart-engine`; aquí solo vive la ventana temporal de publicación
y la traducción al contrato que viaja por el WebSocket. Es el mismo reparto
de responsabilidades que `measuring.py` tiene con `ecg_engine.measure`.
"""

from __future__ import annotations

from typing import Any, Sequence

from ecg_engine.mechanics import MechanicalProfile
from ecg_engine.types import CardiacEvent
from heart_engine import derive_mechanical_events, derive_valve_events

CARDIAC_INTERVAL_S: float = 0.25
"""Cada cuánto se publica.

Cuatro veces por segundo. Más deprisa no aporta —los eventos llegan de todos
modos con la holgura del buffer de jitter— y más despacio acercaría el
mensaje al límite de esa holgura: a 1 Hz, un evento generado justo después de
publicar espera hasta un segundo, y el pre-roll del cliente son 500 ms.
"""


def cardiac_events_payload(
    *,
    events: Sequence[CardiacEvent],
    profile: MechanicalProfile,
    rr_s: float,
    t_start_s: float,
    t_end_s: float,
) -> dict[str, Any]:
    """Compone el mensaje de contracciones para la ventana dada.

    Las válvulas viajan en el mismo mensaje y no en uno propio: se derivan de
    estas mismas contracciones, así que separarlas abriría la puerta a que
    llegaran desparejadas —el corazón latiendo con la coreografía valvular del
    mensaje anterior— por un reordenamiento del transporte o un descarte.
    """
    mechanical = derive_mechanical_events(events, profile, rr_s)
    return {
        "type": "cardiac_events",
        "t_start_s": round(t_start_s, 3),
        "t_end_s": round(t_end_s, 3),
        "events": [event.as_payload() for event in mechanical],
        "valves": [
            valve.as_payload() for valve in derive_valve_events(mechanical, profile)
        ],
    }
