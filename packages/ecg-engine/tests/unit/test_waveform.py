import numpy as np
import pytest

from ecg_engine.types import GaussianComponent, WaveTarget
from ecg_engine.waveform import fwhm_s, gaussian, render_component


def test_gaussian_peaks_at_center_with_given_amplitude():
    t = np.linspace(-0.1, 0.1, 2001)
    y = gaussian(t, amplitude_v=0.001, center_s=0.0, width_s=0.01)
    assert y.max() == pytest.approx(0.001, rel=1e-6)
    assert t[int(np.argmax(y))] == pytest.approx(0.0, abs=1e-4)


def test_gaussian_fwhm_matches_analytic_value():
    width = 0.01
    t = np.linspace(-0.2, 0.2, 40001)
    y = gaussian(t, amplitude_v=1.0, center_s=0.0, width_s=width)
    above_half = t[y >= 0.5]
    measured = above_half.max() - above_half.min()
    assert measured == pytest.approx(fwhm_s(width), rel=1e-3)


def test_fwhm_is_2_sqrt_2_ln2_times_sigma():
    assert fwhm_s(1.0) == pytest.approx(2.3548200, rel=1e-6)


def test_negative_amplitude_produces_a_trough():
    t = np.linspace(-0.05, 0.05, 1001)
    y = gaussian(t, amplitude_v=-0.0002, center_s=0.0, width_s=0.008)
    assert y.min() == pytest.approx(-0.0002, rel=1e-6)


def test_render_component_shifts_by_event_offset():
    t = np.linspace(0.0, 2.0, 2001)
    component = GaussianComponent(
        target=WaveTarget.QRS, amplitude_v=0.001, center_s=0.0, width_s=0.01
    )
    y = render_component(t, component, offset_s=1.0)
    assert t[int(np.argmax(y))] == pytest.approx(1.0, abs=1e-3)


def test_gaussian_is_vectorised_and_preserves_shape():
    t = np.linspace(-1.0, 1.0, 137)
    y = gaussian(t, amplitude_v=1.0, center_s=0.0, width_s=0.1)
    assert y.shape == t.shape
    assert y.dtype == np.float64
