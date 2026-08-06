"""Orquestador del motor farmacológico.

Mantiene la lista de administraciones y responde, para cualquier instante
del reloj de simulación, qué fármacos están vivos y en qué estado
fisiológico dejan al paciente.

Es una función pura del tiempo y de la lista de administraciones: no guarda
estado acumulado entre llamadas, no usa aleatoriedad y no le importa el
orden en que se le pregunte. Preguntar por `t = 30` después de haber
preguntado por `t = 120` devuelve exactamente lo mismo que si se hubiera
preguntado primero. Eso es lo que hace que el replay sea exacto y que la
persistencia solo necesite guardar la lista de administraciones.

Este módulo no importa nada de `ecg_engine`, ni directa ni indirectamente.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict

from .catalog import DrugModel, get_drug
from .dynamics import apply_effect
from .interactions import FiredInteraction, InteractionRule
from .interactions import evaluate as evaluate_interactions
from .models import (
    ActiveDrug,
    DrugAdministration,
    DrugEffect,
    PatientBaseline,
    PhysiologyState,
    Route,
    combine,
)

PHARMACOLOGY_ENGINE_VERSION = "1.0.0"
"""Se persiste junto a la sesión. Un replay solo es válido si coinciden la
semilla, la versión del motor de ECG y esta: cambiar una curva de
concentración cambia la señal sin cambiar ni una administración."""


class PharmacologyError(ValueError):
    """Base de los errores de administración, para que la API los traduzca a
    un único código de error sin enumerar subclases."""


class UnknownDrugError(PharmacologyError):
    pass


class RouteNotAllowedError(PharmacologyError):
    pass


class InvalidDoseError(PharmacologyError):
    pass


class PharmacologyEngine:
    """API pública del motor farmacológico."""

    def __init__(
        self,
        baseline: PatientBaseline | None = None,
        *,
        rules: tuple[InteractionRule, ...] | None = None,
    ) -> None:
        self._baseline = baseline or PatientBaseline()
        self._rules = rules
        self._administrations: list[DrugAdministration] = []

    # --- estado ------------------------------------------------------------

    @property
    def baseline(self) -> PatientBaseline:
        return self._baseline

    @property
    def administrations(self) -> tuple[DrugAdministration, ...]:
        """El registro completo. Nunca se poda: una administración agotada
        sigue formando parte del replay y del registro clínico."""
        return tuple(self._administrations)

    def set_baseline(self, baseline: PatientBaseline) -> None:
        """Cambia el paciente de partida sin tocar las administraciones.

        Lo llama la API cuando el usuario mueve la frecuencia de mando o
        cambia de ritmo: los fármacos siguen a bordo y su efecto se
        recalcula sobre el basal nuevo.
        """
        self._baseline = baseline

    def clear(self) -> None:
        """Vacía el registro. Solo para arrancar una sesión nueva."""
        self._administrations = []

    # --- administración -----------------------------------------------------

    def administer(
        self,
        drug_id: str,
        dose: float,
        route: Route | str,
        t_s: float,
        *,
        operator: str | None = None,
        notes: str | None = None,
        administration_id: uuid.UUID | None = None,
        wall_clock: dt.datetime | None = None,
    ) -> DrugAdministration:
        """Registra una administración y devuelve su evento.

        Valida contra el catálogo antes de aceptar nada: una vía que la
        molécula no admite o una dosis no positiva son errores del llamante,
        no estados que el motor deba representar.
        """
        try:
            drug = get_drug(drug_id)
        except KeyError as exc:
            raise UnknownDrugError(str(exc)) from exc
        try:
            resolved_route = Route(route)
        except ValueError as exc:
            raise RouteNotAllowedError(f"vía desconocida: {route!r}") from exc
        if not drug.allows(resolved_route):
            raise RouteNotAllowedError(
                f"{drug.display_name} no admite la vía {resolved_route.value}; "
                f"admitidas: {', '.join(r.value for r in drug.routes)}"
            )
        if dose <= 0.0:
            raise InvalidDoseError(f"la dosis debe ser positiva, recibido {dose}")
        if t_s < 0.0:
            raise InvalidDoseError(f"t_s no puede ser negativo, recibido {t_s}")

        administration = DrugAdministration(
            id=administration_id or uuid.uuid4(),
            drug_id=drug.drug_id,
            dose=float(dose),
            dose_unit=drug.dose_unit,
            route=resolved_route,
            t_s=float(t_s),
            operator=operator,
            notes=notes,
            wall_clock=wall_clock,
        )
        self._administrations.append(administration)
        # El orden por `t_s` no es un detalle estético: `active()` recorta
        # por ventana temporal y un replay que reinyecte administraciones
        # fuera de orden debe producir la misma lista que la sesión original.
        self._administrations.sort(key=lambda a: (a.t_s, str(a.id)))
        return administration

    def replay(self, administrations: tuple[DrugAdministration, ...]) -> None:
        """Reconstruye el registro desde la persistencia, sin revalidar.

        Sin revalidar a propósito: una sesión guardada hace meses puede
        contener una molécula que el catálogo ya no sirve, y en ese caso hay
        que fallar al calcular el efecto —donde el error dice qué fármaco
        falta— y no al cargar la lista.
        """
        self._administrations = sorted(
            administrations, key=lambda a: (a.t_s, str(a.id))
        )

    # --- consulta -----------------------------------------------------------

    def _intensities(self, t_s: float) -> dict[str, tuple[DrugModel, float, float]]:
        """Por fármaco: modelo, concentración normalizada e intensidad.

        La **concentración** es la de la administración más reciente que
        sigue viva: es lo que la barra de la interfaz debe mostrar, porque
        una segunda dosis rellena la barra. La **intensidad** suma las
        contribuciones de todas las administraciones vivas, escaladas por su
        dosis: es lo que determina el efecto. Son dos números distintos
        justamente porque acumular dosis no es lo mismo que renovar la
        curva.
        """
        result: dict[str, tuple[DrugModel, float, float]] = {}
        by_drug: dict[str, list[DrugAdministration]] = defaultdict(list)
        for administration in self._administrations:
            if administration.t_s <= t_s:
                by_drug[administration.drug_id].append(administration)

        for drug_id, administrations in by_drug.items():
            drug = get_drug(drug_id)
            intensity = 0.0
            concentration = 0.0
            alive = False
            for administration in administrations:
                elapsed = t_s - administration.t_s
                if not drug.curve.is_active(elapsed):
                    continue
                alive = True
                fraction = drug.curve.at(elapsed)
                concentration = max(concentration, fraction)
                intensity += fraction * drug.dose_ratio(administration.dose)
            if alive:
                result[drug_id] = (
                    drug,
                    concentration,
                    min(intensity, drug.max_intensity),
                )
        return result

    def active(self, t_s: float) -> tuple[ActiveDrug, ...]:
        """Fármacos vivos en `t_s`, ordenados por administración más reciente.

        Más reciente primero: es el orden en que un clínico lee la lista de
        lo que acaba de dar.
        """
        intensities = self._intensities(t_s)
        rows: list[ActiveDrug] = []
        for drug_id, (drug, concentration, intensity) in intensities.items():
            alive = [
                a
                for a in self._administrations
                if a.drug_id == drug_id and drug.curve.is_active(t_s - a.t_s)
            ]
            last_t = max(a.t_s for a in alive)
            rows.append(
                ActiveDrug(
                    drug_id=drug_id,
                    display_name=drug.display_name,
                    category=drug.category,
                    concentration=concentration,
                    intensity=intensity,
                    cumulative_dose=sum(a.dose for a in alive),
                    dose_unit=drug.dose_unit,
                    elapsed_s=t_s - last_t,
                    remaining_s=drug.curve.remaining_s(t_s - last_t),
                    administration_ids=tuple(a.id for a in alive),
                )
            )
        rows.sort(key=lambda r: (r.elapsed_s, r.drug_id))
        return tuple(rows)

    def effect_at(self, t_s: float) -> DrugEffect:
        """Efecto total: superposición de los fármacos más las interacciones."""
        effect, _ = self.effect_with_interactions(t_s)
        return effect

    def effect_with_interactions(
        self, t_s: float
    ) -> tuple[DrugEffect, tuple[FiredInteraction, ...]]:
        intensities = self._intensities(t_s)
        if not intensities:
            return combine(()), ()
        drug_effects = [
            drug.effect_at(intensity)
            for drug, _concentration, intensity in intensities.values()
        ]
        interaction_effect, fired = evaluate_interactions(
            {
                drug_id: (drug.category, intensity)
                for drug_id, (drug, _c, intensity) in intensities.items()
            },
            self._rules,
        )
        return combine([*drug_effects, interaction_effect]), fired

    def physiology_at(
        self, t_s: float, baseline: PatientBaseline | None = None
    ) -> PhysiologyState:
        """El estado fisiológico en `t_s`. La única salida del motor.

        Todo lo que el resto del sistema puede saber de la farmacología pasa
        por aquí. El motor de ECG, el corazón 3D y el panel de constantes
        consumen este objeto y ninguno recibe jamás un identificador de
        fármaco.
        """
        source = (baseline or self._baseline).state
        return apply_effect(source, self.effect_at(t_s))
