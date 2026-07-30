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
from typing import Awaitable, Callable

from .frames import encode_frame
from .measuring import MEASUREMENT_INTERVAL_S
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
    next_tick = asyncio.get_running_loop().time()
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
        next_tick += interval_s
        await asyncio.sleep(max(0.0, next_tick - asyncio.get_running_loop().time()))


async def stream_measurements(
    manager: SimulationManager,
    publish: Callable[[dict], Awaitable[None]],
    *,
    interval_s: float = MEASUREMENT_INTERVAL_S,
) -> None:
    """Publica las medidas fisiológicas a cadencia lenta.

    Va en su propio bucle y no colgado del de chunks porque son dos ritmos
    distintos: los frames salen diez veces por segundo y las medidas una. Un
    ECG no cambia diez veces por segundo, y medir sobre diez segundos de
    señal en cada frame sería trabajo tirado.

    Recibe `publish` y no el WebSocket: igual que `stream_chunks` escribe en
    un `FrameOutbox`, esto escribe en una función, y eso es lo que permite
    testear el bucle con una lista en vez de una conexión de red.

    En pausa no publica. Las medidas describen señal que se está generando, y
    en pausa no se genera ninguna: seguir emitiéndolas daría la impresión de
    que el trazado congelado sigue vivo.
    """
    next_tick = asyncio.get_running_loop().time()
    while True:
        if manager.state is SimulationState.RUNNING:
            payload = manager.measurements()
            if payload is not None:
                await publish(payload)
        next_tick += interval_s
        await asyncio.sleep(max(0.0, next_tick - asyncio.get_running_loop().time()))
