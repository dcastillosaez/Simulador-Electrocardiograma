"""Fuentes de señal.

`BeatBasedSource` compone el modelo de dos trenes: un tren auricular emite
ondas P, una política de conducción decide cuáles alcanzan el ventrículo, y
una fuente de escape opcional aporta QRS cuando el nodo AV no conduce nada.
Esa composición es la que convierte once de los doce ritmos del MVP en
configuración de catálogo en lugar de en código.

`VentricularFibrillationSource` es la única excepción: en la FV no hay
latidos discretos que modelar, así que genera señal caótica continua. Aun
así implementa la misma interfaz `render`, de modo que el resto del sistema
no necesita saber que es distinta.
"""

from __future__ import annotations

from typing import Protocol, Sequence

import numpy as np

from .conduction import ConductionPolicy
from .overlays import MorphologyOverlay
from .renderer import (
    DEFAULT_PROJECTIONS,
    RENDER_MARGIN_S,
    render_events,
    time_grid,
)
from .types import N_LEADS, CardiacEvent, EventKind, VariabilityParams


class _Train(Protocol):
    """Lo que `BeatBasedSource` necesita de un tren, sea cual sea su tipo."""

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]: ...


class BeatBasedSource:
    """Fuente construida sobre eventos cardíacos discretos."""

    def __init__(
        self,
        atrial: _Train,
        conduction: ConductionPolicy,
        escape: _Train | None = None,
        overlays: Sequence[MorphologyOverlay] = (),
        variability: VariabilityParams | None = None,
        rng: np.random.Generator | None = None,
    ) -> None:
        self._atrial = atrial
        self._conduction = conduction
        self._escape = escape
        self._overlays = tuple(overlays)
        self._variability = variability
        self._rng = rng if rng is not None else np.random.default_rng(0)

    def set_rate_hz(self, rate_hz: float) -> None:
        """Propaga la frecuencia a quien la gobierne en este ritmo.

        En los ritmos con conducción 1:1 manda el tren auricular. En la
        fibrilación auricular manda el nodo AV, porque la aurícula va a su
        aire y lo que el usuario controla es la respuesta ventricular. Los
        trenes regulares ignoran el cambio: su frecuencia es estructural.
        """
        self._atrial.set_rate_hz(rate_hz)
        setter = getattr(self._conduction, "set_rate_hz", None)
        if setter is not None:
            setter(rate_hz)

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        atrial = list(self._atrial.events(t0_s, t1_s))
        # La ventana va explícita: la política no debe deducirla de `atrial`.
        # En la fibrilación auricular un trozo corto puede no contener ni una
        # onda f, y aun así tiene que sonar el latido ventricular que caiga
        # dentro.
        ventricular = self._conduction.conduct(atrial, self._rng, t0_s, t1_s)
        if self._escape is not None:
            ventricular = ventricular + list(self._escape.events(t0_s, t1_s))
        return sorted(atrial + ventricular, key=lambda e: e.t_s)

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        t_s = time_grid(t0_s, n_samples, sample_rate_hz)
        window_end_s = t0_s + n_samples / float(sample_rate_hz)
        # El margen es imprescindible: la T de un latido anterior a la ventana
        # sigue contribuyendo dentro de ella.
        events = self.events(
            max(0.0, t0_s - RENDER_MARGIN_S), window_end_s + RENDER_MARGIN_S
        )
        return render_events(
            events,
            t_s,
            DEFAULT_PROJECTIONS,
            overlays=self._overlays,
            variability=self._variability,
        )


class VentricularFibrillationSource:
    """Señal caótica continua, sin latidos discretos.

    Se genera como suma de senoides moduladas en frecuencia y amplitud en
    torno a la frecuencia dominante. `coarseness` controla la diferencia
    entre la fibrilación gruesa y la fina, que clínicamente marca el pronóstico
    y la respuesta a la desfibrilación.
    """

    _N_OSCILLATORS: int = 12

    def __init__(
        self,
        coarseness: float,
        amplitude_v: float,
        dominant_hz: float,
        rng: np.random.Generator,
    ) -> None:
        if not 0.0 < coarseness <= 1.0:
            raise ValueError(
                f"coarseness debe estar en (0, 1], recibido {coarseness}"
            )
        if not 3.0 <= dominant_hz <= 10.0:
            raise ValueError(
                f"dominant_hz debe estar entre 3 y 10, recibido {dominant_hz}"
            )
        self._coarseness = coarseness
        self._amplitude_v = amplitude_v
        self._dominant_hz = dominant_hz
        self._phases = rng.uniform(0.0, 2.0 * np.pi, self._N_OSCILLATORS)
        self._detunes = rng.normal(1.0, 0.18, self._N_OSCILLATORS)
        self._weights = rng.uniform(0.5, 1.0, self._N_OSCILLATORS)
        self._lead_gains = rng.uniform(0.6, 1.4, N_LEADS).reshape(N_LEADS, 1)
        # Amplitud eficaz analítica de la suma de senoides con fases
        # independientes. Es una constante calculada aquí, no una medida
        # tomada sobre cada trozo: medirla trozo a trozo daría un factor de
        # escala distinto en cada uno y el trazo daría un salto en cada
        # frontera. Dividir por la suma de pesos, en cambio, encoge la señal
        # unas cuatro veces y la deja pegada a la línea de base.
        self._norm = float(np.sqrt(np.sum(self._weights**2) / 2.0))

    def set_rate_hz(self, rate_hz: float) -> None:
        """La FV no tiene frecuencia cardíaca. El control no aplica."""
        return None

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        t_s = time_grid(t0_s, n_samples, sample_rate_hz)
        trace = np.zeros_like(t_s)
        for phase, detune, weight in zip(
            self._phases, self._detunes, self._weights
        ):
            freq_hz = self._dominant_hz * detune
            trace += weight * np.sin(2.0 * np.pi * freq_hz * t_s + phase)
        trace /= self._norm

        # La envolvente modula la amplitud, pero nunca llega a apagarla: en
        # la fibrilación ventricular no hay línea isoeléctrica, la señal no
        # descansa jamás. Una envolvente profunda dejaba tramos de calma que
        # no existen en un paciente en FV.
        envelope = 1.0 + 0.30 * np.sin(2.0 * np.pi * 0.7 * t_s + self._phases[0])

        # La fibrilación gruesa tiene excursiones amplias; la fina, una
        # ondulación menuda y de bajo voltaje. Esa diferencia marca el
        # pronóstico y la respuesta a la desfibrilación.
        trace = trace * envelope * self._coarseness

        return self._lead_gains * (self._amplitude_v * trace)[np.newaxis, :]
