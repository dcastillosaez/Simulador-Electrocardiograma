"""El catálogo YAML y su validación."""

from __future__ import annotations

import pytest

from pharmacology_engine.catalog import (
    CatalogError,
    get_drug,
    list_categories,
    list_drugs,
    parse_drug,
)
from pharmacology_engine.models import DrugCategory, Route

_MINIMAL = {
    "id": "test_drug",
    "name": "Fármaco de prueba",
    "category": "antiarrhythmic",
    "routes": ["IV"],
    "dose_unit": "mg",
    "reference_dose": 10,
    "max_cumulative_dose": 30,
    "onset_s": 10,
    "peak_s": 60,
    "duration_s": 600,
}


def test_la_biblioteca_base_esta_completa() -> None:
    """Las moléculas que la Fase F exige en su primera biblioteca."""
    expected = {
        "adenosine",
        "amiodarone",
        "lidocaine",
        "procainamide",
        "metoprolol",
        "esmolol",
        "verapamil",
        "diltiazem",
        "epinephrine",
        "norepinephrine",
        "dopamine",
        "dobutamine",
        "atropine",
        "magnesium_sulfate",
        "digoxin",
    }
    assert {d.drug_id for d in list_drugs()} == expected


def test_todas_las_categorias_tienen_representante() -> None:
    assert set(list_categories()) == set(DrugCategory)


def test_filtrado_por_categoria() -> None:
    betas = {d.drug_id for d in list_drugs(DrugCategory.BETA_BLOCKER)}
    assert betas == {"metoprolol", "esmolol"}


def test_farmaco_desconocido() -> None:
    with pytest.raises(KeyError, match="desconocido"):
        get_drug("agua_bendita")


def test_toda_molecula_tiene_nota_y_referencias() -> None:
    """Sin trazabilidad clínica no hay revisión posible por un cardiólogo,
    que es la puerta de salida de la fase."""
    for drug in list_drugs():
        assert drug.clinical_note, drug.drug_id
        assert drug.references, drug.drug_id


def test_toda_molecula_tiene_efecto() -> None:
    for drug in list_drugs():
        assert not drug.effect.is_neutral(), drug.drug_id


def test_tiempos_coherentes_en_todo_el_catalogo() -> None:
    for drug in list_drugs():
        assert 0 <= drug.onset_s <= drug.peak_s < drug.duration_s, drug.drug_id


def test_semivida_por_defecto_si_falta() -> None:
    drug = parse_drug(_MINIMAL)
    assert drug.half_life_s == pytest.approx(108.0)


def test_campo_de_efecto_desconocido() -> None:
    with pytest.raises(CatalogError, match="desconocido"):
        parse_drug({**_MINIMAL, "effects": {"presion_arterial": {"slope": 10}}})


def test_slope_en_campo_multiplicativo() -> None:
    """El error que este guardarraíl existe para atrapar: escribir un
    multiplicador donde va un delta produce números plausibles y mal."""
    with pytest.raises(CatalogError, match="multiplicativo"):
        parse_drug({**_MINIMAL, "effects": {"av_conduction": {"slope": 0.5}}})


def test_multiplier_en_campo_aditivo() -> None:
    with pytest.raises(CatalogError, match="aditivo"):
        parse_drug({**_MINIMAL, "effects": {"qt_delta_ms": {"multiplier": 1.2}}})


def test_campos_obligatorios() -> None:
    incomplete = {k: v for k, v in _MINIMAL.items() if k != "onset_s"}
    with pytest.raises(CatalogError, match="onset_s"):
        parse_drug(incomplete)


def test_categoria_desconocida() -> None:
    with pytest.raises(CatalogError, match="[Cc]ategoría"):
        parse_drug({**_MINIMAL, "category": "homeopatia"})


def test_via_desconocida() -> None:
    with pytest.raises(CatalogError, match="[Vv]ía"):
        parse_drug({**_MINIMAL, "routes": ["telepatica"]})


def test_maximo_por_debajo_de_la_referencia() -> None:
    with pytest.raises(CatalogError, match="max_cumulative_dose"):
        parse_drug({**_MINIMAL, "max_cumulative_dose": 1})


def test_via_admitida() -> None:
    assert get_drug("adenosine").allows(Route.IV)
    assert not get_drug("adenosine").allows(Route.PO)


def test_intensidad_maxima_es_el_techo_de_acumulacion() -> None:
    assert get_drug("adenosine").max_intensity == pytest.approx(5.0)
