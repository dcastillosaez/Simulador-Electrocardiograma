"""Traducción de efecto combinado a estado fisiológico."""

from __future__ import annotations

import pytest

from pharmacology_engine.dynamics import apply_effect, qtc_ms
from pharmacology_engine.models import NEUTRAL_EFFECT, DrugEffect, PhysiologyState

BASE = PhysiologyState()


def test_el_efecto_neutro_no_cambia_nada() -> None:
    assert apply_effect(BASE, NEUTRAL_EFFECT) == BASE


def test_ganancia_antes_que_desplazamiento() -> None:
    """`sinus_rate` multiplica el basal y el delta se suma después."""
    state = apply_effect(
        BASE, DrugEffect(sinus_rate=1.5, heart_rate_delta_bpm=10.0)
    )
    assert state.heart_rate_bpm == pytest.approx(70.0 * 1.5 + 10.0)


def test_conduccion_lenta_alarga_el_pr() -> None:
    state = apply_effect(BASE, DrugEffect(av_conduction=0.5))
    assert state.pr_interval_ms == pytest.approx(320.0)


def test_conduccion_rapida_acorta_el_pr() -> None:
    state = apply_effect(BASE, DrugEffect(av_conduction=2.0))
    assert state.pr_interval_ms == pytest.approx(80.0)


def test_delta_de_pr_se_suma_sobre_la_conduccion() -> None:
    state = apply_effect(BASE, DrugEffect(av_conduction=0.5, pr_delta_ms=20.0))
    assert state.pr_interval_ms == pytest.approx(340.0)


def test_conduccion_ventricular_ensancha_el_qrs() -> None:
    state = apply_effect(BASE, DrugEffect(ventricular_conduction=0.75))
    assert state.qrs_duration_ms == pytest.approx(120.0)


def test_el_qt_sigue_a_la_frecuencia_conservando_el_qtc() -> None:
    """Sin esto, un taquicardizante puro dejaría un QTc imposible."""
    state = apply_effect(BASE, DrugEffect(heart_rate_delta_bpm=70.0))
    assert state.heart_rate_bpm == pytest.approx(140.0)
    assert state.qt_interval_ms < BASE.qt_interval_ms
    assert qtc_ms(state) == pytest.approx(qtc_ms(BASE), abs=1.0)


def test_delta_de_qt_se_aplica_tras_la_correccion() -> None:
    state = apply_effect(BASE, DrugEffect(qt_delta_ms=40.0))
    assert state.qt_interval_ms == pytest.approx(440.0)


def test_la_presion_de_pulso_se_ensancha() -> None:
    state = apply_effect(BASE, DrugEffect(blood_pressure_delta_mmhg=45.0))
    pulse_before = BASE.systolic_bp_mmhg - BASE.diastolic_bp_mmhg
    pulse_after = state.systolic_bp_mmhg - state.diastolic_bp_mmhg
    assert pulse_after > pulse_before


def test_el_resultado_siempre_esta_acotado() -> None:
    """Tres dosis de todo no pueden sacar al paciente del terreno de lo
    vivo: el motor de ECG recibiría parámetros injustificables."""
    brutal = DrugEffect(
        heart_rate_delta_bpm=500.0,
        sinus_rate=6.0,
        av_conduction=0.001,
        blood_pressure_delta_mmhg=400.0,
    )
    state = apply_effect(BASE, brutal)
    assert state.heart_rate_bpm <= 260.0
    assert state.pr_interval_ms <= 600.0
    assert state.systolic_bp_mmhg <= 260.0


def test_no_divide_por_cero() -> None:
    assert apply_effect(BASE, DrugEffect(av_conduction=0.0)).pr_interval_ms > 0.0
