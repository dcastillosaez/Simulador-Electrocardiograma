"""Ondas elementales del latido, como gaussianas paramétricas.

Cada onda —P, Q, R, S, T— es una gaussiana definida por amplitud, centro y
anchura. Las patologías morfológicas se obtienen moviendo esos parámetros.
"""

from __future__ import annotations

import numpy as np

from .types import GaussianComponent

_FWHM_FACTOR: float = 2.0 * np.sqrt(2.0 * np.log(2.0))


def gaussian(
    t_s: np.ndarray, amplitude_v: float, center_s: float, width_s: float
) -> np.ndarray:
    """Evalúa una gaussiana sobre el vector de tiempos `t_s`.

    `width_s` es la desviación típica, no la anchura a media altura.
    """
    if width_s <= 0.0:
        raise ValueError(f"width_s debe ser positivo, recibido {width_s}")
    z = (np.asarray(t_s, dtype=np.float64) - center_s) / width_s
    return amplitude_v * np.exp(-0.5 * z * z)


def render_component(
    t_s: np.ndarray, component: GaussianComponent, offset_s: float
) -> np.ndarray:
    """Evalúa una componente desplazada al instante de su evento."""
    return gaussian(
        t_s,
        amplitude_v=component.amplitude_v,
        center_s=offset_s + component.center_s,
        width_s=component.width_s,
    )


def fwhm_s(width_s: float) -> float:
    """Anchura a media altura de una gaussiana de desviación típica `width_s`."""
    return _FWHM_FACTOR * width_s
