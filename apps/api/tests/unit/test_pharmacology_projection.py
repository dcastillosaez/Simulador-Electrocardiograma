"""La frontera entre motores: `PhysiologyState` → `EngineParams`."""

from __future__ import annotations

import pytest

from ecg_api.pharmacology import (
    baseline_from_params,
    circulation_adjusted,
    project,
)
from ecg_engine import AxisParams, EngineParams, NoiseParams, VariabilityParams
from ecg_engine.catalog import get_rhythm
from ecg_engine.mechanics import NORMAL_PROFILE
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


class TestCirculacionEfectiva:
    """Lo que el ritmo hace mecánicamente manda sobre la hemodinámica.

    Una fibrilación ventricular es una parada cardíaca: el ventrículo tiembla
    y no expulsa nada. Publicar 120/75 y 14 rpm sobre ese trazado enseña
    justo lo contrario de lo que hay que enseñar —que es una parada— y basta
    para que un clínico deje de fiarse del simulador.
    """

    def test_un_ritmo_que_bombea_no_se_toca(self) -> None:
        state = PhysiologyState()
        assert circulation_adjusted(state, NORMAL_PROFILE) is state

    def test_una_fibrilacion_ventricular_no_tiene_tension_ni_respiracion(
        self,
    ) -> None:
        adjusted = circulation_adjusted(
            PhysiologyState(), get_rhythm("ventricular_fibrillation").mechanical_profile
        )
        assert adjusted.systolic_bp_mmhg == 0.0
        assert adjusted.diastolic_bp_mmhg == 0.0
        assert adjusted.mean_bp_mmhg == 0.0
        assert adjusted.respiratory_rate_bpm == 0.0

    def test_una_fibrilacion_ventricular_no_tiene_gasto_ni_pulso(self) -> None:
        adjusted = circulation_adjusted(
            PhysiologyState(), get_rhythm("ventricular_fibrillation").mechanical_profile
        )
        assert adjusted.stroke_volume_ml == 0.0
        assert adjusted.cardiac_output_l_min == 0.0
        assert adjusted.heart_rate_bpm == 0.0

    def test_la_fibrilacion_auricular_si_bombea(self) -> None:
        """La aurícula fibrila, el ventrículo no: hay pulso y hay tensión.

        El ajuste mira la cámara que expulsa, no la que está desorganizada.
        """
        adjusted = circulation_adjusted(
            PhysiologyState(), get_rhythm("atrial_fibrillation").mechanical_profile
        )
        assert adjusted.systolic_bp_mmhg > 0.0
        assert adjusted.cardiac_output_l_min > 0.0

    def test_no_toca_lo_que_un_farmaco_todavia_puede_cambiar(self) -> None:
        """La adrenalina sigue actuando sobre un corazón en fibrilación: eso
        es justo lo que se hace en una parada. La contractilidad y los
        intervalos no son salidas hemodinámicas y se dejan en paz."""
        state = PhysiologyState(contractility=1.8, qt_interval_ms=380.0)
        adjusted = circulation_adjusted(
            state, get_rhythm("ventricular_fibrillation").mechanical_profile
        )
        assert adjusted.contractility == pytest.approx(1.8)
        assert adjusted.qt_interval_ms == pytest.approx(380.0)
