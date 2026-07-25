import pytest

from ecg_engine.beat import (
    TEMPLATES,
    get_template,
    qrs_duration_s,
    qt_duration_s,
    target_extent_s,
)
from ecg_engine.types import WaveTarget


def test_registry_contains_the_five_mvp_templates():
    assert set(TEMPLATES) == {
        "sinus_p", "flutter_f", "normal_qrst", "wide_qrst", "escape_qrst",
    }


def test_get_template_raises_with_an_explicit_message():
    with pytest.raises(KeyError, match="no_existe"):
        get_template("no_existe")


def test_atrial_template_only_has_p_components():
    template = get_template("sinus_p")
    assert {c.target for c in template.components} == {WaveTarget.P}


def test_ventricular_template_has_qrs_st_and_t():
    template = get_template("normal_qrst")
    assert {c.target for c in template.components} == {
        WaveTarget.QRS, WaveTarget.ST, WaveTarget.T,
    }


def test_normal_qrs_duration_is_physiological():
    """QRS normal: entre 80 y 100 ms."""
    duration = qrs_duration_s(get_template("normal_qrst"))
    assert 0.080 <= duration <= 0.100


def test_wide_qrs_exceeds_120_ms():
    """Criterio clínico de QRS ancho."""
    assert qrs_duration_s(get_template("wide_qrst")) > 0.120


def test_normal_qt_is_physiological():
    """QT normal a frecuencia de reposo: entre 350 y 440 ms."""
    qt = qt_duration_s(get_template("normal_qrst"))
    assert 0.350 <= qt <= 0.440


def test_target_extent_covers_two_sigma_each_side():
    template = get_template("normal_qrst")
    start, end = target_extent_s(template, WaveTarget.QRS)
    assert start < 0.0 < end


def test_target_extent_of_absent_target_is_empty():
    assert target_extent_s(get_template("sinus_p"), WaveTarget.T) == (0.0, 0.0)


def test_r_wave_is_the_dominant_positive_deflection():
    components = get_template("normal_qrst").components
    amplitudes = [c.amplitude_v for c in components]
    assert max(amplitudes) == pytest.approx(0.0010, abs=1e-4)
