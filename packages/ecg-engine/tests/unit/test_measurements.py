import math

import numpy as np
import pytest

from ecg_engine.catalog import get_rhythm
from ecg_engine.measurements import Measurements, measure, qtc_bazett_s
from ecg_engine.types import LEAD_ORDER, N_LEADS, CardiacEvent, EventKind


def build(rhythm_id: str, seconds: float = 30.0, seed: int = 20260725):
    source = get_rhythm(rhythm_id).build_source(np.random.default_rng(seed))
    n_samples = int(seconds * 500)
    signal = source.render(0.0, n_samples, 500)
    events = source.events(0.0, seconds) if hasattr(source, "events") else []
    return events, signal


def test_measures_heart_rate_from_ventricular_events():
    events, signal = build("sinus_normal", seconds=60.0)
    result = measure(events, signal, 500)
    assert result.heart_rate_hz == pytest.approx(70 / 60, rel=0.05)


def test_bradycardia_measures_below_sixty_bpm():
    events, signal = build("sinus_bradycardia", seconds=60.0)
    assert measure(events, signal, 500).heart_rate_hz < 60 / 60


def test_tachycardia_measures_above_one_hundred_bpm():
    events, signal = build("sinus_tachycardia", seconds=60.0)
    assert measure(events, signal, 500).heart_rate_hz > 100 / 60


def test_rr_standard_deviation_is_small_in_sinus_rhythm():
    events, signal = build("sinus_normal", seconds=60.0)
    assert measure(events, signal, 500).rr_std_s < 0.08


def test_rr_standard_deviation_is_large_in_atrial_fibrillation():
    """La irregularidad del RR es el hallazgo que define la FA."""
    events, signal = build("atrial_fibrillation", seconds=120.0)
    assert measure(events, signal, 500).rr_std_s > 0.10


def test_pr_interval_matches_the_configured_value_in_sinus_rhythm():
    events, signal = build("sinus_normal", seconds=30.0)
    assert measure(events, signal, 500).pr_mean_s == pytest.approx(0.16, abs=0.02)


def test_first_degree_block_measures_a_pr_above_two_hundred_ms():
    events, signal = build("av_block_first", seconds=30.0)
    assert measure(events, signal, 500).pr_mean_s > 0.20


def test_complete_block_reports_no_measurable_pr():
    """Con disociación AV el PR no existe. Devolver un número medio sería
    mentir; se devuelve NaN."""
    events, signal = build("av_block_third", seconds=60.0)
    assert math.isnan(measure(events, signal, 500).pr_mean_s)


def test_ventricular_tachycardia_measures_a_wide_qrs():
    events, signal = build("ventricular_tachycardia", seconds=20.0)
    assert measure(events, signal, 500).qrs_duration_s > 0.120


def test_sinus_rhythm_measures_a_narrow_qrs():
    events, signal = build("sinus_normal", seconds=20.0)
    assert measure(events, signal, 500).qrs_duration_s < 0.120


def test_qt_is_within_the_physiological_range():
    events, signal = build("sinus_normal", seconds=20.0)
    assert 0.30 <= measure(events, signal, 500).qt_s <= 0.46


def test_r_amplitude_is_read_from_lead_two():
    events, signal = build("sinus_normal", seconds=20.0)
    result = measure(events, signal, 500)
    assert result.r_amplitude_lead_ii_v == pytest.approx(
        signal[LEAD_ORDER.index("II")].max(), rel=1e-9
    )


def test_mixed_ventricular_morphologies_report_no_single_qrs():
    """Si un trazado mezcla latidos conducidos y de escape no existe «el»
    QRS: hay dos morfologías conviviendo. Devolver la del primero sería un
    número arbitrario disfrazado de medida, exactamente igual que promediar
    un PR disociado. La arquitectura ya permite esa mezcla —una política de
    conducción más un tren de escape en la misma fuente—, así que la medida
    tiene que estar preparada aunque hoy ningún ritmo del catálogo la use."""
    events = [
        CardiacEvent(
            kind=EventKind.VENTRICULAR, t_s=0.0, template_id="normal_qrst", index=0
        ),
        CardiacEvent(
            kind=EventKind.VENTRICULAR, t_s=1.0, template_id="escape_qrst", index=1
        ),
    ]
    result = measure(events, np.zeros((N_LEADS, 1000)), 500)
    assert math.isnan(result.qrs_duration_s)
    assert math.isnan(result.qt_s)
    assert not math.isnan(result.heart_rate_hz)  # la frecuencia sí es medible


def test_measurements_without_events_report_nan_timings():
    """La fibrilación ventricular no tiene eventos discretos que medir."""
    signal = np.zeros((N_LEADS, 5000))
    result = measure([], signal, 500)
    assert math.isnan(result.heart_rate_hz)
    assert math.isnan(result.pr_mean_s)


def test_as_dict_exposes_every_field_for_the_golden_files():
    events, signal = build("sinus_normal", seconds=20.0)
    payload = measure(events, signal, 500).as_dict()
    assert set(payload) == {
        "heart_rate_hz",
        "rr_mean_s",
        "rr_std_s",
        "pr_mean_s",
        "qrs_duration_s",
        "qt_s",
        "r_amplitude_lead_ii_v",
    }
    assert all(isinstance(v, float) for v in payload.values())


def test_measurements_are_immutable():
    import dataclasses

    events, signal = build("sinus_normal", seconds=10.0)
    result = measure(events, signal, 500)
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.heart_rate_hz = 1.0


class TestQtcBazett:
    """QT corregido por frecuencia.

    Vive en el motor y no en el frontend a propósito: es una fórmula clínica,
    y el sitio de esas es el motor (ver CLAUDE.md). Se expone como función
    suelta y no como campo de `Measurements` porque añadir un campo obligaría
    a regenerar los golden measurements de los doce ritmos, que es mucha
    superficie de cambio para una raíz cuadrada.
    """

    def test_at_sixty_bpm_the_correction_is_the_identity(self):
        # RR = 1s, y la raíz de 1 es 1: a 60 lpm el QTc ES el QT. Es la
        # propiedad que hace reconocible la fórmula de un vistazo.
        assert qtc_bazett_s(0.400, 1.0) == pytest.approx(0.400)

    def test_tachycardia_stretches_the_qt(self):
        # A 100 lpm (RR = 0,6s) un QT de 360ms corregido pasa de 460ms: el
        # mismo QT que a 60 lpm seria normal, aqui es limitrofe. Esa es
        # justamente la razon de existir de la correccion.
        assert qtc_bazett_s(0.360, 0.6) == pytest.approx(0.360 / math.sqrt(0.6))
        assert qtc_bazett_s(0.360, 0.6) > 0.360

    def test_bradycardia_shrinks_the_qt(self):
        assert qtc_bazett_s(0.440, 1.5) < 0.440

    def test_a_non_measurable_input_stays_non_measurable(self):
        # measure() devuelve NaN cuando algo no es medible (disociacion AV,
        # morfologias mezcladas, sin eventos). Corregir un NaN no lo convierte
        # en un numero: la ausencia de medida se propaga.
        assert math.isnan(qtc_bazett_s(math.nan, 1.0))
        assert math.isnan(qtc_bazett_s(0.400, math.nan))

    def test_a_degenerate_rr_is_not_measurable(self):
        # Sin latidos no hay RR. Dividir por cero daria infinito y dividir por
        # un RR negativo daria un complejo: las dos cosas son peores que
        # declarar que no hay medida.
        assert math.isnan(qtc_bazett_s(0.400, 0.0))
        assert math.isnan(qtc_bazett_s(0.400, -1.0))

    def test_it_corrects_the_qt_of_a_real_simulation(self):
        events, signal = build("sinus_normal", seconds=30.0)
        result = measure(events, signal, 500)
        qtc = qtc_bazett_s(result.qt_s, result.rr_mean_s)
        # Sinusal normal ronda los 70 lpm, asi que RR < 1s y el QTc sube algo
        # sobre el QT, pero se queda dentro del rango normal (< 450ms).
        assert result.qt_s < qtc < 0.450
