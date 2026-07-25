"""Contratos de dominio del motor.

Este módulo es el **único** lugar donde se definen tipos compartidos.
Ningún otro módulo de `ecg_engine` debe declarar dataclasses o protocolos
que crucen fronteras entre módulos.

Unidades SI en todo el módulo: segundos, voltios, hercios.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol, Sequence, runtime_checkable

import numpy as np

LEAD_ORDER: tuple[str, ...] = (
    "I", "II", "III", "aVR", "aVL", "aVF",
    "V1", "V2", "V3", "V4", "V5", "V6",
)
"""Orden canónico de derivaciones. Invariable en todo el sistema."""

N_LEADS: int = len(LEAD_ORDER)

DEFAULT_SAMPLE_RATE_HZ: int = 500


class EventKind(str, Enum):
    """Origen anatómico de un evento cardíaco."""

    ATRIAL = "atrial"
    VENTRICULAR = "ventricular"


class WaveTarget(str, Enum):
    """Conjunto cerrado de componentes que un overlay puede modificar."""

    P = "P"
    PR = "PR"
    QRS = "QRS"
    ST = "ST"
    T = "T"


@dataclass(frozen=True, slots=True)
class CardiacEvent:
    """Un evento cardíaco discreto en la línea temporal.

    `t_s` es el instante de referencia del evento: el pico de la P para los
    auriculares, el pico de la R para los ventriculares.

    `index` es el ordinal del evento dentro de su tren, contado desde el
    origen de la simulación. Es lo que permite que las políticas de
    conducción sean deterministas sin guardar estado entre chunks: un
    Wenckebach calcula su PR a partir del índice, no de cuántas veces se
    le ha llamado.
    """

    kind: EventKind
    t_s: float
    template_id: str
    index: int


@dataclass(frozen=True, slots=True)
class GaussianComponent:
    """Una onda elemental. `center_s` es relativo al instante del evento."""

    target: WaveTarget
    amplitude_v: float
    center_s: float
    width_s: float


@dataclass(frozen=True, slots=True)
class BeatTemplate:
    """Morfología de un evento, como colección de gaussianas."""

    template_id: str
    components: tuple[GaussianComponent, ...]

    def components_for(self, target: WaveTarget) -> tuple[GaussianComponent, ...]:
        return tuple(c for c in self.components if c.target is target)


@dataclass(frozen=True, slots=True)
class NoiseParams:
    """Niveles de artefacto de medición. Todos en voltios, salvo indicación."""

    emg_v: float = 0.0
    mains_v: float = 0.0
    baseline_v: float = 0.0
    motion_v: float = 0.0
    clip_v: float | None = None


@dataclass(frozen=True, slots=True)
class VariabilityParams:
    """Variabilidad fisiológica normal: señal real del paciente."""

    respiration_hz: float = 0.25
    rsa_fraction: float = 0.04
    amplitude_fraction: float = 0.03
    rr_jitter_fraction: float = 0.015


@dataclass(frozen=True, slots=True)
class EngineParams:
    """Parámetros que el motor acepta en caliente."""

    heart_rate_hz: float = 70 / 60
    noise: NoiseParams = field(default_factory=NoiseParams)
    variability: VariabilityParams = field(default_factory=VariabilityParams)


@runtime_checkable
class EventSource(Protocol):
    """Fuente que produce eventos cardíacos discretos."""

    def events(self, t0_s: float, t1_s: float) -> Sequence[CardiacEvent]: ...


@runtime_checkable
class SignalSource(Protocol):
    """Interfaz pública de toda fuente de señal, con o sin latidos discretos."""

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray: ...
