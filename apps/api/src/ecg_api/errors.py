"""Excepciones de dominio del streaming, con su código de error de red.

Se traducen a `error {code, detail}` en el endpoint del WebSocket. Solo
`EngineFailureError` cierra el socket (código 1011); las otras dos dejan la
conexión abierta para que el cliente pueda corregir y reintentar sin
reconectar — no hay bucles de reconexión automática en este proyecto.
"""

from __future__ import annotations


class SimulationError(Exception):
    code: str = "UNKNOWN"


class RhythmNotFoundError(SimulationError):
    code = "NOT_FOUND"


class InvalidParamsError(SimulationError):
    code = "INVALID_PARAMS"


class EngineFailureError(SimulationError):
    code = "ENGINE_FAILURE"
