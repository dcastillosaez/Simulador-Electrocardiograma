import json

import numpy as np
import pytest

from ecg_engine import list_rhythms

from .conftest import golden_paths, simulate

RHYTHM_IDS = [d.rhythm_id for d in list_rhythms()]
SUITES = [False, True]
SUITE_NAMES = {False: "clean", True: "noisy"}

SAMPLE_TOLERANCE_V = 1e-12
MEASUREMENT_TOLERANCE = 1e-9


@pytest.mark.parametrize("noisy", SUITES, ids=SUITE_NAMES.get)
@pytest.mark.parametrize("rhythm_id", RHYTHM_IDS)
def test_golden_samples_are_unchanged(rhythm_id, noisy):
    """Regresión de señal. Si falla sin un cambio intencional del motor,
    algo se ha roto."""
    path = golden_paths(rhythm_id, noisy)["signal"]
    if not path.exists():
        pytest.fail(
            f"falta el golden {path.name}. Genera con: "
            "uv run python tests/golden/generate_golden.py"
        )
    expected = np.load(path)
    actual = simulate(rhythm_id, noisy)["signal"]
    assert actual.shape == expected.shape
    np.testing.assert_allclose(actual, expected, atol=SAMPLE_TOLERANCE_V)


@pytest.mark.parametrize("noisy", SUITES, ids=SUITE_NAMES.get)
@pytest.mark.parametrize("rhythm_id", RHYTHM_IDS)
def test_golden_events_are_unchanged(rhythm_id, noisy):
    """Regresión de fisiología, con mensajes legibles: aquí un fallo dice
    qué evento se movió, no en qué índice del array difiere un float."""
    path = golden_paths(rhythm_id, noisy)["events"]
    expected = json.loads(path.read_text(encoding="utf-8"))
    actual = simulate(rhythm_id, noisy)["events"]
    assert [list(e) for e in actual] == expected


@pytest.mark.parametrize("noisy", SUITES, ids=SUITE_NAMES.get)
@pytest.mark.parametrize("rhythm_id", RHYTHM_IDS)
def test_golden_measurements_are_unchanged(rhythm_id, noisy):
    """Caza el caso peor: muestras casi idénticas con un intervalo desplazado."""
    path = golden_paths(rhythm_id, noisy)["measurements"]
    expected = json.loads(path.read_text(encoding="utf-8"))
    actual = simulate(rhythm_id, noisy)["measurements"]
    assert set(actual) == set(expected)
    for key, expected_value in expected.items():
        actual_value = actual[key]
        if expected_value is None:
            assert np.isnan(actual_value), f"{key} debía ser NaN"
        else:
            assert actual_value == pytest.approx(
                expected_value, abs=MEASUREMENT_TOLERANCE
            ), f"{key}: {expected_value} → {actual_value}"


def test_every_catalog_rhythm_has_golden_files():
    """Un ritmo nuevo sin golden es un ritmo sin red de seguridad."""
    missing = [
        path.name
        for rhythm_id in RHYTHM_IDS
        for noisy in SUITES
        for path in golden_paths(rhythm_id, noisy).values()
        if not path.exists()
    ]
    assert missing == []


def test_clean_and_noisy_suites_actually_differ():
    """Si coincidieran, la suite con ruido no estaría probando nada."""
    clean = simulate("sinus_normal", noisy=False)["signal"]
    noisy = simulate("sinus_normal", noisy=True)["signal"]
    assert not np.allclose(clean, noisy)


def test_clean_suite_has_no_noise_at_all():
    """Los tests de fisiología corren con el ruido a cero. Sin excepciones."""
    from .conftest import GOLDEN_SEED, GOLDEN_SAMPLE_RATE_HZ
    from ecg_engine import EcgEngine

    engine = EcgEngine(rhythm_id="sinus_normal", seed=GOLDEN_SEED)
    assert engine.params.noise.emg_v == 0.0
    assert engine.params.noise.mains_v == 0.0
    assert engine.params.noise.baseline_v == 0.0
    assert engine.params.noise.motion_v == 0.0
