"""Artefactos de medición.

Ruido es lo que introduce la medición, no el paciente. Nunca debe alterar los
intervalos reales del evento subyacente: si un filtro de ruido desplaza un QT,
está mal implementado.

La deriva de línea base vive aquí y no en `variability.py`, aunque se alimente
del mismo oscilador respiratorio. Es un artefacto de impedancia causado por el
movimiento del tórax: su origen es fisiológico, pero lo que registra el
aparato es un defecto de medición. Clasificarla como fisiología llevaría a
mezclar en los tests dos cosas que deben verificarse por separado.

Orden fijo de la cadena, que `apply_noise` respeta:
ruido aditivo → modulación multiplicativa → clipping.
"""

from __future__ import annotations

import numpy as np

from .types import N_LEADS, NoiseParams, VariabilityParams
from .variability import respiratory_phase

MAINS_HZ: float = 50.0
"""Frecuencia de la red eléctrica en Europa."""

_EMG_LOW_HZ: float = 20.0
_EMG_HIGH_HZ: float = 150.0
_MOTION_BURST_HZ: float = 0.08
_MOTION_BURST_DURATION_S: float = 0.6

# La deriva de línea base no entra igual en todas las derivaciones: depende de
# la posición del electrodo respecto al movimiento del tórax.
_BASELINE_LEAD_GAIN: np.ndarray = np.array(
    [0.8, 1.0, 0.9, 0.6, 0.5, 0.9, 1.2, 1.3, 1.1, 0.9, 0.8, 0.7]
).reshape(N_LEADS, 1)


def emg_noise(
    t_s: np.ndarray, level_v: float, rng: np.random.Generator
) -> np.ndarray:
    """Ruido muscular: aditivo, independiente en cada derivación.

    Se genera como ruido blanco filtrado a la banda 20-150 Hz mediante una
    máscara en el dominio de la frecuencia.
    """
    n = t_s.size
    if level_v == 0.0 or n == 0:
        return np.zeros((N_LEADS, n), dtype=np.float64)

    sample_rate_hz = 1.0 / float(np.mean(np.diff(t_s))) if n > 1 else 500.0
    white = rng.standard_normal((N_LEADS, n))
    spectrum = np.fft.rfft(white, axis=1)
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate_hz)
    band = (freqs >= _EMG_LOW_HZ) & (freqs <= _EMG_HIGH_HZ)
    spectrum[:, ~band] = 0.0
    filtered = np.fft.irfft(spectrum, n=n, axis=1)

    scale = np.std(filtered, axis=1, keepdims=True)
    scale[scale == 0.0] = 1.0
    return level_v * filtered / scale


def mains_noise(t_s: np.ndarray, level_v: float) -> np.ndarray:
    """Interferencia de red: aditiva, idéntica en todas las derivaciones."""
    trace = level_v * np.sin(2.0 * np.pi * MAINS_HZ * t_s)
    return np.tile(trace, (N_LEADS, 1))


def baseline_wander(
    t_s: np.ndarray, level_v: float, respiration_hz: float
) -> np.ndarray:
    """Deriva de línea base: aditiva, escalada por derivación."""
    trace = level_v * respiratory_phase(t_s, respiration_hz)
    return _BASELINE_LEAD_GAIN * np.tile(trace, (N_LEADS, 1))


def motion_artifact(
    t_s: np.ndarray, level_v: float, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """Artefacto de movimiento: ráfagas esporádicas, aditivas y multiplicativas.

    Devuelve `(aditivo, multiplicativo)`. El multiplicativo modula la amplitud
    del trazo durante la ráfaga, que es lo que ocurre cuando el contacto del
    electrodo empeora momentáneamente.
    """
    n = t_s.size
    additive = np.zeros((N_LEADS, n), dtype=np.float64)
    multiplicative = np.ones((N_LEADS, n), dtype=np.float64)
    if level_v == 0.0 or n == 0:
        return additive, multiplicative

    duration_s = float(t_s[-1] - t_s[0]) if n > 1 else 0.0
    sample_rate_hz = (n - 1) / duration_s if duration_s > 0 else 500.0
    burst_samples = max(1, int(_MOTION_BURST_DURATION_S * sample_rate_hz))
    n_bursts = rng.poisson(_MOTION_BURST_HZ * max(duration_s, 0.0))

    for _ in range(int(n_bursts)):
        lead = int(rng.integers(0, N_LEADS))
        start = int(rng.integers(0, max(1, n - burst_samples)))
        end = min(n, start + burst_samples)
        window = np.hanning(end - start)
        additive[lead, start:end] += level_v * window * rng.normal(1.0, 0.3)
        multiplicative[lead, start:end] *= 1.0 - 0.25 * window

    return additive, multiplicative


def apply_clipping(signal_v: np.ndarray, clip_v: float | None) -> np.ndarray:
    """Saturación simétrica del amplificador. Último paso de la cadena."""
    if clip_v is None:
        return signal_v
    return np.clip(signal_v, -clip_v, clip_v)


def apply_noise(
    signal_v: np.ndarray,
    t_s: np.ndarray,
    noise: NoiseParams,
    variability: VariabilityParams,
    rng: np.random.Generator,
) -> np.ndarray:
    """Aplica la cadena completa de artefactos, en orden fijo."""
    result = signal_v
    if noise.emg_v:
        result = result + emg_noise(t_s, noise.emg_v, rng)
    if noise.mains_v:
        result = result + mains_noise(t_s, noise.mains_v)
    if noise.baseline_v:
        result = result + baseline_wander(
            t_s, noise.baseline_v, variability.respiration_hz
        )
    if noise.motion_v:
        additive, multiplicative = motion_artifact(t_s, noise.motion_v, rng)
        result = (result + additive) * multiplicative
    return apply_clipping(result, noise.clip_v)
