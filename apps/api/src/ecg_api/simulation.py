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
from ecg_engine.mechanics import MechanicalProfile
from heart_engine import HeartState
from pharmacology_engine import DrugAdministration, PharmacologyError, Route

from .cardiac import cardiac_events_payload
from .errors import InvalidParamsError, RhythmNotFoundError
from .measuring import MeasurementWindow, measurements_payload
from .pharmacology import PatientVitals, PharmacologySession

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
        # Hasta dónde se han publicado ya contracciones. Es una marca de
        # agua, no un reloj: lo que ya salió no vuelve a salir.
        self._cardiac_published_until_s: float = 0.0
        # Los parámetros **de mando**: lo que el usuario pidió, no lo que el
        # motor está generando. Los dos coinciden mientras no haya fármacos
        # a bordo y divergen en cuanto los hay, y separarlos es lo que
        # impide que un `update` posterior tome como punto de partida una
        # frecuencia que puso la adrenalina. Es también lo que se persiste:
        # una sesión guarda las órdenes del operador y la lista de
        # administraciones, no el resultado de mezclarlas.
        self._command_params: EngineParams | None = None
        self._pharmacology: PharmacologySession | None = None
        self._vitals: PatientVitals | None = None

    def start(
        self,
        rhythm_id: str,
        params: EngineParams | None,
        seed: int | None,
        vitals: PatientVitals | None = None,
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
        # Marca de agua nueva: un ritmo nuevo arranca en t=0, y conservar la
        # del ritmo anterior se comería sus primeros latidos.
        self._cardiac_published_until_s = 0.0
        # El motor ya recortó los parámetros a los rangos del ritmo, así que
        # el mando se toma de él y no del mensaje: arrancar un bloqueo AV a
        # 300 lpm dejaría un basal farmacológico que el motor de señal nunca
        # llegó a usar.
        self._command_params = self._engine.params
        # El perfil mecánico viaja con la sesión farmacológica: es lo que hace
        # que una fibrilación ventricular publique una parada y no las
        # constantes de un paciente que camina.
        self._vitals = vitals
        self._pharmacology = PharmacologySession(
            self._command_params, self._profile(), vitals
        )
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
        """Los de mando. Es lo que se devuelve en `updated` y lo que se
        persiste: si aquí se devolviera lo que el motor está generando, la
        interfaz vería su propio deslizador moverse solo al administrar
        atropina, y una sesión guardada mezclaría órdenes con fármacos."""
        assert self._command_params is not None
        return self._command_params

    @property
    def pharmacology(self) -> PharmacologySession:
        assert self._pharmacology is not None
        return self._pharmacology

    @property
    def administrations(self) -> tuple[DrugAdministration, ...]:
        if self._pharmacology is None:
            return ()
        return self._pharmacology.administrations

    @property
    def duration_s(self) -> float:
        """Tiempo de simulación transcurrido, no tiempo de reloj de pared.

        Es lo que permite testear la regla de persistencia (≥ 5 s) sin
        esperar 5 segundos reales: generar 2500 muestras a 500 Hz produce
        5,0 s simulados casi al instante.
        """
        assert self._engine is not None
        return self._engine.t_s

    def update(
        self, params: EngineParams, vitals: PatientVitals | None = None
    ) -> EngineParams:
        assert self._engine is not None
        self._engine.update_params(params)
        # El recorte lo hace el motor, así que el mando se relee de él.
        self._command_params = self._engine.params
        if vitals is not None:
            self._vitals = vitals
        # Las constantes de un paciente inventado se editan en caliente igual
        # que sus intervalos: mover su tensión basal tiene que llegar al panel
        # sin reiniciar la sesión.
        self.pharmacology.rebase(self._command_params, self._vitals)
        # Reaplicar de inmediato: sin esto, un `update` con fármacos a bordo
        # dejaría el motor generando con la frecuencia de mando pelada hasta
        # el siguiente chunk, y se vería un salto en el trazado.
        self._apply_pharmacology()
        return self._command_params

    def administer(
        self,
        drug_id: str,
        dose: float,
        route: Route | str,
        *,
        operator: str | None = None,
        notes: str | None = None,
    ) -> DrugAdministration:
        """Administra en el instante actual del reloj de simulación.

        En el de simulación y no en el de pared: es lo que hace que un
        replay reproduzca la sesión y que una pausa no consuma fármaco.
        """
        try:
            administration = self.pharmacology.administer(
                drug_id, dose, route, self.duration_s, operator=operator, notes=notes
            )
        except PharmacologyError as exc:
            raise InvalidParamsError(str(exc)) from exc
        self._apply_pharmacology()
        return administration

    def _apply_pharmacology(self) -> None:
        """Empuja el estado fisiológico al motor de señal.

        El único punto donde la farmacología toca el ECG, y lo hace sin
        nombrar un solo fármaco: `engine_params_at` devuelve parámetros de
        motor, no moléculas.
        """
        assert self._engine is not None
        if self._pharmacology is None or not self._pharmacology.has_administrations:
            # Sin nada administrado, ni se toca el motor. Una sesión sin
            # fármacos debe recorrer exactamente el mismo camino de código
            # que antes de la Fase F, o los golden del motor de señal dejan
            # de significar nada.
            return
        self._engine.update_params(
            self.pharmacology.engine_params_at(self.duration_s)
        )

    def pharmacology_payload(self) -> dict | None:
        if self._pharmacology is None:
            return None
        return self._pharmacology.payload(self.duration_s)

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
        # La cinética avanza con el reloj, así que los parámetros se
        # recalculan en cada chunk: es lo que hace que la adenosina suba y
        # baje en treinta segundos sin que nadie la vuelva a tocar.
        self._apply_pharmacology()
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

        El calculo es del motor; aqui solo se le dan la ventana y los dos
        hechos de catalogo que el motor no puede deducir de la senal: si el
        ritmo tiene siquiera un PR que medir (un flutter no lo tiene, y su
        relacion F-QRS es tan regular que ningun guardarrail estadistico lo
        delataria) y si su actividad auricular se cuenta (las ondas f de una
        fibrilacion se generan, pero no se miden).
        """
        if self._engine is None or self._window is None:
            return None
        definition = get_rhythm(self.rhythm_id)
        return measurements_payload(
            source=self._engine.source,
            window=self._window,
            t_end_s=self._engine.t_s,
            pr_is_measurable=definition.pr_is_measurable,
            atrial_activity=definition.atrial_activity,
        )

    def _profile(self) -> MechanicalProfile:
        """El perfil mecánico vigente.

        En un paciente inventado sale de su propia descripción: quitarle la
        aurícula y el escape lo deja sin latidos, y eso es una asistolia
        aunque el catálogo diga que el ritmo personalizado bombea. La spec es
        la única que puede saberlo.
        """
        patient = self._command_params.patient if self._command_params else None
        if patient is not None:
            return patient.mechanical_profile
        return get_rhythm(self.rhythm_id).mechanical_profile

    def cardiac_events(self) -> dict | None:
        """Contracciones de la señal generada desde la última publicación.

        Nunca mira al futuro: solo traduce eventos de señal que el motor ya
        rindió. Llegan a tiempo al cliente porque su reproducción va por
        detrás de la generación lo que dure el pre-roll del buffer de jitter.
        """
        if self._engine is None:
            return None

        t_start_s = self._cardiac_published_until_s
        t_end_s = self._engine.t_s
        source = self._engine.source
        # Una FV no implementa `events`: no tiene latidos discretos que
        # enumerar. Sale una lista vacía, que es la respuesta correcta.
        events = (
            source.events(t_start_s, t_end_s) if hasattr(source, "events") else []
        )
        self._cardiac_published_until_s = t_end_s

        # Hay ritmos SIN frecuencia, y no por accidente: el catálogo declara
        # 0 lpm para la fibrilación ventricular porque una FV no tiene
        # frecuencia cardíaca. Ahí no hay RR que calcular, y tampoco hace
        # falta: ninguna de sus dos cámaras contrae de forma organizada, así
        # que `derive_mechanical_events` no llega a usar este valor. Dividir
        # sin mirar reventaba con ZeroDivisionError justo en el ritmo más
        # crítico del catálogo.
        heart_rate_hz = self._engine.params.heart_rate_hz
        rr_s = 1.0 / heart_rate_hz if heart_rate_hz > 0 else 0.0

        return cardiac_events_payload(
            events=events,
            profile=self._profile(),
            rr_s=rr_s,
            t_start_s=t_start_s,
            t_end_s=t_end_s,
        )

    def heart_state(self) -> dict | None:
        if self._engine is None:
            return None
        return HeartState.from_profile(
            self._profile(),
            self.rhythm_id,
            self._engine.params.heart_rate_hz * 60.0,
        ).as_payload()
