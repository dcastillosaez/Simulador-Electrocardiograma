"""Variabilidad fisiológica normal.

Esto **no es ruido**. Es señal real del paciente: estaría presente aunque el
electrodo fuera perfecto. La frontera importa, y los tests la respetan: los
de fisiología corren con el ruido a cero, los de ruido sobre señal conocida.

Un único oscilador respiratorio alimenta a la vez la arritmia sinusal
respiratoria y la variación de amplitud latido a latido. Compartir oscilador
no es un atajo: es lo que ocurre de verdad, y hace que el trazo respire de
forma coherente en lugar de temblar al azar.

La deriva de línea base también se alimenta de este oscilador, pero vive en
`noise.py` porque es un artefacto de medición —impedancia cambiante por el
movimiento del tórax— aunque su origen sea fisiológico.
"""

from __future__ import annotations

import numpy as np

from .types import VariabilityParams


def respiratory_phase(
    t_s: np.ndarray | float, respiration_hz: float
) -> np.ndarray:
    """Fase del ciclo respiratorio, normalizada a `[-1, 1]`.

    El máximo corresponde al pico inspiratorio, donde el RR se acorta.
    """
    return np.sin(2.0 * np.pi * respiration_hz * np.asarray(t_s, dtype=np.float64))


def amplitude_scale(t_s: np.ndarray, params: VariabilityParams) -> np.ndarray:
    """Factor multiplicativo de amplitud, oscilando en torno a 1."""
    phase = respiratory_phase(t_s, params.respiration_hz)
    return 1.0 + params.amplitude_fraction * phase


def next_rr_s(
    base_rr_s: float,
    t_s: float,
    params: VariabilityParams,
    rng: np.random.Generator,
) -> float:
    """Intervalo RR siguiente, con arritmia sinusal respiratoria y jitter.

    En el pico inspiratorio el RR se **acorta**, de ahí el signo negativo:
    es el reflejo de Bainbridge, y es la razón de que el pulso de una persona
    joven y sana no sea un metrónomo.
    """
    phase = float(respiratory_phase(t_s, params.respiration_hz))
    rsa_factor = 1.0 - params.rsa_fraction * phase
    jitter = float(rng.normal(0.0, params.rr_jitter_fraction))
    rr_s = base_rr_s * rsa_factor * (1.0 + jitter)
    return max(rr_s, 0.05 * base_rr_s)
