"""Cola de salida del streaming: acotada, descarta lo más antiguo.

Existe para que un cliente lento no haga crecer memoria sin límite. Si el
consumidor no vacía la cola tan rápido como el productor la llena, se
descarta el frame más antiguo, nunca el más nuevo — el cliente detecta el
hueco por `sequence_number` y decide qué hacer con él.
"""

from __future__ import annotations

import asyncio
from collections import deque


class FrameOutbox:
    def __init__(self, maxsize: int = 20) -> None:
        if maxsize < 1:
            raise ValueError(f"maxsize debe ser positivo, recibido {maxsize}")
        self._maxsize = maxsize
        self._frames: deque[bytes] = deque()
        self._not_empty = asyncio.Event()
        self.dropped_count = 0

    def __len__(self) -> int:
        return len(self._frames)

    def put(self, frame: bytes) -> None:
        self._frames.append(frame)
        if len(self._frames) > self._maxsize:
            self._frames.popleft()
            self.dropped_count += 1
        self._not_empty.set()

    async def get(self) -> bytes:
        while not self._frames:
            self._not_empty.clear()
            await self._not_empty.wait()
        return self._frames.popleft()
