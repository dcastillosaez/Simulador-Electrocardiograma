"""Motor fisiológico de generación de ECG.

Trabaja exclusivamente en unidades SI: segundos, voltios y hercios.

    from ecg_engine import EcgEngine, list_rhythms

    rhythm_id = list_rhythms()[0].rhythm_id
    engine = EcgEngine(rhythm_id=rhythm_id, seed=20260725)
    signal = engine.generate(500)   # (12, 500) en voltios
"""

from .catalog import get_rhythm, list_rhythms
from .engine import EcgEngine
from .measurements import Measurements, measure, qtc_bazett_s
from .mechanics import Chamber, ContractionMode, MechanicalProfile
from .types import (
    DEFAULT_SAMPLE_RATE_HZ,
    LEAD_ORDER,
    AxisParams,
    EngineParams,
    NoiseParams,
    VariabilityParams,
)

__version__ = "1.0.0"

__all__ = [
    "MechanicalProfile",
    "ContractionMode",
    "Chamber",
    "DEFAULT_SAMPLE_RATE_HZ",
    "LEAD_ORDER",
    "AxisParams",
    "EcgEngine",
    "EngineParams",
    "Measurements",
    "NoiseParams",
    "VariabilityParams",
    "get_rhythm",
    "list_rhythms",
    "measure",
    "qtc_bazett_s",
]
