"""Catálogo de ritmos. Servido directo de ecg-engine, nunca de la base de
datos: `ecg_engine.list_rhythms()` ya es la fuente de verdad versionada con
el motor. La tabla `rhythms` de Postgres solo ancla la FK de `sessions`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ecg_engine import get_rhythm as engine_get_rhythm
from ecg_engine import list_rhythms as engine_list_rhythms
from ecg_engine.catalog import RhythmDefinition

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
        clinical_description=definition.clinical_description,
        references=definition.references,
        allowed_overlays=definition.allowed_overlays,
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
