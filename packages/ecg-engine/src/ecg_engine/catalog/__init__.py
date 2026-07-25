"""Acceso al catálogo de ritmos."""

from __future__ import annotations

from .definitions import (
    DEFINITIONS,
    ParameterRange,
    RhythmCategory,
    RhythmDefinition,
)

_BY_ID: dict[str, RhythmDefinition] = {d.rhythm_id: d for d in DEFINITIONS}

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
    return DEFINITIONS


def get_rhythm(rhythm_id: str) -> RhythmDefinition:
    try:
        return _BY_ID[rhythm_id]
    except KeyError as exc:
        known = ", ".join(sorted(_BY_ID))
        raise KeyError(
            f"ritmo desconocido: {rhythm_id!r}. Conocidos: {known}"
        ) from exc
