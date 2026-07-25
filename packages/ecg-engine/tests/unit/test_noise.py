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
    assert emg_noise(t_s, 1e-5, rng, 500).shape == (N_LEADS, t_s.size)
    assert mains_noise(t_s, 1e-5).shape == (N_LEADS, t_s.size)
    assert baseline_wander(t_s, 1e-4, 0.25).shape == (N_LEADS, t_s.size)


def test_emg_noise_is_independent_across_leads(t_s, rng):
    """Ruido muscular: cada electrodo capta el suyo."""
    noise = emg_noise(t_s, 1e-5, rng, 500)
    correlation = np.corrcoef(noise[0], noise[1])[0, 1]
    assert abs(correlation) < 0.15


def test_emg_noise_scales_with_its_level(t_s, rng):
    quiet = emg_noise(t_s, 1e-6, np.random.default_rng(1), 500)
    loud = emg_noise(t_s, 1e-4, np.random.default_rng(1), 500)
    assert loud.std() == pytest.approx(100 * quiet.std(), rel=0.05)


def test_emg_noise_does_not_silently_vanish_on_an_odd_grid(rng):
    """La frecuencia de muestreo se recibe, no se deduce del espaciado. Con
    una rejilla descendente, deducirla daba un valor negativo y el ruido se
    desvanecía sin avisar."""
    descending = np.arange(2000)[::-1] / 500.0
    noise = emg_noise(descending, 1e-5, rng, 500)
    assert noise.std() > 0.0


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


def test_motion_artifact_returns_additive_and_multiplicative_parts(rng):
    t_long = np.arange(60 * 500) / 500.0  # 60 s, suficientes ráfagas
    additive, multiplicative = motion_artifact(t_long, 1e-4, rng, 500)
    assert additive.shape == (N_LEADS, t_long.size)
    assert multiplicative.shape == (N_LEADS, t_long.size)
    assert multiplicative.mean() == pytest.approx(1.0, abs=0.05)


def test_motion_artifact_actually_modulates_amplitude(rng):
    """Un multiplicativo que no modulase nada pasaría los tests de forma y
    de media. Aquí se exige que en algún punto reduzca la amplitud de
    verdad: es lo que ocurre cuando el contacto del electrodo empeora."""
    t_long = np.arange(60 * 500) / 500.0
    _, multiplicative = motion_artifact(t_long, 1e-4, rng, 500)
    assert multiplicative.min() < 0.95
    assert multiplicative.max() == pytest.approx(1.0)


def test_motion_artifact_comes_in_bursts_not_continuously(rng):
    """El artefacto de movimiento es esporádico: la mayor parte del registro
    está limpia. Se mira el conjunto de las doce derivaciones, no una sola,
    porque una ráfaga afecta a una derivación al azar."""
    t_long = np.arange(60 * 500) / 500.0
    additive, _ = motion_artifact(t_long, 1e-4, rng, 500)
    assert np.mean(np.abs(additive) < 1e-9) > 0.8
    assert np.abs(additive).max() > 0.0


def test_motion_artifact_affects_some_lead(rng):
    """Con ráfagas suficientes, al menos una derivación debe verse tocada."""
    t_long = np.arange(60 * 500) / 500.0
    additive, _ = motion_artifact(t_long, 1e-4, rng, 500)
    touched = [i for i in range(N_LEADS) if np.abs(additive[i]).max() > 0.0]
    assert touched


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
    result = apply_noise(signal, t_s, NoiseParams(), VariabilityParams(), rng, 500)
    assert np.array_equal(result, signal)


def test_apply_noise_preserves_shape_and_dtype(t_s, rng):
    signal = np.zeros((N_LEADS, t_s.size))
    params = NoiseParams(emg_v=1e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=1e-4)
    result = apply_noise(signal, t_s, params, VariabilityParams(), rng, 500)
    assert result.shape == signal.shape
    assert result.dtype == np.float64


def test_apply_noise_is_deterministic_for_a_given_seed(t_s):
    signal = np.zeros((N_LEADS, t_s.size))
    params = NoiseParams(emg_v=1e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=1e-4)
    first = apply_noise(
        signal, t_s, params, VariabilityParams(), np.random.default_rng(5), 500
    )
    second = apply_noise(
        signal, t_s, params, VariabilityParams(), np.random.default_rng(5), 500
    )
    assert np.array_equal(first, second)
