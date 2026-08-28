"""Contratos de dominio del motor.

Este módulo es el **único** lugar donde se definen tipos compartidos.
Ningún otro módulo de `ecg_engine` debe declarar dataclasses o protocolos
que crucen fronteras entre módulos.

Unidades SI en todo el módulo: segundos, voltios, hercios.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Mapping, Protocol, Sequence, runtime_checkable

import numpy as np

if TYPE_CHECKING:  # pragma: no cover - solo para el comprobador de tipos
    from .patient import PatientSpec

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
class AxisParams:
    """Orientación eléctrica del corazón en el plano frontal.

    `orientation_deg` es la orientación anatómica: al moverla rotan las cuatro
    ondas juntas. Los desfases dan a cada onda su eje propio —un hemibloqueo
    mueve solo el QRS, la isquemia solo el ST— sin desincronizar nada, porque
    el eje efectivo de cada onda es `orientation_deg + su desfase` y no hay
    estado duplicado.

    `orientation_deg` no es un parámetro del ECG sino fisiológico: lo consumen
    el motor de señal, el vector del panel y el corazón 3D de la fase D, que lo
    leerá como su giro en el plano frontal.
    """

    orientation_deg: float = 50.0
    p_offset_deg: float = 3.4
    qrs_offset_deg: float = 0.0
    st_offset_deg: float = 0.0
    t_offset_deg: float = 0.0


@dataclass(frozen=True, slots=True)
class EngineParams:
    """Parámetros que el motor acepta en caliente."""

    heart_rate_hz: float = 70 / 60
    noise: NoiseParams = field(default_factory=NoiseParams)
    variability: VariabilityParams = field(default_factory=VariabilityParams)
    axis: AxisParams = field(default_factory=AxisParams)
    rhythm: Mapping[str, float] = field(default_factory=dict)
    """Los mandos propios del ritmo elegido, si tiene alguno.

    Un mapa abierto y no campos fijos, por lo mismo que `values` en el canal
    de medidas: lo que un ritmo necesita gobernar es cosa suya y no del
    contrato. Un flutter declara su aurícula y su grado de bloqueo, un
    bloqueo completo su sinusal y su escape, y los demás no declaran nada y
    siguen manejándose enteros con `heart_rate_hz`.

    Los nombres y los rangos válidos los publica el catálogo en
    `rhythm_parameters`; lo que llegue aquí sin estar declarado se ignora.
    """

    patient: "PatientSpec | None" = None
    """La especificación de un paciente inventado, o `None` para los ritmos
    del catálogo.

    Viaja con los parámetros y no con la definición del ritmo porque es
    editable en caliente: mover el PR de un paciente personalizado y ver el
    trazado cambiar es el sentido entero de la función. Los doce ritmos del
    catálogo lo dejan a `None` y no se enteran de que existe — su fuente se
    construye igual que siempre.

    El tipo llega como texto y no como import: `patient` depende de
    conducción, trenes y plantillas, y todos ellos dependen de este módulo.
    """


@runtime_checkable
class EventSource(Protocol):
    """Fuente que produce eventos cardíacos discretos."""

    def events(self, t0_s: float, t1_s: float) -> Sequence[CardiacEvent]: ...


@runtime_checkable
class SignalSource(Protocol):
    """Interfaz pública de toda fuente de señal, con o sin latidos discretos."""

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        """Genera señal desde `t0_s`.

        Devuelve un array de forma `(12, n_samples)` y dtype `float64`, en
        **voltios**, con las derivaciones en el orden de `LEAD_ORDER`. Ese
        contrato vincula a toda implementación: el resto del sistema lo da
        por hecho sin comprobarlo.
        """
        ...
