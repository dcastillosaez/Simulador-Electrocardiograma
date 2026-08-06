"""Carga del catálogo desde YAML.

Los medicamentos son **datos, nunca código**: añadir una molécula es añadir
un archivo a `data/` y nada más. Este módulo es lo único que traduce esos
archivos a `DrugModel`, y valida con dureza porque es la única barrera entre
un YAML mal escrito y una sesión clínica con números inventados.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import yaml

from ..kinetics import default_half_life_s
from ..models import (
    ADDITIVE_FIELDS,
    EFFECT_FIELDS,
    MULTIPLICATIVE_FIELDS,
    DrugCategory,
    DrugEffect,
    Route,
)
from .drug_model import DrugModel

DATA_DIR = Path(__file__).parent / "data"

_REQUIRED = (
    "id",
    "name",
    "category",
    "routes",
    "dose_unit",
    "reference_dose",
    "max_cumulative_dose",
    "onset_s",
    "peak_s",
    "duration_s",
)


class CatalogError(ValueError):
    """Un YAML del catálogo no cumple el esquema. Se lanza al cargar, no al
    usar: un catálogo roto debe impedir que la API arranque."""


def _parse_effect(raw: Mapping[str, Any] | None, drug_id: str) -> DrugEffect:
    """Traduce el bloque `effects` del YAML a un `DrugEffect`.

    La forma del valor determina el tipo de campo, y se comprueba contra las
    listas de `models`: `slope` solo vale en campos aditivos y `multiplier`
    solo en multiplicativos. Sin esa comprobación, escribir
    `qt_delta_ms: {multiplier: 1.2}` produciría un QT de 1,2 ms en vez de un
    20 % más largo, y el error solo se vería mirando el trazado.
    """
    if not raw:
        return DrugEffect()
    values: dict[str, float] = {}
    for name, spec in raw.items():
        if name not in EFFECT_FIELDS:
            raise CatalogError(
                f"{drug_id}: campo de efecto desconocido {name!r}. "
                f"Válidos: {', '.join(sorted(EFFECT_FIELDS))}"
            )
        if not isinstance(spec, Mapping):
            raise CatalogError(
                f"{drug_id}.{name}: se esperaba un mapa con 'slope' o "
                f"'multiplier', recibido {spec!r}"
            )
        keys = set(spec)
        if keys == {"slope"}:
            if name not in ADDITIVE_FIELDS:
                raise CatalogError(
                    f"{drug_id}.{name}: es un campo multiplicativo; usa "
                    "'multiplier', no 'slope'"
                )
            values[name] = float(spec["slope"])
        elif keys == {"multiplier"}:
            if name not in MULTIPLICATIVE_FIELDS:
                raise CatalogError(
                    f"{drug_id}.{name}: es un campo aditivo; usa 'slope', "
                    "no 'multiplier'"
                )
            values[name] = float(spec["multiplier"])
        else:
            raise CatalogError(
                f"{drug_id}.{name}: se esperaba exactamente una clave "
                f"'slope' o 'multiplier', recibido {sorted(keys)}"
            )
    return DrugEffect(**values)


def parse_drug(raw: Mapping[str, Any], *, source: str = "<memoria>") -> DrugModel:
    missing = [key for key in _REQUIRED if key not in raw]
    if missing:
        raise CatalogError(f"{source}: faltan campos {', '.join(missing)}")
    drug_id = str(raw["id"])
    try:
        category = DrugCategory(raw["category"])
    except ValueError as exc:
        raise CatalogError(
            f"{drug_id}: categoría desconocida {raw['category']!r}"
        ) from exc
    try:
        routes = tuple(Route(r) for r in raw["routes"])
    except ValueError as exc:
        raise CatalogError(f"{drug_id}: vía desconocida en {raw['routes']!r}") from exc

    peak_s = float(raw["peak_s"])
    duration_s = float(raw["duration_s"])
    half_life_s = float(
        raw.get("half_life_s") or default_half_life_s(duration_s, peak_s)
    )
    try:
        return DrugModel(
            drug_id=drug_id,
            display_name=str(raw["name"]),
            category=category,
            routes=routes,
            dose_unit=str(raw["dose_unit"]),
            reference_dose=float(raw["reference_dose"]),
            max_cumulative_dose=float(raw["max_cumulative_dose"]),
            onset_s=float(raw["onset_s"]),
            peak_s=peak_s,
            duration_s=duration_s,
            half_life_s=half_life_s,
            effect=_parse_effect(raw.get("effects"), drug_id),
            clinical_note=str(raw.get("clinical_note", "")).strip(),
            references=tuple(raw.get("references", ())),
        )
    except ValueError as exc:  # de DrugModel o de ConcentrationCurve
        raise CatalogError(f"{source}: {exc}") from exc


def load_catalog(directory: Path | None = None) -> dict[str, DrugModel]:
    """Carga todos los `.yaml` de un directorio, ordenados por nombre.

    El orden alfabético del sistema de archivos no es determinista entre
    plataformas; `sorted` sí, y el catálogo acaba en la interfaz y en el
    replay.
    """
    directory = directory or DATA_DIR
    catalog: dict[str, DrugModel] = {}
    for path in sorted(directory.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, Mapping):
            raise CatalogError(f"{path.name}: el documento no es un mapa")
        drug = parse_drug(raw, source=path.name)
        if drug.drug_id in catalog:
            raise CatalogError(f"{path.name}: id duplicado {drug.drug_id!r}")
        catalog[drug.drug_id] = drug
    if not catalog:
        raise CatalogError(f"catálogo vacío en {directory}")
    return catalog
