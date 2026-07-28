import uuid

import pytest

from ecg_api.errors import RhythmNotFoundError
from ecg_api.simulation import CHUNK_SAMPLES, SimulationManager, SimulationState
from ecg_engine import EngineParams
from ecg_engine.types import N_LEADS


def test_start_returns_a_fresh_session_id_and_sets_running():
    manager = SimulationManager()
    session_id = manager.start("sinus_normal", None, 20260725)
    assert isinstance(session_id, uuid.UUID)
    assert manager.session_id == session_id
    assert manager.state is SimulationState.RUNNING
    assert manager.rhythm_id == "sinus_normal"
    assert manager.seed == 20260725


def test_start_without_seed_assigns_one():
    manager = SimulationManager()
    manager.start("sinus_normal", None, None)
    assert isinstance(manager.seed, int)


def test_start_without_params_uses_the_rhythm_defaults():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    assert manager.params.heart_rate_hz == pytest.approx(70 / 60)


def test_start_with_unknown_rhythm_raises_the_domain_error():
    manager = SimulationManager()
    with pytest.raises(RhythmNotFoundError):
        manager.start("no_existe", None, 1)
    assert manager.state is SimulationState.STOPPED  # no quedó a medias


def test_next_chunk_has_the_documented_shape():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    chunk = manager.next_chunk()
    assert chunk.sequence_number == 0
    assert chunk.t_start_s == pytest.approx(0.0)
    assert chunk.channels_v.shape == (N_LEADS, CHUNK_SAMPLES)


def test_sequence_number_increments_and_t_start_advances():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    first = manager.next_chunk()
    second = manager.next_chunk()
    assert second.sequence_number == first.sequence_number + 1
    assert second.t_start_s == pytest.approx(first.t_start_s + CHUNK_SAMPLES / 500)


def test_update_clamps_to_the_rhythm_range_like_the_engine_does():
    manager = SimulationManager()
    manager.start("sinus_bradycardia", None, 1)
    applied = manager.update(EngineParams(heart_rate_hz=300 / 60))
    assert applied.heart_rate_hz <= 60 / 60


def test_pause_and_resume_toggle_state_without_touching_the_engine():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    manager.pause()
    assert manager.state is SimulationState.PAUSED
    manager.resume()
    assert manager.state is SimulationState.RUNNING


def test_stop_returns_the_simulated_duration():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    for _ in range(50):  # 50 chunks * 50 muestras a 500 Hz = 5,0 s simulados
        manager.next_chunk()
    duration_s = manager.stop()
    assert duration_s == pytest.approx(5.0)
    assert manager.state is SimulationState.STOPPED


def test_duration_is_simulated_time_not_wall_clock():
    """La regla de persistencia (≥5 s) mira tiempo simulado, no tiempo real:
    por eso este test tarda milisegundos en producir una sesión de 10 s."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    assert manager.duration_s == pytest.approx(0.0)
    for _ in range(100):
        manager.next_chunk()
    assert manager.duration_s == pytest.approx(10.0)
