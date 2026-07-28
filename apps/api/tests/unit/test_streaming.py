import asyncio

import pytest

from ecg_api.frames import decode_frame
from ecg_api.outbox import FrameOutbox
from ecg_api.simulation import SimulationManager
from ecg_api.streaming import stream_chunks


async def _run_briefly(manager, outbox, n_iterations: int, interval_s: float = 0.01):
    task = asyncio.create_task(
        stream_chunks(manager, outbox, sample_rate_hz=500, interval_s=interval_s)
    )
    await asyncio.sleep(interval_s * n_iterations * 1.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_running_manager_produces_frames_at_the_configured_cadence():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    outbox = FrameOutbox(maxsize=100)

    await _run_briefly(manager, outbox, n_iterations=5)

    assert len(outbox) >= 2  # margen frente al jitter del scheduler


async def test_frames_have_increasing_sequence_numbers_and_the_right_session():
    manager = SimulationManager()
    session_id = manager.start("sinus_normal", None, 1)
    outbox = FrameOutbox(maxsize=100)

    await _run_briefly(manager, outbox, n_iterations=5)

    n_frames = len(outbox)
    assert n_frames > 0  # si no hay frames, las comprobaciones de abajo son
    # verdad por vacuidad y el test no prueba nada
    decoded = [decode_frame(await outbox.get()) for _ in range(n_frames)]
    sequence_numbers = [d.sequence_number for d in decoded]
    assert sequence_numbers == sorted(sequence_numbers)
    assert all(d.session_id == session_id for d in decoded)


async def test_paused_manager_produces_no_new_frames():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    outbox = FrameOutbox(maxsize=100)

    await _run_briefly(manager, outbox, n_iterations=3)
    frames_before_pause = len(outbox)
    assert frames_before_pause > 0  # si no, "no crece" no significa nada
    manager.pause()
    await _run_briefly(manager, outbox, n_iterations=3)

    assert len(outbox) == frames_before_pause
