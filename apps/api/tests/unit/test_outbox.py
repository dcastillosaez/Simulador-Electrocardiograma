import asyncio

import pytest

from ecg_api.outbox import FrameOutbox


def test_put_and_get_preserve_count_under_capacity():
    outbox = FrameOutbox(maxsize=5)
    outbox.put(b"a")
    outbox.put(b"b")
    assert len(outbox) == 2


def test_put_drops_the_oldest_frame_when_full():
    outbox = FrameOutbox(maxsize=3)
    for i in range(5):
        outbox.put(bytes([i]))
    assert len(outbox) == 3
    assert outbox.dropped_count == 2


async def test_get_returns_frames_in_fifo_order():
    outbox = FrameOutbox(maxsize=5)
    outbox.put(b"first")
    outbox.put(b"second")
    assert await outbox.get() == b"first"
    assert await outbox.get() == b"second"


def test_full_outbox_keeps_the_newest_frames_not_the_oldest():
    """La política es descartar lo más antiguo. Si se descartara lo más
    nuevo, un cliente lento vería la simulación congelada en el pasado en
    vez de saltar hacia el presente al ponerse al día."""
    outbox = FrameOutbox(maxsize=2)
    outbox.put(b"oldest")
    outbox.put(b"middle")
    outbox.put(b"newest")
    assert list(outbox._frames) == [b"middle", b"newest"]


async def test_get_waits_until_a_frame_is_available():
    outbox = FrameOutbox(maxsize=5)

    async def producer():
        await asyncio.sleep(0.01)
        outbox.put(b"delayed")

    task = asyncio.create_task(producer())
    frame = await outbox.get()
    await task
    assert frame == b"delayed"


def test_maxsize_must_be_positive():
    with pytest.raises(ValueError, match="maxsize"):
        FrameOutbox(maxsize=0)
