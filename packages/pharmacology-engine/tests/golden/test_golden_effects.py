"""Golden clínicos de la Fase F.

No comprueban números exactos —que cambiarían con cualquier ajuste fino del
catálogo— sino la **dirección fisiológica** de cada molécula, que es lo que
un cardiólogo revisaría y lo que nunca puede cambiar sin ser un error:
atropina sube la frecuencia, amiodarona alarga el QT, adenosina bloquea el
nodo AV, adrenalina sube la contractilidad.

Si un ajuste de catálogo rompe uno de estos tests, el ajuste está mal.
"""

from __future__ import annotations

import pytest

from pharmacology_engine import (
    PatientBaseline,
    PharmacologyEngine,
    Route,
    list_drugs,
    qtc_ms,
)

BASE = PatientBaseline().state


def _peak(drug_id: str, dose: float, route: Route = Route.IV):
    """Estado fisiológico en el pico de acción del fármaco."""
    from pharmacology_engine import get_drug

    engine = PharmacologyEngine()
    engine.administer(drug_id, dose, route, t_s=0.0)
    return engine.physiology_at(get_drug(drug_id).peak_s)


def test_atropina_sube_la_frecuencia() -> None:
    state = _peak("atropine", 1.0)
    assert state.heart_rate_bpm > BASE.heart_rate_bpm
    assert state.pr_interval_ms < BASE.pr_interval_ms


def test_amiodarona_alarga_el_qt() -> None:
    """Alarga el QT **corregido**: el QT crudo también baja con la
    bradicardia que produce, así que mirarlo sin corregir engañaría."""
    state = _peak("amiodarone", 300.0)
    assert qtc_ms(state) > qtc_ms(BASE)
    assert state.heart_rate_bpm < BASE.heart_rate_bpm


def test_adenosina_bloquea_el_nodo_av() -> None:
    state = _peak("adenosine", 6.0)
    assert state.av_conduction < 0.2
    assert state.pr_interval_ms > BASE.pr_interval_ms
    assert state.heart_rate_bpm < BASE.heart_rate_bpm


def test_adenosina_se_agota_en_segundos() -> None:
    """Y el paciente vuelve exactamente al basal: es lo que hace de la
    adenosina un diagnóstico y no un tratamiento."""
    engine = PharmacologyEngine()
    engine.administer("adenosine", 6.0, Route.IV, t_s=0.0)
    assert engine.physiology_at(45.0) == BASE


def test_adrenalina_sube_la_contractilidad() -> None:
    state = _peak("epinephrine", 1.0)
    assert state.contractility > BASE.contractility
    assert state.heart_rate_bpm > BASE.heart_rate_bpm
    assert state.cardiac_output_l_min > BASE.cardiac_output_l_min
    assert state.oxygen_consumption > BASE.oxygen_consumption


def test_noradrenalina_sube_la_presion_sin_taquicardizar() -> None:
    state = _peak("norepinephrine", 0.1)
    assert state.mean_bp_mmhg > BASE.mean_bp_mmhg
    assert state.heart_rate_bpm <= BASE.heart_rate_bpm


def test_dobutamina_sube_el_gasto_mas_que_la_presion() -> None:
    state = _peak("dobutamine", 5.0)
    output_gain = state.cardiac_output_l_min / BASE.cardiac_output_l_min
    pressure_gain = state.mean_bp_mmhg / BASE.mean_bp_mmhg
    assert output_gain > pressure_gain


def test_betabloqueante_frena_y_baja_el_consumo() -> None:
    state = _peak("metoprolol", 5.0)
    assert state.heart_rate_bpm < BASE.heart_rate_bpm
    assert state.pr_interval_ms > BASE.pr_interval_ms
    assert state.oxygen_consumption < BASE.oxygen_consumption


def test_verapamilo_frena_el_nodo_mas_que_el_seno() -> None:
    state = _peak("verapamil", 5.0)
    pr_gain = state.pr_interval_ms / BASE.pr_interval_ms
    rate_drop = BASE.heart_rate_bpm / state.heart_rate_bpm
    assert pr_gain > rate_drop


def test_procainamida_ensancha_el_qrs() -> None:
    state = _peak("procainamide", 500.0)
    assert state.qrs_duration_ms > BASE.qrs_duration_ms
    assert qtc_ms(state) > qtc_ms(BASE)


def test_lidocaina_no_alarga_el_qt() -> None:
    """El contraejemplo: clase Ib acorta la repolarización."""
    state = _peak("lidocaine", 100.0)
    assert qtc_ms(state) < qtc_ms(BASE)


def test_magnesio_acorta_el_qt() -> None:
    state = _peak("magnesium_sulfate", 2.0)
    assert qtc_ms(state) < qtc_ms(BASE)


def test_digoxina_deja_la_cubeta_digitalica() -> None:
    """Descenso del ST con QT corto y frecuencia frenada, sin que eso sea
    intoxicación."""
    state = _peak("digoxin", 0.5)
    assert state.st_shift_mv < BASE.st_shift_mv
    assert qtc_ms(state) < qtc_ms(BASE)
    assert state.heart_rate_bpm < BASE.heart_rate_bpm
    assert state.contractility > BASE.contractility


def test_toda_molecula_deja_huella_en_su_pico() -> None:
    """Un fármaco cuyo efecto no se distingue del basal es un YAML mal
    calibrado, no un fármaco."""
    for drug in list_drugs():
        state = _peak(drug.drug_id, drug.reference_dose, drug.routes[0])
        assert state != BASE, drug.drug_id


def test_todo_el_catalogo_deja_al_paciente_vivo() -> None:
    """Dosis máxima de cada molécula, a la vez, sin salir de rangos."""
    engine = PharmacologyEngine()
    for drug in list_drugs():
        engine.administer(
            drug.drug_id, drug.max_cumulative_dose, drug.routes[0], t_s=0.0
        )
    for t in (30.0, 300.0, 3600.0):
        state = engine.physiology_at(t)
        assert 15.0 <= state.heart_rate_bpm <= 260.0
        assert 80.0 <= state.pr_interval_ms <= 600.0
        assert 240.0 <= state.qt_interval_ms <= 700.0
        assert state.diastolic_bp_mmhg <= state.systolic_bp_mmhg


def test_la_sesion_vuelve_al_basal_cuando_todo_se_agota() -> None:
    engine = PharmacologyEngine()
    for drug in list_drugs():
        engine.administer(drug.drug_id, drug.reference_dose, drug.routes[0], t_s=0.0)
    horizon = max(d.duration_s for d in list_drugs())
    assert engine.active(horizon + 1.0) == ()
    assert engine.physiology_at(horizon + 1.0) == BASE
