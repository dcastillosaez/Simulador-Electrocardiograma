"""Mecánica cardíaca publicada durante el streaming.

La calcula `heart-engine`; aquí solo vive la ventana temporal de publicación
y la traducción al contrato que viaja por el WebSocket. Es el mismo reparto
de responsabilidades que `measuring.py` tiene con `ecg_engine.measure`.
"""

from __future__ import annotations

from typing import Any, Sequence

from ecg_engine.mechanics import MechanicalProfile
from ecg_engine.types import CardiacEvent, ImpulseOrigin
from heart_engine import (
    derive_electrical_impulses,
    derive_mechanical_events,
    derive_valve_events,
)

CARDIAC_INTERVAL_S: float = 0.25
"""Cada cuánto se publica.

Cuatro veces por segundo. Más deprisa no aporta —los eventos llegan de todos
modos con la holgura del buffer de jitter— y más despacio acercaría el
mensaje al límite de esa holgura: a 1 Hz, un evento generado justo después de
publicar espera hasta un segundo, y el pre-roll del cliente son 500 ms.
"""


ELECTRICAL_LOOKAHEAD_S: float = 0.5
"""Cuánto se adelanta la ventana de los impulsos eléctricos.

Un impulso empieza antes que el evento que lo ancla: la P arranca unos 50 ms
antes de su pico y el His 45 ms antes del QRS, que a su vez empieza antes de
la R. Con la ventana de las contracciones —eventos cuyo pico ya se ha
generado— un impulso llegaba al cliente hasta 80 ms después de que la cabeza
de reproducción hubiera pasado por su primer tramo, con el buffer en su mínimo
de 300 ms. Adelantar la ventana lo arregla sin mirar a ningún futuro que no
exista ya: al dibujar cada trozo el motor fija los eventos de los
`RENDER_MARGIN_S` (0,8 s) siguientes, y esta ventana se queda dentro de ese
margen. Lo anunciado aquí es lo que se va a dibujar, y un test lo comprueba.

Si la fuente se reconstruye, lo que la anterior anunció para después de
`source_started_s` no ocurrirá: el cliente lo descarta al llegar la época
nueva.
"""


def cardiac_events_payload(
    *,
    events: Sequence[CardiacEvent],
    profile: MechanicalProfile,
    rr_s: float,
    t_start_s: float,
    t_end_s: float,
    source_started_s: float = 0.0,
    atrial_origin: ImpulseOrigin = ImpulseOrigin.SINUS,
    pairs_by_index: bool = True,
    dissociated: bool = False,
    electrical_events: Sequence[CardiacEvent] | None = None,
) -> dict[str, Any]:
    """Compone el mensaje de contracciones para la ventana dada.

    Las válvulas viajan en el mismo mensaje y no en uno propio: se derivan de
    estas mismas contracciones, así que separarlas abriría la puerta a que
    llegaran desparejadas —el corazón latiendo con la coreografía valvular del
    mensaje anterior— por un reordenamiento del transporte o un descarte.

    La electricidad viaja aquí por la misma razón: sale de los mismos eventos,
    y un mensaje aparte permitiría que el impulso llegara sin su latido. La
    calcula `heart-engine`; aquí solo se compone el campo.
    """
    mechanical = derive_mechanical_events(events, profile, rr_s)
    return {
        "type": "cardiac_events",
        "t_start_s": round(t_start_s, 3),
        "t_end_s": round(t_end_s, 3),
        # La época de la fuente que numeró estos eventos. Una fuente
        # reconstruida —el paciente editado, un mando, un fármaco— vuelve a
        # contar los latidos desde 0, y el cliente, que deduplica por índice,
        # descartaba todos los de un ritmo más lento como ya vistos: el
        # corazón se quedaba quieto hasta que los índices nuevos alcanzaban a
        # los viejos. Con la época, el mismo índice de otra fuente es otro
        # latido.
        "source_started_s": round(source_started_s, 3),
        "events": [event.as_payload() for event in mechanical],
        "valves": [
            valve.as_payload() for valve in derive_valve_events(mechanical, profile)
        ],
        "electrical": [
            impulse.as_payload()
            for impulse in derive_electrical_impulses(
                events if electrical_events is None else electrical_events,
                profile,
                atrial_origin=atrial_origin,
                pairs_by_index=pairs_by_index,
                dissociated=dissociated,
            )
        ],
    }
