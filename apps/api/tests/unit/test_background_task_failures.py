"""Qué hace el socket cuando termina mal una de sus tareas de fondo.

Un fallo del motor se registra con referencia y cierra con 1011. Una
desconexión del cliente que pilla a una tarea enviando no es nada de eso:
Starlette la entrega como `WebSocketDisconnect(1006)` desde el `send`, y antes
acababa en el log como «fallo del motor», con traza y todo.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import WebSocketDisconnect

from ecg_api.routers.simulation_ws import _on_background_task_done
from ecg_api.simulation import SimulationManager


class _NoSocket:
    """Si el manejador intenta cerrar, aquí se nota."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def send_json(self, _payload) -> None:
        self.calls.append("send_json")

    async def close(self, code: int = 1000) -> None:
        self.calls.append(f"close:{code}")


async def _failed_task(exc: BaseException) -> asyncio.Task:
    async def boom() -> None:
        raise exc

    task = asyncio.create_task(boom())
    await asyncio.gather(task, return_exceptions=True)
    return task


async def _handle(exc: BaseException) -> tuple[_NoSocket, set[asyncio.Task]]:
    socket = _NoSocket()
    close_tasks: set[asyncio.Task] = set()
    _on_background_task_done(
        await _failed_task(exc),
        websocket=socket,
        manager=SimulationManager(),
        close_tasks=close_tasks,
    )
    if close_tasks:
        await asyncio.gather(*close_tasks)
    return socket, close_tasks


async def test_a_client_disconnect_during_send_is_not_an_engine_failure(caplog):
    with caplog.at_level(logging.INFO, logger="ecg_api.simulation_ws"):
        socket, _ = await _handle(WebSocketDisconnect(code=1006))

    assert socket.calls == []
    assert not any("fallo del motor" in r.getMessage() for r in caplog.records)
    assert all(r.levelno < logging.ERROR for r in caplog.records)


async def test_a_real_failure_is_still_reported_and_closes_with_1011(caplog):
    with caplog.at_level(logging.INFO, logger="ecg_api.simulation_ws"):
        socket, _ = await _handle(RuntimeError("el motor se cayó"))

    assert socket.calls == ["send_json", "close:1011"]
    assert any("fallo del motor" in r.getMessage() for r in caplog.records)
