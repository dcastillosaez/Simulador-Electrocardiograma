"""Catálogo de moléculas, servido desde los YAML de `data/`.

Se carga una sola vez por proceso y se cachea: el catálogo es inmutable en
tiempo de ejecución, y releer quince archivos en cada frame de una
simulación a 10 Hz sería trabajo tirado.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from ..models import DrugCategory
from .drug_model import DrugModel
from .loader import DATA_DIR, CatalogError, load_catalog, parse_drug

__all__ = [
    "CatalogError",
    "DATA_DIR",
    "DrugModel",
    "get_drug",
    "list_drugs",
    "list_categories",
    "load_catalog",
    "parse_drug",
]


@lru_cache(maxsize=1)
def _catalog() -> dict[str, DrugModel]:
    return load_catalog(Path(DATA_DIR))


def get_drug(drug_id: str) -> DrugModel:
    """Devuelve una molécula. Lanza `KeyError` con el id si no existe —el
    mismo contrato que `ecg_engine.get_rhythm`, para que la API traduzca los
    dos catálogos a 404 con el mismo código."""
    try:
        return _catalog()[drug_id]
    except KeyError as exc:
        raise KeyError(f"fármaco desconocido: {drug_id!r}") from exc


def list_drugs(category: DrugCategory | None = None) -> tuple[DrugModel, ...]:
    drugs = tuple(_catalog().values())
    if category is None:
        return drugs
    return tuple(d for d in drugs if d.category is category)


def list_categories() -> tuple[DrugCategory, ...]:
    """Categorías presentes en el catálogo, en el orden del enum.

    En el del enum y no en el de aparición: la interfaz agrupa por familia y
    el orden de una lista de filtros no debe cambiar porque alguien renombre
    un archivo.
    """
    present = {d.category for d in _catalog().values()}
    return tuple(c for c in DrugCategory if c in present)
