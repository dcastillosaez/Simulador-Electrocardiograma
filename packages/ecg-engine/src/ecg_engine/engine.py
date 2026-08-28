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
from .patient import build_patient_source
from .renderer import time_grid
from typing import Mapping

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
        rng = np.random.default_rng(self._seed)
        patient = self._params.patient
        if patient is not None:
            # Un paciente inventado trae sus dos frecuencias dentro de la
            # especificación, así que no hay frecuencia de mando que
            # propagar: `set_rate_hz` movería la aurícula por detrás y
            # dejaría el trazado diciendo algo distinto de lo que el editor
            # muestra.
            source = build_patient_source(patient, rng, self._params.variability)
        else:
            source = self._definition.build_source(rng, self._params.rhythm)
            # Los ritmos con mandos propios ya nacen con su frecuencia dentro:
            # propagar además la de mando movería la aurícula de un flutter
            # por detrás, y el trazado dejaría de coincidir con lo que dicen
            # sus controles.
            if not self._definition.rhythm_parameters:
                source.set_rate_hz(self._params.heart_rate_hz)
        source.set_axis(self._params.axis)
        self._noise_rng = np.random.default_rng(self._seed + 1)
        return source

    def _clamped(self, params: EngineParams) -> EngineParams:
        """Recorta frecuencia y eje a los rangos clínicos que declara el ritmo.

        Con un paciente inventado la frecuencia no se recorta: se **deriva**.
        Su pulso es consecuencia de la conducción que el usuario ha descrito
        —una aurícula a 80 con bloqueo 2:1 son 40 latidos— y dejar que el
        mando dijera otra cosa crearía dos verdades para el mismo número.
        """
        editable = self._definition.editable_parameters
        rhythm = self._clamped_rhythm(params.rhythm)
        clamped_hz = self._resolved_rate_hz(params, rhythm)
        axis = params.axis
        clamped_axis = AxisParams(
            orientation_deg=editable["orientation_deg"].clamp(axis.orientation_deg),
            p_offset_deg=editable["p_offset_deg"].clamp(axis.p_offset_deg),
            qrs_offset_deg=editable["qrs_offset_deg"].clamp(axis.qrs_offset_deg),
            st_offset_deg=editable["st_offset_deg"].clamp(axis.st_offset_deg),
            t_offset_deg=editable["t_offset_deg"].clamp(axis.t_offset_deg),
        )
        if (
            clamped_hz == params.heart_rate_hz
            and clamped_axis == axis
            and dict(rhythm) == dict(params.rhythm)
        ):
            return params
        return EngineParams(
            heart_rate_hz=clamped_hz,
            noise=params.noise,
            variability=params.variability,
            axis=clamped_axis,
            rhythm=rhythm,
            patient=params.patient,
        )

    def _clamped_rhythm(self, rhythm: Mapping[str, float]) -> dict[str, float]:
        """Los mandos del ritmo, recortados a lo que el catálogo declara.

        Lo que llega sin estar declarado se descarta en vez de pasar de
        largo: un `conduction_ratio` en un ritmo sinusal no significa nada, y
        guardarlo lo dejaría en la fila de la sesión como si hubiera hecho
        algo.
        """
        declared = self._definition.rhythm_parameters
        return {
            name: declared[name].clamp(float(value))
            for name, value in rhythm.items()
            if name in declared
        }

    def _resolved_rate_hz(
        self, params: EngineParams, rhythm: Mapping[str, float]
    ) -> float:
        """El pulso: siempre el ventricular, venga de donde venga.

        Con un paciente inventado sale de su conducción; en un flutter, de la
        aurícula partida por el grado de bloqueo; en un bloqueo completo, del
        escape. En el resto es lo que el usuario manda.
        """
        if params.patient is not None:
            return params.patient.ventricular_rate_bpm / 60.0
        if self._definition.derived_rate_hz is not None:
            complete = {
                name: rhythm.get(name, declared.default)
                for name, declared in self._definition.rhythm_parameters.items()
            }
            return self._definition.derived_rate_hz(complete)
        return self._definition.editable_parameters["heart_rate_hz"].clamp(
            params.heart_rate_hz
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
        """Aplica parámetros nuevos sin reiniciar la simulación.

        Cambiar la descripción de un paciente inventado reconstruye su
        fuente: un PR distinto, un bloqueo nuevo o un QRS más ancho no son
        ajustes de un tren en marcha, son otro paciente. El reloj no se toca,
        así que el trazado sigue avanzando donde iba.
        """
        previous_patient = self._params.patient
        previous_rhythm = dict(self._params.rhythm)
        self._params = self._clamped(params)
        # Los mandos propios del ritmo son estructurales: cambiar el grado de
        # bloqueo de un flutter no es ajustar un tren en marcha, es montar
        # otro circuito. Se reconstruye la fuente, como con un paciente
        # inventado; el reloj sigue donde iba.
        if (
            self._params.patient != previous_patient
            or dict(self._params.rhythm) != previous_rhythm
        ):
            self._source = self._build_source()
            return
        # La misma regla que al construir: un ritmo con mandos propios no
        # recibe la frecuencia de mando. Sin esta condición, el `heart_rate_hz`
        # de un bloqueo completo —que es su escape, 40— acababa fijando la
        # frecuencia del tren auricular, y la sinusal de 75 se desplomaba a 40
        # sin que nadie hubiera tocado su control.
        if not self._definition.rhythm_parameters:
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
