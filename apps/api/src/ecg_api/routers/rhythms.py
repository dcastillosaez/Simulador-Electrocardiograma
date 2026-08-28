"""Catálogo de ritmos. Servido directo de ecg-engine, nunca de la base de
datos: `ecg_engine.list_rhythms()` ya es la fuente de verdad versionada con
el motor. La tabla `rhythms` de Postgres solo ancla la FK de `sessions`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ecg_engine import get_rhythm as engine_get_rhythm
from ecg_engine import list_rhythms as engine_list_rhythms
from ecg_engine import CUSTOM_PATIENT_ID
from ecg_engine.catalog import RhythmDefinition
from ecg_engine.custom_beat import MAX_QRS_MS, MAX_QT_MS, MIN_QRS_MS, MIN_QT_MS
from ecg_engine.measurements import MAX_CONDUCTION_PERIOD
from ecg_engine.patient import (
    MAX_PR_MS,
    MAX_RATE_BPM,
    MAX_ST_SHIFT_MV,
    MAX_T_SCALE,
    MIN_PR_MS,
)

from ..schemas import MAX_CONDUCTION_RATIO

from ..schemas import ParameterRangePayload, RhythmDetail, RhythmSummary

router = APIRouter(prefix="/api/rhythms", tags=["rhythms"])


def _to_summary(definition: RhythmDefinition) -> RhythmSummary:
    return RhythmSummary(
        rhythm_id=definition.rhythm_id,
        display_name=definition.display_name,
        category=definition.category.value,
        ventricular_rate_hz=definition.ventricular_rate_hz,
        pr_is_measurable=definition.pr_is_measurable,
    )


#: Los límites del editor de paciente, tomados uno a uno del motor. Se
#: escriben aquí y no en el frontend porque son fisiología, no presentación.
PATIENT_RANGES: dict[str, tuple[float, float, float]] = {
    "atrial_rate_bpm": (0.0, MAX_RATE_BPM, 70.0),
    "escape_rate_bpm": (0.0, MAX_RATE_BPM, 40.0),
    "conduction_ratio": (2.0, float(MAX_CONDUCTION_RATIO), 2.0),
    "wenckebach_cycle": (2.0, float(MAX_CONDUCTION_PERIOD), 4.0),
    "wenckebach_increment_ms": (0.0, 200.0, 50.0),
    "pr_ms": (MIN_PR_MS, MAX_PR_MS, 160.0),
    "qrs_ms": (MIN_QRS_MS, MAX_QRS_MS, 90.0),
    "qt_ms": (MIN_QT_MS, MAX_QT_MS, 400.0),
    "st_shift_mv": (-MAX_ST_SHIFT_MV, MAX_ST_SHIFT_MV, 0.0),
    "t_amplitude_scale": (-MAX_T_SCALE, MAX_T_SCALE, 1.0),
    "p_amplitude_scale": (0.0, MAX_T_SCALE, 1.0),
    "systolic_bp_mmhg": (0.0, 260.0, 120.0),
    "diastolic_bp_mmhg": (0.0, 200.0, 75.0),
    "respiratory_rate_bpm": (0.0, 60.0, 14.0),
    "stroke_volume_ml": (0.0, 200.0, 70.0),
}


def _to_detail(definition: RhythmDefinition) -> RhythmDetail:
    return RhythmDetail(
        **_to_summary(definition).model_dump(),
        default_parameters=dict(definition.default_parameters),
        editable_parameters={
            name: ParameterRangePayload(
                minimum=r.minimum, maximum=r.maximum, default=r.default
            )
            for name, r in definition.editable_parameters.items()
        },
        rhythm_parameters={
            name: ParameterRangePayload(
                minimum=r.minimum, maximum=r.maximum, default=r.default
            )
            for name, r in definition.rhythm_parameters.items()
        },
        clinical_description=definition.clinical_description,
        references=definition.references,
        allowed_overlays=definition.allowed_overlays,
        patient_parameters=(
            {
                name: ParameterRangePayload(
                    minimum=low, maximum=high, default=default
                )
                for name, (low, high, default) in PATIENT_RANGES.items()
            }
            if definition.rhythm_id == CUSTOM_PATIENT_ID
            else None
        ),
    )


@router.get("", response_model=list[RhythmSummary])
def list_rhythms_endpoint() -> list[RhythmSummary]:
    return [_to_summary(d) for d in engine_list_rhythms()]


@router.get("/{rhythm_id}", response_model=RhythmDetail)
def get_rhythm_endpoint(rhythm_id: str) -> RhythmDetail:
    try:
        definition = engine_get_rhythm(rhythm_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_detail(definition)
