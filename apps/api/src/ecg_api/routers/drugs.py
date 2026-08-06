"""Catálogo de fármacos e interacciones.

Servido directo de `pharmacology_engine`, igual que el de ritmos se sirve de
`ecg_engine`: los YAML versionados con el motor son la fuente de verdad y
Postgres no guarda copia. La tabla `drug_administrations` registra lo que se
administró, no qué existe.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from pharmacology_engine import DrugModel, get_drug, list_drugs
from pharmacology_engine.interactions import INTERACTION_RULES

from ..schemas import DrugDetail, DrugSummary, InteractionSummary

router = APIRouter(prefix="/api/drugs", tags=["drugs"])


def _to_summary(drug: DrugModel) -> DrugSummary:
    return DrugSummary(
        drug_id=drug.drug_id,
        display_name=drug.display_name,
        category=drug.category.value,
        routes=[r.value for r in drug.routes],
        dose_unit=drug.dose_unit,
        reference_dose=drug.reference_dose,
        max_cumulative_dose=drug.max_cumulative_dose,
        onset_s=drug.onset_s,
        peak_s=drug.peak_s,
        duration_s=drug.duration_s,
    )


def _to_detail(drug: DrugModel) -> DrugDetail:
    return DrugDetail(
        **_to_summary(drug).model_dump(),
        half_life_s=drug.half_life_s,
        clinical_note=drug.clinical_note,
        references=list(drug.references),
        # Solo los campos que la molécula toca: volcar los diecisiete
        # llenaría la ficha de ceros y unos que no dicen nada.
        effects={
            name: value
            for name, value in drug.effect.as_dict().items()
            if value not in (0.0, 1.0)
        },
    )


@router.get("", response_model=list[DrugSummary])
def list_drugs_endpoint() -> list[DrugSummary]:
    return [_to_summary(d) for d in list_drugs()]


@router.get("/interactions", response_model=list[InteractionSummary])
def list_interactions_endpoint() -> list[InteractionSummary]:
    """Va antes de `/{drug_id}` a propósito: con el orden inverso, FastAPI
    resolvería `/interactions` como un fármaco llamado «interactions» y
    devolvería un 404."""
    return [
        InteractionSummary(
            rule_id=rule.rule_id,
            description=rule.description,
            clinical_note=rule.clinical_note,
            references=list(rule.references),
            participants=[
                {
                    "drug_ids": sorted(p.drug_ids),
                    "categories": sorted(c.value for c in p.categories),
                }
                for p in rule.participants
            ],
        )
        for rule in INTERACTION_RULES
    ]


@router.get("/{drug_id}", response_model=DrugDetail)
def get_drug_endpoint(drug_id: str) -> DrugDetail:
    try:
        drug = get_drug(drug_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_detail(drug)
