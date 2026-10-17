"""Farmacología por sesión: motor, basal y payload de red.

`SimulationManager` delega aquí todo lo farmacológico. La separación no es
ceremonia: permite testear la administración, la acumulación y la
proyección sin arrancar un motor de ECG ni abrir un socket, que es
exactamente lo que hace la suite unitaria.
"""

from __future__ import annotations

from dataclasses import replace

from ecg_engine import EngineParams
from ecg_engine.mechanics import MechanicalProfile, NORMAL_PROFILE
from pharmacology_engine import (
    DrugAdministration,
    PharmacologyEngine,
    PhysiologyState,
    Route,
    qtc_ms,
)

from .projection import (
    PatientVitals,
    baseline_from_params,
    circulation_adjusted,
    engine_sinus_bpm,
    project,
)


class PharmacologySession:
    """Estado farmacológico de una sesión de simulación."""

    def __init__(
        self,
        params: EngineParams,
        profile: MechanicalProfile = NORMAL_PROFILE,
        vitals: PatientVitals | None = None,
        rhythm_id: str | None = None,
    ) -> None:
        self._vitals = vitals
        # El ritmo decide por qué mando entra cada efecto: la misma atropina
        # mueve la frecuencia de un sinusal y la aurícula de un bloqueo
        # completo. Ver `RHYTHM_DRIVES`.
        self._rhythm_id = rhythm_id
        self._engine = PharmacologyEngine(
            baseline_from_params(params, vitals, rhythm_id)
        )
        self._params = params
        # El perfil mecánico del ritmo, que la farmacología no conoce ni debe
        # conocer: gobierna lo que se publica, no lo que se calcula. Ver
        # `circulation_adjusted`.
        self._profile = profile

    # --- ciclo de vida ------------------------------------------------------

    def rebase(
        self,
        params: EngineParams,
        vitals: PatientVitals | None = None,
        profile: MechanicalProfile | None = None,
    ) -> None:
        """Reencuadra el basal cuando el usuario mueve los mandos.

        Los fármacos a bordo no se tocan: su efecto se recalcula sobre el
        paciente nuevo. Subir la frecuencia con una amiodarona puesta no
        retira la amiodarona.

        El perfil mecánico también se reencuadra: a un paciente inventado se
        le puede quitar la aurícula y el escape en caliente, y eso es una
        asistolia. Conservar el del arranque seguía publicando tensión y
        gasto sobre un corazón que el 3D ya enseñaba parado.
        """
        self._params = params
        if vitals is not None:
            self._vitals = vitals
        if profile is not None:
            self._profile = profile
        self._engine.set_baseline(
            baseline_from_params(params, self._vitals, self._rhythm_id)
        )

    @property
    def baseline(self) -> PatientBaseline:
        """El paciente sin fármacos. Lo necesita el replay: reconstruir una
        sesión exige partir del mismo basal, no del que tenga por defecto un
        motor recién creado."""
        return self._engine.baseline

    @property
    def administrations(self) -> tuple[DrugAdministration, ...]:
        return self._engine.administrations

    @property
    def has_administrations(self) -> bool:
        return bool(self._engine.administrations)

    # --- operación ----------------------------------------------------------

    def administer(
        self,
        drug_id: str,
        dose: float,
        route: Route | str,
        t_s: float,
        *,
        operator: str | None = None,
        notes: str | None = None,
    ) -> DrugAdministration:
        return self._engine.administer(
            drug_id, dose, route, t_s, operator=operator, notes=notes
        )

    def physiology_at(self, t_s: float) -> PhysiologyState:
        return self._engine.physiology_at(t_s)

    def engine_params_at(self, t_s: float) -> EngineParams:
        """Parámetros con los que el motor de señal debe generar en `t_s`.

        Sin fármacos vivos devuelve los de mando **por identidad**, no por
        una proyección que dé el mismo número: `heart_rate_bpm / 60` tras
        haber hecho `heart_rate_hz * 60` no siempre reproduce el flotante de
        partida, y ese último bit basta para que la señal de una sesión sin
        medicar deje de coincidir con su golden.
        """
        if not self._engine.effect_at(t_s).is_neutral():
            return project(
                self._params,
                self._engine.physiology_at(t_s),
                rhythm_id=self._rhythm_id,
                baseline=self._engine.baseline.state,
            )
        return self._params

    # --- red ----------------------------------------------------------------

    def payload(self, t_s: float, engine_params: EngineParams | None = None) -> dict:
        """Lo que viaja por el canal JSON de farmacología.

        Un mapa abierto, como el de medidas: añadir un eje fisiológico nuevo
        no rompe a un cliente anterior, que ignora las claves que no conoce.

        Con `engine_params` —lo que el motor de señal está generando de
        verdad— la frecuencia publicada es la del trazado y no la que la
        farmacología calculó: el motor recorta al rango del ritmo y deriva el
        pulso de sus mandos, y publicar la cifra sin pasar por ahí enseñaba un
        pulso que el ECG de al lado desmentía.
        """
        state = self._engine.physiology_at(t_s)
        if engine_params is not None:
            sinus = engine_sinus_bpm(engine_params, self._rhythm_id)
            state = replace(
                state,
                heart_rate_bpm=engine_params.heart_rate_hz * 60.0,
                sinus_rate_bpm=state.sinus_rate_bpm if sinus is None else sinus,
            )
        state = circulation_adjusted(state, self._profile)
        _effect, fired = self._engine.effect_with_interactions(t_s)
        physiology = state.as_dict()
        physiology["qtc_ms"] = round(qtc_ms(state), 1)
        return {
            "type": "pharmacology",
            "t_s": round(t_s, 3),
            "active": [drug.as_dict() for drug in self._engine.active(t_s)],
            "interactions": [
                {
                    "rule_id": f.rule_id,
                    "description": f.description,
                    "intensity": f.intensity,
                    "drug_ids": list(f.drug_ids),
                }
                for f in fired
            ],
            "physiology": physiology,
        }
