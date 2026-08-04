"""Orquestador del motor.

Mantiene el reloj de simulación, compone la fuente del catálogo con la cadena
de ruido y acepta cambios de parámetros en caliente sin recrear nada.

El reloj avanza solo cuando se generan muestras, así que pausar la simulación
es simplemente dejar de llamar a `generate`.
"""

from __future__ import annotations

import numpy as np

from .catalog import get_rhythm
from .noise import apply_noise
from .renderer import time_grid
from .types import DEFAULT_SAMPLE_RATE_HZ, AxisParams, EngineParams, SignalSource


class EcgEngine:
    """API pública del motor fisiológico."""

    def __init__(
        self,
        rhythm_id: str,
        seed: int,
        sample_rate_hz: int = DEFAULT_SAMPLE_RATE_HZ,
        params: EngineParams | None = None,
    ) -> None:
        self._definition = get_rhythm(rhythm_id)  # lanza KeyError si no existe
        self._seed = seed
        self._sample_rate_hz = sample_rate_hz
        self._params = self._clamped(
            params
            if params is not None
            else EngineParams(
                heart_rate_hz=self._definition.default_parameters["heart_rate_hz"]
            )
        )
        self._sample_index = 0
        self._source: SignalSource = self._build_source()

    # --- construcción y estado --------------------------------------------

    def _build_source(self) -> SignalSource:
        """Cada fuente recibe su propio generador, derivado de la semilla."""
        source = self._definition.build_source(np.random.default_rng(self._seed))
        source.set_rate_hz(self._params.heart_rate_hz)
        source.set_axis(self._params.axis)
        self._noise_rng = np.random.default_rng(self._seed + 1)
        return source

    def _clamped(self, params: EngineParams) -> EngineParams:
        """Recorta frecuencia y eje a los rangos clínicos que declara el ritmo."""
        editable = self._definition.editable_parameters
        clamped_hz = editable["heart_rate_hz"].clamp(params.heart_rate_hz)
        axis = params.axis
        clamped_axis = AxisParams(
            orientation_deg=editable["orientation_deg"].clamp(axis.orientation_deg),
            p_offset_deg=editable["p_offset_deg"].clamp(axis.p_offset_deg),
            qrs_offset_deg=editable["qrs_offset_deg"].clamp(axis.qrs_offset_deg),
            st_offset_deg=editable["st_offset_deg"].clamp(axis.st_offset_deg),
            t_offset_deg=editable["t_offset_deg"].clamp(axis.t_offset_deg),
        )
        if clamped_hz == params.heart_rate_hz and clamped_axis == axis:
            return params
        return EngineParams(
            heart_rate_hz=clamped_hz,
            noise=params.noise,
            variability=params.variability,
            axis=clamped_axis,
        )

    # --- propiedades -------------------------------------------------------

    @property
    def t_s(self) -> float:
        return self._sample_index / float(self._sample_rate_hz)

    @property
    def rhythm_id(self) -> str:
        return self._definition.rhythm_id

    @property
    def seed(self) -> int:
        return self._seed

    @property
    def sample_rate_hz(self) -> int:
        return self._sample_rate_hz

    @property
    def params(self) -> EngineParams:
        return self._params

    @property
    def source(self) -> SignalSource:
        """Fuente subyacente, de solo lectura.

        La necesitan los golden signals para inspeccionar la línea de eventos
        además de las muestras. Exponerla como propiedad evita que los tests
        hurguen en atributos privados.
        """
        return self._source

    # --- operación ---------------------------------------------------------

    def update_params(self, params: EngineParams) -> None:
        """Aplica parámetros nuevos sin reiniciar la simulación."""
        self._params = self._clamped(params)
        self._source.set_rate_hz(self._params.heart_rate_hz)
        self._source.set_axis(self._params.axis)

    def reset(self) -> None:
        """Devuelve el reloj al origen y reinicia los flujos aleatorios.

        Con la misma semilla repite la señal exacta **si los parámetros no
        han cambiado**. Lo que se reinicia es el tiempo y la aleatoriedad, no
        la configuración: si antes hubo un `update_params`, la señal vuelve a
        empezar con la frecuencia vigente, no con la del catálogo. Es lo que
        conviene en un simulador —rebobinar sin perder el caso montado— pero
        conviene no confundirlo con volver al estado de fábrica.
        """
        self._sample_index = 0
        self._source = self._build_source()

    def generate(self, n_samples: int) -> np.ndarray:
        """Genera el siguiente bloque de señal y avanza el reloj."""
        if n_samples <= 0:
            raise ValueError(f"n_samples debe ser positivo, recibido {n_samples}")
        t0_s = self.t_s
        signal = self._source.render(t0_s, n_samples, self._sample_rate_hz)
        # El orquestador sí tiene el índice a mano, así que lo usa directo: es
        # la misma rejilla, bit a bit, que la que construye la fuente.
        t_s = time_grid(self._sample_index, n_samples, self._sample_rate_hz)
        signal = apply_noise(
            signal,
            t_s,
            self._params.noise,
            self._params.variability,
            self._noise_rng,
            self._sample_rate_hz,
        )
        self._sample_index += n_samples
        return signal
