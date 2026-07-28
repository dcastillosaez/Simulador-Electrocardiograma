"""Bucle de producción de chunks a intervalo fijo.

Genera un chunk cada `interval_s` mientras `manager.state` sea `RUNNING`; en
cualquier otro estado se limita a esperar. Pausar la simulación no es más
que dejar de llamar a `next_chunk`, el mismo principio que ya usa
`EcgEngine.generate`.

No conoce el WebSocket: escribe en un `FrameOutbox`, que es lo que permite
testear el bucle con un objeto en memoria en vez de una conexión de red real.
"""

from __future__ import annotations

import asyncio

from .frames import encode_frame
from .outbox import FrameOutbox
from .simulation import SimulationManager, SimulationState

CHUNK_INTERVAL_S = 0.1  # ~10 mensajes/s, la cadencia del diseño


async def stream_chunks(
    manager: SimulationManager,
    outbox: FrameOutbox,
    sample_rate_hz: int,
    *,
    interval_s: float = CHUNK_INTERVAL_S,
) -> None:
    while True:
        if manager.state is SimulationState.RUNNING:
            assert manager.session_id is not None
            chunk = manager.next_chunk()
            frame = encode_frame(
                session_id=manager.session_id,
                sequence_number=chunk.sequence_number,
                t_start_s=chunk.t_start_s,
                sample_rate_hz=sample_rate_hz,
                channels_v=chunk.channels_v,
            )
            outbox.put(frame)
        await asyncio.sleep(interval_s)
