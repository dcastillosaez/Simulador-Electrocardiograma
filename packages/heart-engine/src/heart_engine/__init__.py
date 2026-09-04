"""Mecánica cardíaca derivada de la electrofisiología.

Este paquete no genera señal ni decide conducción: consume los eventos
eléctricos que produce `ecg-engine` y los traduce en ventanas de contracción
por cámara. No importa Three.js, ni NumPy, ni nada del servidor web — es
fisiología pura, testeable con listas de dataclasses.
"""

from .events import MechanicalEvent, derive_mechanical_events
from .heart_state import HeartState
from .valves import ValveEvent, derive_valve_events

__all__ = [
    "HeartState",
    "MechanicalEvent",
    "ValveEvent",
    "derive_mechanical_events",
    "derive_valve_events",
]
