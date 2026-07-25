import numpy as np
import pytest

from ecg_engine.noise import (
    MAINS_HZ,
    apply_clipping,
    apply_noise,
    baseline_wander,
    emg_noise,
    mains_noise,
    motion_artifact,
)
from ecg_engine.types import N_LEADS, NoiseParams, VariabilityParams


@pytest.fixture
def t_s() -> np.ndarray:
    return np.arange(5000) / 500.0  # 10 s a 500 Hz


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_mains_frequency_is_european():
    assert MAINS_HZ == 50.0


def test_all_noise_generators_return_twelve_lead_arrays(t_s, rng):
    assert emg_noise(t_s, 1e-5, rng).shape == (N_LEADS, t_s.size)
    assert mains_noise(t_s, 1e-5).shape == (N_LEADS, t_s.size)
    assert baseline_wander(t_s, 1e-4, 0.25).shape == (N_LEADS, t_s.size)


def test_emg_noise_is_independent_across_leads(t_s, rng):
    """Ruido muscular: cada electrodo capta el suyo."""
    noise = emg_noise(t_s, 1e-5, rng)
    correlation = np.corrcoef(noise[0], noise[1])[0, 1]
    assert abs(correlation) < 0.15


def test_emg_noise_scales_with_its_level(t_s, rng):
    quiet = emg_noise(t_s, 1e-6, np.random.default_rng(1))
    loud = emg_noise(t_s, 1e-4, np.random.default_rng(1))
    assert loud.std() == pytest.approx(100 * quiet.std(), rel=0.05)


def test_mains_noise_is_common_to_every_lead(t_s):
    """La interferencia de red entra por igual en todas las derivaciones."""
    noise = mains_noise(t_s, 1e-5)
    assert np.allclose(noise[0], noise[7])


def test_mains_noise_sits_at_fifty_hertz(t_s):
    noise = mains_noise(t_s, 1e-5)[0]
    spectrum = np.abs(np.fft.rfft(noise))
    freqs = np.fft.rfftfreq(noise.size, d=1 / 500.0)
    assert freqs[int(np.argmax(spectrum))] == pytest.approx(50.0, abs=0.5)


def test_baseline_wander_follows_the_respiratory_frequency(t_s):
    wander = baseline_wander(t_s, 1e-4, respiration_hz=0.25)[0]
    spectrum = np.abs(np.fft.rfft(wander))
    freqs = np.fft.rfftfreq(wander.size, d=1 / 500.0)
    assert freqs[int(np.argmax(spectrum))] == pytest.approx(0.25, abs=0.05)


def test_baseline_wander_differs_between_leads(t_s):
    """Comparte oscilador, pero su amplitud escala distinto por derivación."""
    wander = baseline_wander(t_s, 1e-4, 0.25)
    assert not np.allclose(wander[0], wander[6])


def test_motion_artifact_returns_additive_and_multiplicative_parts(t_s, rng):
    additive, multiplicative = motion_artifact(t_s, 1e-4, rng)
    assert additive.shape == (N_LEADS, t_s.size)
    assert multiplicative.shape == (N_LEADS, t_s.size)
    assert multiplicative.mean() == pytest.approx(1.0, abs=0.05)


def test_motion_artifact_comes_in_bursts_not_continuously(t_s, rng):
    """El artefacto de movimiento es esporádico: la mayor parte del registro
    está limpia."""
    additive, _ = motion_artifact(t_s, 1e-4, rng)
    quiet_fraction = np.mean(np.abs(additive[0]) < 1e-6)
    assert quiet_fraction > 0.5


def test_clipping_bounds_the_signal_symmetrically():
    signal = np.array([[-0.005, 0.0, 0.005]])
    clipped = apply_clipping(signal, clip_v=0.002)
    assert clipped.min() == pytest.approx(-0.002)
    assert clipped.max() == pytest.approx(0.002)


def test_clipping_is_a_no_op_when_disabled():
    signal = np.array([[-0.005, 0.0, 0.005]])
    assert np.array_equal(apply_clipping(signal, clip_v=None), signal)


def test_noise_free_params_leave_the_signal_untouched(t_s, rng):
    """Requisito para los tests de fisiología: con ruido a cero, la señal
    que entra es exactamente la que sale."""
    signal = np.ones((N_LEADS, t_s.size)) * 0.001
    result = apply_noise(signal, t_s, NoiseParams(), VariabilityParams(), rng)
    assert np.array_equal(result, signal)


def test_apply_noise_preserves_shape_and_dtype(t_s, rng):
    signal = np.zeros((N_LEADS, t_s.size))
    params = NoiseParams(emg_v=1e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=1e-4)
    result = apply_noise(signal, t_s, params, VariabilityParams(), rng)
    assert result.shape == signal.shape
    assert result.dtype == np.float64


def test_apply_noise_is_deterministic_for_a_given_seed(t_s):
    signal = np.zeros((N_LEADS, t_s.size))
    params = NoiseParams(emg_v=1e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=1e-4)
    first = apply_noise(
        signal, t_s, params, VariabilityParams(), np.random.default_rng(5)
    )
    second = apply_noise(
        signal, t_s, params, VariabilityParams(), np.random.default_rng(5)
    )
    assert np.array_equal(first, second)
