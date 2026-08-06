"""Farmacología por sesión: motor, basal y payload de red.

`SimulationManager` delega aquí todo lo farmacológico. La separación no es
ceremonia: permite testear la administración, la acumulación y la
proyección sin arrancar un motor de ECG ni abrir un socket, que es
exactamente lo que hace la suite unitaria.
"""

from __future__ import annotations

from ecg_engine import EngineParams
from pharmacology_engine import (
    DrugAdministration,
    PharmacologyEngine,
    PhysiologyState,
    Route,
    qtc_ms,
)

from .projection import baseline_from_params, project


class PharmacologySession:
    """Estado farmacológico de una sesión de simulación."""

    def __init__(self, params: EngineParams) -> None:
        self._engine = PharmacologyEngine(baseline_from_params(params))
        self._params = params

    # --- ciclo de vida ------------------------------------------------------

    def rebase(self, params: EngineParams) -> None:
        """Reencuadra el basal cuando el usuario mueve los mandos.

        Los fármacos a bordo no se tocan: su efecto se recalcula sobre el
        paciente nuevo. Subir la frecuencia con una amiodarona puesta no
        retira la amiodarona.
        """
        self._params = params
        self._engine.set_baseline(baseline_from_params(params))

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
            return project(self._params, self._engine.physiology_at(t_s))
        return self._params

    # --- red ----------------------------------------------------------------

    def payload(self, t_s: float) -> dict:
        """Lo que viaja por el canal JSON de farmacología.

        Un mapa abierto, como el de medidas: añadir un eje fisiológico nuevo
        no rompe a un cliente anterior, que ignora las claves que no conoce.
        """
        state = self._engine.physiology_at(t_s)
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
