"""Mecánica cardíaca derivada de la electrofisiología.

Este paquete no genera señal ni decide conducción: consume los eventos
eléctricos que produce `ecg-engine` y los traduce en ventanas de contracción
por cámara. No importa Three.js, ni NumPy, ni nada del servidor web — es
fisiología pura, testeable con listas de dataclasses.
"""

from .events import MechanicalEvent, derive_mechanical_events

__all__ = ["MechanicalEvent", "derive_mechanical_events"]
