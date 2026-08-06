"""La frontera entre motores: `PhysiologyState` → `EngineParams`."""

from __future__ import annotations

import pytest

from ecg_api.pharmacology import baseline_from_params, project
from ecg_engine import AxisParams, EngineParams, NoiseParams, VariabilityParams
from pharmacology_engine import PhysiologyState

PARAMS = EngineParams(
    heart_rate_hz=75 / 60,
    noise=NoiseParams(emg_v=0.01),
    variability=VariabilityParams(rsa_fraction=0.09),
    axis=AxisParams(orientation_deg=30.0, qrs_offset_deg=12.0),
)


def test_el_basal_toma_la_frecuencia_de_mando() -> None:
    state = baseline_from_params(PARAMS).state
    assert state.heart_rate_bpm == pytest.approx(75.0)
    assert state.sinus_rate_bpm == pytest.approx(75.0)


def test_el_basal_toma_la_orientacion_del_eje() -> None:
    assert baseline_from_params(PARAMS).state.axis_deg == pytest.approx(30.0)


def test_la_proyeccion_conserva_ruido_y_variabilidad() -> None:
    """Describen la medición, no al paciente: ningún fármaco los toca."""
    projected = project(PARAMS, PhysiologyState(heart_rate_bpm=140.0))
    assert projected.noise == PARAMS.noise
    assert projected.variability == PARAMS.variability


def test_la_proyeccion_conserva_los_desfases_de_onda() -> None:
    """Los desfases describen el ritmo (un hemibloqueo, una isquemia), no la
    farmacología: sobreescribirlos borraría el ritmo al administrar."""
    projected = project(PARAMS, PhysiologyState(axis_deg=-20.0))
    assert projected.axis.qrs_offset_deg == pytest.approx(12.0)
    assert projected.axis.orientation_deg == pytest.approx(-20.0)


def test_la_proyeccion_traduce_la_frecuencia() -> None:
    projected = project(PARAMS, PhysiologyState(heart_rate_bpm=120.0))
    assert projected.heart_rate_hz == pytest.approx(2.0)


def test_ida_y_vuelta_sin_farmacos() -> None:
    """Sin efecto, proyectar el basal devuelve los mandos —salvo el último
    bit del flotante, que es justo la razón de que `engine_params_at`
    cortocircuite en vez de proyectar."""
    state = baseline_from_params(PARAMS).state
    projected = project(PARAMS, state)
    assert projected.heart_rate_hz == pytest.approx(PARAMS.heart_rate_hz)
    assert projected.axis.orientation_deg == pytest.approx(
        PARAMS.axis.orientation_deg
    )
