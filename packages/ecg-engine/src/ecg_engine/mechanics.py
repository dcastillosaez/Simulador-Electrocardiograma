"""Hechos mecánicos de un ritmo.

El motor genera señal eléctrica; la mecánica que la acompaña no se deduce de
esa señal. Que una fibrilación auricular no produzca sístole auricular
efectiva es un hecho clínico, no una propiedad del trazado — igual que
`pr_is_measurable`, que ya vive en el catálogo por la misma razón.

Vive en `ecg-engine` y no en `heart-engine` porque es un atributo del ritmo, y
el catálogo de ritmos es de este paquete. `heart-engine` lo consume; no lo
posee.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Chamber(str, Enum):
    """Las dos unidades mecánicas que esta entrega distingue.

    No hay cavidades izquierda y derecha por separado: laten juntas y con la
    misma temporización. Separarlas hace falta el día que haya disincronía
    (bloqueo de rama, marcapasos), y ese día se añade sin romper el contrato
    porque el consumidor ya lee un enum, no un booleano.
    """

    ATRIA = "atria"
    VENTRICLES = "ventricles"


class ContractionMode(str, Enum):
    """Cómo se comporta mecánicamente una cámara en este ritmo."""

    SYNCHRONOUS = "synchronous"
    """Contracción organizada, disparada por eventos discretos."""

    FLUTTERING = "fluttering"
    """Contracción rápida, regular y de poca excursión. Sin eventos útiles:
    la cámara vibra a `flutter_hz`."""

    FIBRILLATING = "fibrillating"
    """Movimiento desorganizado y de excursión mínima. Sin eventos."""

    ABSENT = "absent"
    """Sin movimiento. Reservado para la asistolia, que aún no está en el
    catálogo; existe para que el consumidor no tenga que tratarla como un
    caso especial el día que llegue."""


@dataclass(frozen=True, slots=True)
class MechanicalProfile:
    """Perfil mecánico de un ritmo, por cámara."""

    atrial_mode: ContractionMode
    ventricular_mode: ContractionMode

    atrial_amplitude: float
    """Excursión auricular, 0 a 1, relativa a la sístole auricular normal."""

    ventricular_amplitude: float
    """Excursión ventricular, 0 a 1, relativa a la sístole ventricular normal."""

    atrial_systole_s: float = 0.11
    """Duración de la sístole auricular. Es sensiblemente constante y no
    escala con la frecuencia cardíaca, a diferencia de la ventricular."""

    ventricular_systole_fraction: float = 0.4
    """Fracción del intervalo RR que ocupa la sístole ventricular. A 60 lpm
    son unos 400 ms; al acelerar, la sístole se acorta menos que la diástole,
    pero para una representación visual la proporción constante basta y evita
    modelar la relación no lineal."""

    flutter_hz: float = 5.0
    """Frecuencia del temblor en modo `FLUTTERING` o `FIBRILLATING`. En el
    flutter auricular típico son unas 300 ondas por minuto."""

    isovolumetric_contraction_s: float = 0.05
    """Contracción isovolumétrica: desde que se cierran las válvulas
    auriculoventriculares hasta que la presión ventricular supera a la
    arterial y se abren las sigmoideas. Con las cuatro válvulas cerradas el
    ventrículo se contrae sin expulsar una gota, y por eso el volumen no
    cambia. Normal 30-60 ms, prácticamente constante con la frecuencia."""

    isovolumetric_relaxation_s: float = 0.07
    """Relajación isovolumétrica: desde el cierre de las sigmoideas hasta que
    la presión ventricular cae por debajo de la auricular y se abren las
    auriculoventriculares. Otra vez las cuatro cerradas, ahora sin llenado.
    Normal 50-100 ms. Es lo que impide que la diástole empiece en el mismo
    instante en que termina la eyección."""


NORMAL_PROFILE = MechanicalProfile(
    atrial_mode=ContractionMode.SYNCHRONOUS,
    ventricular_mode=ContractionMode.SYNCHRONOUS,
    atrial_amplitude=1.0,
    ventricular_amplitude=1.0,
)
