"""Ciclo de vida del motor: administrar, acumular, agotar, repetir."""

from __future__ import annotations

import uuid

import pytest

from pharmacology_engine import (
    InvalidDoseError,
    PatientBaseline,
    PharmacologyEngine,
    PhysiologyState,
    Route,
    RouteNotAllowedError,
    UnknownDrugError,
    get_drug,
)


@pytest.fixture
def engine() -> PharmacologyEngine:
    return PharmacologyEngine()


def test_sin_farmacos_el_estado_es_el_basal(engine: PharmacologyEngine) -> None:
    assert engine.physiology_at(0.0) == PatientBaseline().state
    assert engine.effect_at(0.0).is_neutral()
    assert engine.active(0.0) == ()


def test_administrar_registra_el_evento(engine: PharmacologyEngine) -> None:
    administration = engine.administer("atropine", 1.0, Route.IV, t_s=10.0)
    assert administration.drug_id == "atropine"
    assert administration.dose_unit == "mg"
    assert engine.administrations == (administration,)


def test_farmaco_desconocido(engine: PharmacologyEngine) -> None:
    with pytest.raises(UnknownDrugError):
        engine.administer("agua_bendita", 1.0, Route.IV, t_s=0.0)


def test_via_no_admitida(engine: PharmacologyEngine) -> None:
    with pytest.raises(RouteNotAllowedError, match="PO"):
        engine.administer("adenosine", 6.0, Route.PO, t_s=0.0)


def test_dosis_no_positiva(engine: PharmacologyEngine) -> None:
    with pytest.raises(InvalidDoseError):
        engine.administer("atropine", 0.0, Route.IV, t_s=0.0)


def test_el_farmaco_no_actua_antes_de_administrarse(
    engine: PharmacologyEngine,
) -> None:
    engine.administer("atropine", 1.0, Route.IV, t_s=100.0)
    assert engine.active(50.0) == ()
    assert engine.physiology_at(50.0).heart_rate_bpm == pytest.approx(70.0)


def test_latencia_visible_sin_efecto(engine: PharmacologyEngine) -> None:
    """Recién dado: aparece en la lista con concentración cero."""
    engine.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    active = engine.active(10.0)
    assert len(active) == 1
    assert active[0].concentration == 0.0
    assert engine.effect_at(10.0).is_neutral()


def test_el_farmaco_desaparece_al_agotarse(engine: PharmacologyEngine) -> None:
    engine.administer("adenosine", 6.0, Route.IV, t_s=0.0)
    assert engine.active(10.0)
    assert engine.active(31.0) == ()
    assert engine.effect_at(31.0).is_neutral()


def test_el_registro_sobrevive_al_agotamiento(engine: PharmacologyEngine) -> None:
    """«Nunca desaparece. Forma parte del replay.»"""
    engine.administer("adenosine", 6.0, Route.IV, t_s=0.0)
    assert engine.active(1000.0) == ()
    assert len(engine.administrations) == 1


def test_dos_dosis_se_acumulan(engine: PharmacologyEngine) -> None:
    engine.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    single = engine.active(600.0)[0].intensity
    engine.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    doubled = engine.active(600.0)[0].intensity
    assert doubled == pytest.approx(2 * single)
    assert engine.active(600.0)[0].cumulative_dose == pytest.approx(600.0)


def test_la_acumulacion_tiene_techo(engine: PharmacologyEngine) -> None:
    """«hasta el límite definido por el modelo»."""
    for _ in range(10):
        engine.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    ceiling = get_drug("amiodarone").max_intensity
    assert engine.active(600.0)[0].intensity == pytest.approx(ceiling)


def test_una_segunda_dosis_rellena_la_barra(engine: PharmacologyEngine) -> None:
    """Concentración e intensidad son dos números distintos: la barra se
    llena de nuevo aunque la dosis acumulada ya fuera alta."""
    engine.administer("epinephrine", 1.0, Route.IV, t_s=0.0)
    decayed = engine.active(300.0)[0].concentration
    engine.administer("epinephrine", 1.0, Route.IV, t_s=300.0)
    refreshed = engine.active(390.0)[0].concentration
    assert refreshed > decayed
    assert refreshed == pytest.approx(1.0, abs=0.05)


def test_farmacos_distintos_se_superponen(engine: PharmacologyEngine) -> None:
    engine.administer("atropine", 1.0, Route.IV, t_s=0.0)
    engine.administer("epinephrine", 1.0, Route.IV, t_s=0.0)
    assert {d.drug_id for d in engine.active(90.0)} == {"atropine", "epinephrine"}


def test_el_orden_de_administracion_no_altera_el_resultado() -> None:
    """La condición de que el replay no tenga que conservar el orden."""
    first = PharmacologyEngine()
    first.administer("atropine", 1.0, Route.IV, t_s=0.0)
    first.administer("metoprolol", 5.0, Route.IV, t_s=0.0)
    second = PharmacologyEngine()
    second.administer("metoprolol", 5.0, Route.IV, t_s=0.0)
    second.administer("atropine", 1.0, Route.IV, t_s=0.0)
    assert first.physiology_at(300.0) == second.physiology_at(300.0)


def test_consultar_es_una_funcion_pura_del_tiempo(engine: PharmacologyEngine) -> None:
    """Preguntar hacia atrás devuelve lo mismo que preguntar hacia delante."""
    engine.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    forward = [engine.physiology_at(float(t)) for t in range(0, 900, 60)]
    backward = [engine.physiology_at(float(t)) for t in range(840, -1, -60)]
    assert forward == list(reversed(backward))


def test_replay_reconstruye_el_estado(engine: PharmacologyEngine) -> None:
    engine.administer("amiodarone", 300.0, Route.IV, t_s=30.0)
    engine.administer("magnesium_sulfate", 2.0, Route.IV, t_s=120.0)
    clone = PharmacologyEngine()
    clone.replay(engine.administrations)
    for t in (0.0, 60.0, 200.0, 1200.0):
        assert clone.physiology_at(t) == engine.physiology_at(t)


def test_el_basal_se_puede_reencuadrar(engine: PharmacologyEngine) -> None:
    """Mover la frecuencia de mando cambia el basal, no los fármacos."""
    engine.administer("atropine", 1.0, Route.IV, t_s=0.0)
    slow = engine.physiology_at(90.0, PatientBaseline().with_heart_rate(40.0))
    fast = engine.physiology_at(90.0, PatientBaseline().with_heart_rate(90.0))
    assert slow.heart_rate_bpm < fast.heart_rate_bpm


def test_set_baseline_no_toca_el_registro(engine: PharmacologyEngine) -> None:
    engine.administer("atropine", 1.0, Route.IV, t_s=0.0)
    engine.set_baseline(PatientBaseline(state=PhysiologyState(heart_rate_bpm=45.0)))
    assert len(engine.administrations) == 1
    assert engine.physiology_at(90.0).heart_rate_bpm > 45.0


def test_clear_vacia_el_registro(engine: PharmacologyEngine) -> None:
    engine.administer("atropine", 1.0, Route.IV, t_s=0.0)
    engine.clear()
    assert engine.administrations == ()
    assert engine.physiology_at(90.0) == PatientBaseline().state


def test_id_propio_para_el_replay(engine: PharmacologyEngine) -> None:
    fixed = uuid.uuid4()
    administration = engine.administer(
        "atropine", 1.0, Route.IV, t_s=0.0, administration_id=fixed
    )
    assert administration.id == fixed


def test_la_via_acepta_una_cadena(engine: PharmacologyEngine) -> None:
    assert engine.administer("atropine", 1.0, "IV", t_s=0.0).route is Route.IV
