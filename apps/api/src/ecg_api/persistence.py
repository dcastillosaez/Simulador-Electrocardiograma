"""Persistencia de sesiones cerradas.

Se llama exactamente una vez por sesión, al final: con `stop` explícito, o
al desconectar si la sesión llevaba al menos 5 s de tiempo simulado. Nunca
en la ruta caliente del streaming.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.ext.asyncio import AsyncSession

import ecg_engine

from .config import Settings
from .db.models import SessionRow
from .schemas import engine_params_to_dict
from .simulation import SimulationManager

MIN_PERSISTABLE_DURATION_S = 5.0


async def persist_session(
    session: AsyncSession,
    manager: SimulationManager,
    settings: Settings,
) -> None:
    assert manager.session_id is not None
    assert manager.started_at is not None
    duration_s = manager.duration_s
    ended_at = manager.started_at + dt.timedelta(seconds=duration_s)
    session.add(
        SessionRow(
            id=manager.session_id,
            rhythm_id=manager.rhythm_id,
            params=engine_params_to_dict(manager.params),
            seed=manager.seed,
            engine_semver=ecg_engine.__version__,
            engine_commit=settings.engine_commit,
            started_at=manager.started_at,
            ended_at=ended_at,
            duration_s=duration_s,
        )
    )
    await session.commit()


def should_persist(manager: SimulationManager) -> bool:
    """La regla de las sesiones sin `stop` explícito: se persiste si el
    cliente desconectó habiendo simulado al menos 5 s. Tiempo simulado, no
    de reloj de pared — determinista y rápido de testear."""
    return (
        manager.session_id is not None
        and manager.duration_s >= MIN_PERSISTABLE_DURATION_S
    )
