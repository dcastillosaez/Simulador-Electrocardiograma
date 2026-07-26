import numpy as np
import pytest

from ecg_engine import EcgEngine, EngineParams, NoiseParams
from ecg_engine.types import N_LEADS


def engine(rhythm_id: str = "sinus_normal", seed: int = 20260725) -> EcgEngine:
    return EcgEngine(rhythm_id=rhythm_id, seed=seed)


def test_generate_returns_twelve_leads_of_the_requested_length():
    signal = engine().generate(500)
    assert signal.shape == (N_LEADS, 500)
    assert signal.dtype == np.float64


def test_clock_advances_by_the_generated_duration():
    eng = engine()
    assert eng.t_s == 0.0
    eng.generate(500)
    assert eng.t_s == pytest.approx(1.0)
    eng.generate(250)
    assert eng.t_s == pytest.approx(1.5)


def test_consecutive_chunks_join_without_a_discontinuity():
    """Requisito del streaming: sin esto, el trazo daría un salto cada 100 ms."""
    eng = engine()
    first = eng.generate(500)
    second = eng.generate(500)
    step = abs(second[1, 0] - first[1, -1])
    assert step < 0.0002


def test_chunked_generation_equals_a_single_large_generation():
    """La tolerancia es física, no de conveniencia. La rejilla se construye
    desde el índice de muestra, así que los trozos empalman de forma exacta;
    esta cota deja margen por si alguna ruta futura reintroduce redondeo.
    Un ECG real de 16 bits tiene un bit menos significativo de unos
    1,5·10⁻⁷ V, cien veces por encima de este umbral: cualquier diferencia
    que este test tolere es indetectable en un aparato."""
    whole = engine().generate(2500)
    chunked_engine = engine()
    chunks = [chunked_engine.generate(500) for _ in range(5)]
    assert np.allclose(whole, np.concatenate(chunks, axis=1), atol=1e-9)


def test_same_seed_and_params_reproduce_the_signal_bit_for_bit():
    """Sin esto no hay golden signals ni replay."""
    assert np.array_equal(engine(seed=42).generate(2500), engine(seed=42).generate(2500))


def test_different_seeds_produce_different_signals():
    assert not np.array_equal(
        engine(seed=1).generate(2500), engine(seed=2).generate(2500)
    )


def test_unknown_rhythm_fails_fast():
    with pytest.raises(KeyError, match="no_existe"):
        EcgEngine(rhythm_id="no_existe", seed=1)


def test_engine_starts_with_the_rhythm_default_parameters():
    assert engine().params.heart_rate_hz == pytest.approx(70 / 60)


def test_update_params_changes_the_rate_without_restarting():
    eng = engine()
    eng.generate(2500)
    t_before = eng.t_s
    # 100 lpm está dentro del rango editable del ritmo sinusal normal
    # (60-100). Pedir más lo recortaría, que es lo que comprueba el test
    # siguiente: aquí lo que se verifica es que el cambio se aplica sin
    # reiniciar el reloj.
    eng.update_params(EngineParams(heart_rate_hz=100 / 60))
    eng.generate(2500)
    assert eng.t_s == pytest.approx(t_before + 5.0)
    assert eng.params.heart_rate_hz == pytest.approx(100 / 60)


def test_update_params_clamps_the_rate_to_the_rhythm_range():
    """Una bradicardia sinusal no puede ir a 300 lpm por mucho que lo pidan."""
    eng = engine("sinus_bradycardia")
    eng.update_params(EngineParams(heart_rate_hz=300 / 60))
    assert eng.params.heart_rate_hz <= 60 / 60


def test_noise_free_engine_matches_the_clean_source():
    clean = engine().generate(1000)
    assert np.abs(clean).max() < 0.01  # sin ruido, amplitudes fisiológicas


def test_enabling_noise_increases_signal_variance():
    quiet = engine().generate(2500)
    noisy_engine = engine()
    noisy_engine.update_params(
        EngineParams(
            heart_rate_hz=70 / 60,
            noise=NoiseParams(emg_v=2e-5, mains_v=1e-5, baseline_v=1e-4),
        )
    )
    assert noisy_engine.generate(2500).std() > quiet.std()


def test_reset_returns_the_clock_and_the_signal_to_the_origin():
    eng = engine()
    first = eng.generate(1000)
    eng.generate(1000)
    eng.reset()
    assert eng.t_s == 0.0
    assert np.array_equal(eng.generate(1000), first)


def test_reset_keeps_the_parameters_in_force():
    """`reset` rebobina el tiempo y la aleatoriedad, no la configuración. En
    un simulador eso es lo útil: volver al inicio del caso sin tener que
    montarlo otra vez. Pero conviene que quede fijado, porque el nombre
    invita a pensar en un estado de fábrica que no es el que hay."""
    eng = engine()
    eng.update_params(EngineParams(heart_rate_hz=100 / 60))
    eng.generate(1000)
    eng.reset()
    assert eng.params.heart_rate_hz == pytest.approx(100 / 60)

    fresh = engine()
    assert not np.array_equal(eng.generate(1000), fresh.generate(1000))


def test_generate_rejects_a_non_positive_sample_count():
    with pytest.raises(ValueError, match="n_samples"):
        engine().generate(0)


@pytest.mark.parametrize(
    "rhythm_id",
    [
        "sinus_normal", "sinus_tachycardia", "sinus_bradycardia",
        "atrial_fibrillation", "atrial_flutter", "svt",
        "ventricular_tachycardia", "ventricular_fibrillation",
        "av_block_first", "av_block_second_mobitz_i", "av_block_third",
        "stemi_inferior",
    ],
)
def test_every_catalog_rhythm_drives_the_engine(rhythm_id):
    signal = EcgEngine(rhythm_id=rhythm_id, seed=7).generate(2500)
    assert signal.shape == (N_LEADS, 2500)
    assert np.isfinite(signal).all()
