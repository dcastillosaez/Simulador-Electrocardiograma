import numpy as np
import pytest

from ecg_engine.types import VariabilityParams
from ecg_engine.variability import amplitude_scale, next_rr_s, respiratory_phase


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_respiratory_phase_stays_within_unit_range():
    t = np.linspace(0.0, 60.0, 30001)
    phase = respiratory_phase(t, respiration_hz=0.25)
    assert phase.min() >= -1.0
    assert phase.max() <= 1.0


def test_respiratory_phase_completes_one_cycle_per_period():
    """A 0,25 Hz el ciclo dura 4 s: la fase vuelve a 0 en t=4."""
    assert respiratory_phase(0.0, 0.25) == pytest.approx(0.0, abs=1e-12)
    assert respiratory_phase(4.0, 0.25) == pytest.approx(0.0, abs=1e-9)
    assert respiratory_phase(1.0, 0.25) == pytest.approx(1.0, abs=1e-9)


def test_amplitude_scale_oscillates_around_one():
    t = np.linspace(0.0, 40.0, 20001)
    scale = amplitude_scale(t, VariabilityParams(amplitude_fraction=0.03))
    assert scale.mean() == pytest.approx(1.0, abs=1e-3)
    assert scale.max() == pytest.approx(1.03, abs=1e-3)
    assert scale.min() == pytest.approx(0.97, abs=1e-3)


def test_amplitude_scale_is_flat_when_variability_is_disabled():
    t = np.linspace(0.0, 10.0, 101)
    scale = amplitude_scale(t, VariabilityParams(amplitude_fraction=0.0))
    assert np.allclose(scale, 1.0)


def test_rr_modulation_follows_the_same_respiratory_oscillator(rng):
    """La arritmia sinusal respiratoria y la amplitud comparten oscilador:
    en el pico inspiratorio el RR se acorta y la amplitud sube."""
    params = VariabilityParams(
        respiration_hz=0.25, rsa_fraction=0.04, rr_jitter_fraction=0.0
    )
    peak_rr = next_rr_s(1.0, t_s=1.0, params=params, rng=rng)
    trough_rr = next_rr_s(1.0, t_s=3.0, params=params, rng=rng)
    assert peak_rr < trough_rr
    assert peak_rr == pytest.approx(0.96, abs=1e-6)
    assert trough_rr == pytest.approx(1.04, abs=1e-6)


def test_amplitude_and_rr_respond_to_the_same_oscillator(rng):
    """El punto arquitectónico del módulo: un solo oscilador para las dos
    cosas. En el pico inspiratorio el RR se acorta y la amplitud sube, y
    ocurre en el mismo instante porque ambas leen la misma fase. Si alguien
    desacopla `amplitude_scale` de `respiratory_phase`, esto lo ve; el test
    que solo mira el RR, no."""
    params = VariabilityParams(
        respiration_hz=0.25,
        rsa_fraction=0.04,
        amplitude_fraction=0.03,
        rr_jitter_fraction=0.0,
    )
    peak_s, trough_s = 1.0, 3.0
    scale = amplitude_scale(np.array([peak_s, trough_s]), params)

    assert scale[0] == pytest.approx(1.03, abs=1e-9)
    assert scale[1] == pytest.approx(0.97, abs=1e-9)
    assert next_rr_s(1.0, peak_s, params, rng) == pytest.approx(0.96, abs=1e-9)
    assert next_rr_s(1.0, trough_s, params, rng) == pytest.approx(1.04, abs=1e-9)


def test_rr_jitter_is_small_and_random(rng):
    params = VariabilityParams(rsa_fraction=0.0, rr_jitter_fraction=0.015)
    values = [next_rr_s(1.0, t_s=0.0, params=params, rng=rng) for _ in range(500)]
    assert np.std(values) == pytest.approx(0.015, abs=0.004)
    assert np.mean(values) == pytest.approx(1.0, abs=0.003)


def test_rr_never_goes_non_positive(rng):
    """Un jitter absurdo no debe poder producir un RR negativo."""
    params = VariabilityParams(rsa_fraction=0.0, rr_jitter_fraction=5.0)
    values = [next_rr_s(0.8, t_s=0.0, params=params, rng=rng) for _ in range(1000)]
    assert min(values) > 0.0


def test_rr_is_deterministic_for_a_given_seed():
    params = VariabilityParams()
    first = [
        next_rr_s(0.85, t_s=i * 0.85, params=params, rng=np.random.default_rng(3))
        for i in range(5)
    ]
    second = [
        next_rr_s(0.85, t_s=i * 0.85, params=params, rng=np.random.default_rng(3))
        for i in range(5)
    ]
    assert first == pytest.approx(second)
