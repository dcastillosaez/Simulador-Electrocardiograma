"""Upsert del catálogo de código a la tabla `rhythms`.

La tabla no es la fuente de verdad — lo es `ecg_engine.list_rhythms()` —
sino el ancla de la FK de `sessions`. Se rellena aquí, al arrancar la
aplicación, nunca a mano ni desde una migración de datos.
"""

from __future__ import annotations

import ecg_engine
from ecg_engine.catalog import RhythmDefinition
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from .models import RhythmRow


def _rhythm_spec(definition: RhythmDefinition) -> dict:
    return {
        "default_parameters": dict(definition.default_parameters),
        "editable_parameters": {
            name: {
                "minimum": r.minimum,
                "maximum": r.maximum,
                "default": r.default,
            }
            for name, r in definition.editable_parameters.items()
        },
        "ventricular_rate_hz": definition.ventricular_rate_hz,
        "pr_is_measurable": definition.pr_is_measurable,
        "clinical_description": definition.clinical_description,
        "references": list(definition.references),
        "allowed_overlays": list(definition.allowed_overlays),
    }


async def seed_catalog(session: AsyncSession, settings: Settings) -> None:
    for definition in ecg_engine.list_rhythms():
        stmt = insert(RhythmRow).values(
            id=definition.rhythm_id,
            name=definition.display_name,
            category=definition.category.value,
            spec=_rhythm_spec(definition),
            engine_semver=ecg_engine.__version__,
            engine_commit=settings.engine_commit,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[RhythmRow.id],
            set_={
                "name": stmt.excluded.name,
                "category": stmt.excluded.category,
                "spec": stmt.excluded.spec,
                "engine_semver": stmt.excluded.engine_semver,
                "engine_commit": stmt.excluded.engine_commit,
            },
        )
        await session.execute(stmt)
    await session.commit()
