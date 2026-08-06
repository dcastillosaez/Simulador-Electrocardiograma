"""Motor farmacológico del simulador de ECG (Fase F).

Completamente desacoplado del motor de señal: este paquete no importa
`ecg_engine` en ningún módulo, y el único objeto que viaja entre los dos es
`PhysiologyState`. Un fármaco nunca produce una onda; produce un cambio
fisiológico, y el ECG cambia como consecuencia.
"""

from __future__ import annotations

from .catalog import CatalogError, DrugModel, get_drug, list_categories, list_drugs
from .dynamics import apply_effect, qtc_ms
from .engine import (
    PHARMACOLOGY_ENGINE_VERSION,
    InvalidDoseError,
    PharmacologyEngine,
    PharmacologyError,
    RouteNotAllowedError,
    UnknownDrugError,
)
from .interactions import INTERACTION_RULES, FiredInteraction, InteractionRule
from .kinetics import ConcentrationCurve
from .models import (
    ActiveDrug,
    DrugAdministration,
    DrugCategory,
    DrugEffect,
    PatientBaseline,
    PhysiologyState,
    Route,
    combine,
    scale,
)

__version__ = PHARMACOLOGY_ENGINE_VERSION

__all__ = [
    "ActiveDrug",
    "CatalogError",
    "ConcentrationCurve",
    "DrugAdministration",
    "DrugCategory",
    "DrugEffect",
    "DrugModel",
    "FiredInteraction",
    "INTERACTION_RULES",
    "InteractionRule",
    "InvalidDoseError",
    "PHARMACOLOGY_ENGINE_VERSION",
    "PatientBaseline",
    "PharmacologyEngine",
    "PharmacologyError",
    "PhysiologyState",
    "Route",
    "RouteNotAllowedError",
    "UnknownDrugError",
    "apply_effect",
    "combine",
    "get_drug",
    "list_categories",
    "list_drugs",
    "qtc_ms",
    "scale",
    "__version__",
]
