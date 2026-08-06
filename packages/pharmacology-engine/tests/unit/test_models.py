"""Álgebra de efectos y límites del estado fisiológico."""

from __future__ import annotations

import pytest

from pharmacology_engine.models import (
    NEUTRAL_EFFECT,
    PHYSIOLOGY_BOUNDS,
    DrugEffect,
    PhysiologyState,
    clamp_physiology,
    combine,
    scale,
)


def test_combinar_nada_es_el_efecto_neutro() -> None:
    assert combine(()) == NEUTRAL_EFFECT
    assert NEUTRAL_EFFECT.is_neutral()


def test_el_neutro_es_identidad() -> None:
    effect = DrugEffect(qt_delta_ms=40.0, av_conduction=0.8)
    assert combine([effect, NEUTRAL_EFFECT]) == effect


def test_aditivos_se_suman_multiplicativos_se_multiplican() -> None:
    a = DrugEffect(qt_delta_ms=40.0, av_conduction=0.8)
    b = DrugEffect(qt_delta_ms=25.0, av_conduction=0.5)
    total = combine([a, b])
    assert total.qt_delta_ms == pytest.approx(65.0)
    assert total.av_conduction == pytest.approx(0.4)


def test_la_superposicion_es_conmutativa() -> None:
    """De esto depende que el replay no tenga que conservar el orden de dos
    administraciones en el mismo instante."""
    a = DrugEffect(heart_rate_delta_bpm=30.0, contractility=1.6)
    b = DrugEffect(heart_rate_delta_bpm=-12.0, contractility=0.85)
    assert combine([a, b]) == combine([b, a])


def test_escalar_a_cero_es_el_neutro() -> None:
    assert scale(DrugEffect(qt_delta_ms=40.0, av_conduction=0.05), 0.0).is_neutral()


def test_escalar_a_uno_es_identidad() -> None:
    effect = DrugEffect(qt_delta_ms=40.0, av_conduction=0.05)
    assert scale(effect, 1.0) == effect


def test_medio_multiplicador_se_interpola_desde_uno() -> None:
    """La mitad de un multiplicador de 0.8 es 0.9, no 0.4: es una ganancia,
    no una cantidad."""
    half = scale(DrugEffect(automaticity=0.8, qt_delta_ms=40.0), 0.5)
    assert half.automaticity == pytest.approx(0.9)
    assert half.qt_delta_ms == pytest.approx(20.0)


def test_clamp_recorta_a_los_limites() -> None:
    absurd = PhysiologyState(heart_rate_bpm=900.0, qt_interval_ms=-50.0)
    clamped = clamp_physiology(absurd)
    assert clamped.heart_rate_bpm == PHYSIOLOGY_BOUNDS["heart_rate_bpm"][1]
    assert clamped.qt_interval_ms == PHYSIOLOGY_BOUNDS["qt_interval_ms"][0]


def test_clamp_ordena_las_presiones() -> None:
    """Recortar sístole y diástole por separado puede dejar una diastólica
    por encima de la sistólica, y el panel la pintaría tal cual."""
    inverted = PhysiologyState(systolic_bp_mmhg=45.0, diastolic_bp_mmhg=90.0)
    clamped = clamp_physiology(inverted)
    assert clamped.diastolic_bp_mmhg <= clamped.systolic_bp_mmhg


def test_gasto_cardiaco_derivado() -> None:
    state = PhysiologyState(heart_rate_bpm=80.0, stroke_volume_ml=70.0)
    assert state.cardiac_output_l_min == pytest.approx(5.6)


def test_presion_media() -> None:
    state = PhysiologyState(systolic_bp_mmhg=120.0, diastolic_bp_mmhg=60.0)
    assert state.mean_bp_mmhg == pytest.approx(80.0)


def test_as_dict_incluye_los_derivados() -> None:
    payload = PhysiologyState().as_dict()
    assert "cardiac_output_l_min" in payload
    assert "mean_bp_mmhg" in payload
