"""Acceso al catálogo de ritmos."""

from __future__ import annotations

from dataclasses import replace

from .definitions import (
    AXIS_PARAMETER_RANGES,
    DEFINITIONS,
    ParameterRange,
    RhythmCategory,
    RhythmDefinition,
)


def _with_axis(definition: RhythmDefinition) -> RhythmDefinition:
    """Añade los rangos del eje a `editable_parameters` sin tocar las doce
    definiciones a mano. Punto único de fusión: el catálogo entero pasa por
    aquí, así que ningún ritmo puede quedarse sin los ejes."""
    return replace(
        definition,
        editable_parameters={**definition.editable_parameters, **AXIS_PARAMETER_RANGES},
    )


_ALL: tuple[RhythmDefinition, ...] = tuple(_with_axis(d) for d in DEFINITIONS)

_BY_ID: dict[str, RhythmDefinition] = {d.rhythm_id: d for d in _ALL}

RHYTHM_IDS: tuple[str, ...] = tuple(_BY_ID)

__all__ = [
    "RHYTHM_IDS",
    "ParameterRange",
    "RhythmCategory",
    "RhythmDefinition",
    "get_rhythm",
    "list_rhythms",
]


def list_rhythms() -> tuple[RhythmDefinition, ...]:
    return _ALL


def get_rhythm(rhythm_id: str) -> RhythmDefinition:
    try:
        return _BY_ID[rhythm_id]
    except KeyError as exc:
        known = ", ".join(sorted(_BY_ID))
        raise KeyError(
            f"ritmo desconocido: {rhythm_id!r}. Conocidos: {known}"
        ) from exc
