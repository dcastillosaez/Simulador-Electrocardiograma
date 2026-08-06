"""Farmacología dentro del `SimulationManager`, sin socket ni base de datos."""

from __future__ import annotations

import pytest

from ecg_api.errors import InvalidParamsError
from ecg_api.simulation import CHUNK_SAMPLES, SimulationManager
from ecg_engine import EngineParams

SAMPLES_PER_SECOND = 500


def _advance(manager: SimulationManager, seconds: float) -> None:
    """Avanza el reloj de simulación generando señal de verdad."""
    chunks = int(seconds * SAMPLES_PER_SECOND / CHUNK_SAMPLES)
    for _ in range(chunks):
        manager.next_chunk()


@pytest.fixture
def manager() -> SimulationManager:
    m = SimulationManager()
    m.start("sinus_normal", EngineParams(heart_rate_hz=70 / 60), seed=7)
    return m


def test_una_sesion_arranca_sin_farmacos(manager: SimulationManager) -> None:
    assert manager.administrations == ()
    payload = manager.pharmacology_payload()
    assert payload["active"] == []
    assert payload["interactions"] == []


def test_administrar_registra_y_responde(manager: SimulationManager) -> None:
    administration = manager.administer("atropine", 1.0, "IV")
    assert administration.drug_id == "atropine"
    assert manager.administrations == (administration,)
    assert manager.pharmacology_payload()["active"][0]["drug_id"] == "atropine"


def test_se_administra_en_el_reloj_de_simulacion(manager: SimulationManager) -> None:
    _advance(manager, 4.0)
    administration = manager.administer("atropine", 1.0, "IV")
    assert administration.t_s == pytest.approx(4.0, abs=0.11)


def test_farmaco_desconocido_es_invalid_params(manager: SimulationManager) -> None:
    with pytest.raises(InvalidParamsError):
        manager.administer("agua_bendita", 1.0, "IV")


def test_via_no_admitida_es_invalid_params(manager: SimulationManager) -> None:
    with pytest.raises(InvalidParamsError, match="PO"):
        manager.administer("adenosine", 6.0, "PO")


def test_el_mando_no_se_mueve_al_administrar(manager: SimulationManager) -> None:
    """La interfaz no debe ver su propio deslizador moverse solo."""
    before = manager.params
    manager.administer("atropine", 1.0, "IV")
    _advance(manager, 3.0)
    assert manager.params == before


def test_la_atropina_acelera_el_motor(manager: SimulationManager) -> None:
    manager.administer("atropine", 1.0, "IV")
    _advance(manager, 40.0)
    physiology = manager.pharmacology_payload()["physiology"]
    assert physiology["heart_rate_bpm"] > 70.0


def test_sin_farmacos_el_motor_no_se_toca() -> None:
    """Una sesión sin medicar debe recorrer el mismo camino de código que
    antes de la fase F: es la condición para que los golden del motor de
    señal sigan significando algo."""
    plain = SimulationManager()
    plain.start("sinus_normal", EngineParams(heart_rate_hz=70 / 60), seed=11)
    dosed = SimulationManager()
    dosed.start("sinus_normal", EngineParams(heart_rate_hz=70 / 60), seed=11)
    for _ in range(20):
        a = plain.next_chunk()
        b = dosed.next_chunk()
        assert (a.channels_v == b.channels_v).all()


def test_administrar_cambia_la_senal() -> None:
    """El contrapunto del test anterior: si administrar no cambiara nada, la
    integración estaría desconectada y ningún test lo notaría."""
    plain = SimulationManager()
    plain.start("sinus_normal", EngineParams(heart_rate_hz=70 / 60), seed=11)
    dosed = SimulationManager()
    dosed.start("sinus_normal", EngineParams(heart_rate_hz=70 / 60), seed=11)
    dosed.administer("epinephrine", 1.0, "IV")
    _advance(plain, 60.0)
    _advance(dosed, 60.0)
    assert not (plain.next_chunk().channels_v == dosed.next_chunk().channels_v).all()


def test_el_efecto_se_agota_solo(manager: SimulationManager) -> None:
    """La adenosina dura treinta segundos y el paciente vuelve al basal sin
    que nadie la retire."""
    manager.administer("adenosine", 6.0, "IV")
    _advance(manager, 10.0)
    assert manager.pharmacology_payload()["active"]
    _advance(manager, 25.0)
    assert manager.pharmacology_payload()["active"] == []


def test_el_registro_sobrevive_al_agotamiento(manager: SimulationManager) -> None:
    manager.administer("adenosine", 6.0, "IV")
    _advance(manager, 35.0)
    assert len(manager.administrations) == 1


def test_update_reencuadra_el_basal_sin_retirar_farmacos(
    manager: SimulationManager,
) -> None:
    manager.administer("atropine", 1.0, "IV")
    _advance(manager, 30.0)
    drugged_slow = manager.pharmacology_payload()["physiology"]["heart_rate_bpm"]
    manager.update(EngineParams(heart_rate_hz=100 / 60))
    drugged_fast = manager.pharmacology_payload()["physiology"]["heart_rate_bpm"]
    assert drugged_fast > drugged_slow
    assert len(manager.administrations) == 1


def test_el_payload_lleva_fisiologia_completa(manager: SimulationManager) -> None:
    """El canal por el que viaja lo que `EngineParams` no sabe representar."""
    manager.administer("verapamil", 5.0, "IV")
    _advance(manager, 300.0)  # el pico del verapamilo
    physiology = manager.pharmacology_payload()["physiology"]
    for key in (
        "pr_interval_ms",
        "qrs_duration_ms",
        "qt_interval_ms",
        "qtc_ms",
        "contractility",
        "systolic_bp_mmhg",
        "cardiac_output_l_min",
    ):
        assert key in physiology
    assert physiology["pr_interval_ms"] > 160.0


def test_las_interacciones_llegan_al_payload(manager: SimulationManager) -> None:
    manager.administer("verapamil", 5.0, "IV")
    manager.administer("metoprolol", 5.0, "IV")
    _advance(manager, 300.0)
    rule_ids = {i["rule_id"] for i in manager.pharmacology_payload()["interactions"]}
    assert "ccb_beta_blocker_av" in rule_ids


def test_start_reinicia_la_farmacologia(manager: SimulationManager) -> None:
    """Un `start` sobre el mismo socket es una sesión nueva: no puede
    heredar la adrenalina de la anterior."""
    manager.administer("epinephrine", 1.0, "IV")
    manager.start("sinus_normal", EngineParams(heart_rate_hz=70 / 60), seed=3)
    assert manager.administrations == ()
    assert manager.pharmacology_payload()["active"] == []
