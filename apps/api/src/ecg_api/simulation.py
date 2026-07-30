"""Envoltorio del motor por conexión WebSocket.

Un `SimulationManager` no sabe nada de WebSockets, JSON ni frames binarios:
solo envuelve `EcgEngine` con el ciclo de vida que necesita una sesión y
produce chunks de señal. Esa separación es la que permite testear toda la
lógica de sesión sin abrir un solo socket.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid
from dataclasses import dataclass
from enum import Enum

import numpy as np

from ecg_engine import EcgEngine, EngineParams
from ecg_engine.catalog import get_rhythm

from .errors import RhythmNotFoundError
from .measuring import MeasurementWindow, measurements_payload

CHUNK_SAMPLES = 50  # 100 ms a 500 Hz — la cadencia de streaming del diseño
_SEED_UPPER_BOUND = 2**31


class SimulationState(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"


@dataclass(frozen=True, slots=True)
class Chunk:
    sequence_number: int
    t_start_s: float
    channels_v: np.ndarray


class SimulationManager:
    def __init__(self) -> None:
        self.session_id: uuid.UUID | None = None
        self.state: SimulationState = SimulationState.STOPPED
        self.started_at: dt.datetime | None = None
        self._engine: EcgEngine | None = None
        self._sequence_number: int = 0
        self._window: MeasurementWindow | None = None

    def start(
        self,
        rhythm_id: str,
        params: EngineParams | None,
        seed: int | None,
    ) -> uuid.UUID:
        resolved_seed = (
            seed if seed is not None else secrets.randbelow(_SEED_UPPER_BOUND)
        )
        try:
            self._engine = EcgEngine(
                rhythm_id=rhythm_id, seed=resolved_seed, params=params
            )
        except KeyError as exc:
            raise RhythmNotFoundError(str(exc)) from exc
        self.session_id = uuid.uuid4()
        self.started_at = dt.datetime.now(dt.timezone.utc)
        self._sequence_number = 0
        # Ventana nueva por sesion: un ritmo nuevo arranca un eje de tiempo
        # nuevo, y medir a caballo entre dos ritmos promediaria dos
        # fisiologias distintas.
        self._window = MeasurementWindow(self._engine.sample_rate_hz)
        self.state = SimulationState.RUNNING
        return self.session_id

    @property
    def rhythm_id(self) -> str:
        assert self._engine is not None
        return self._engine.rhythm_id

    @property
    def seed(self) -> int:
        assert self._engine is not None
        return self._engine.seed

    @property
    def params(self) -> EngineParams:
        assert self._engine is not None
        return self._engine.params

    @property
    def duration_s(self) -> float:
        """Tiempo de simulación transcurrido, no tiempo de reloj de pared.

        Es lo que permite testear la regla de persistencia (≥ 5 s) sin
        esperar 5 segundos reales: generar 2500 muestras a 500 Hz produce
        5,0 s simulados casi al instante.
        """
        assert self._engine is not None
        return self._engine.t_s

    def update(self, params: EngineParams) -> EngineParams:
        assert self._engine is not None
        self._engine.update_params(params)
        return self._engine.params

    def pause(self) -> None:
        self.state = SimulationState.PAUSED

    def resume(self) -> None:
        self.state = SimulationState.RUNNING

    def stop(self) -> float:
        self.state = SimulationState.STOPPED
        return self.duration_s

    def next_chunk(self) -> Chunk:
        """Genera el siguiente trozo. El llamante decide cuándo llamar —
        normalmente solo mientras `state is RUNNING`; pausar no es más que
        dejar de llamar aquí, igual que en `EcgEngine.generate`."""
        assert self._engine is not None
        t_start_s = self._engine.t_s
        channels_v = self._engine.generate(CHUNK_SAMPLES)
        assert self._window is not None
        self._window.append(channels_v)
        chunk = Chunk(
            sequence_number=self._sequence_number,
            t_start_s=t_start_s,
            channels_v=channels_v,
        )
        self._sequence_number += 1
        return chunk

    def measurements(self) -> dict | None:
        """Medidas de la ventana actual, o `None` si aun no hay senal.

        El calculo es del motor; aqui solo se le da la ventana y el hecho de
        catalogo que el motor no puede deducir de la senal: si el ritmo tiene
        siquiera un PR que medir (un flutter no lo tiene, y su relacion F-QRS
        es tan regular que ningun guardarrail estadistico lo delataria).
        """
        if self._engine is None or self._window is None:
            return None
        return measurements_payload(
            source=self._engine.source,
            window=self._window,
            t_end_s=self._engine.t_s,
            pr_is_measurable=get_rhythm(self.rhythm_id).pr_is_measurable,
        )
