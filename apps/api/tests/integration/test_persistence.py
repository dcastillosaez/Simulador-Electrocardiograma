"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import datetime as dt

import pytest
from sqlalchemy import select

from ecg_api.config import Settings
from ecg_api.db.models import SessionRow
from ecg_api.db.seed import seed_catalog
from ecg_api.persistence import persist_session, should_persist
from ecg_api.simulation import SimulationManager


async def _seeded_manager(db_session, rhythm_id: str = "sinus_normal", seed: int = 20260725):
    settings = Settings(_env_file=None, engine_commit="8c4b92f")
    await seed_catalog(db_session, settings)  # la FK exige la fila del ritmo
    manager = SimulationManager()
    manager.start(rhythm_id, None, seed)
    return manager, settings


async def test_persist_session_writes_the_documented_columns(db_session):
    manager, settings = await _seeded_manager(db_session)
    for _ in range(100):  # 100 * 50 muestras / 500 Hz = 10 s simulados
        manager.next_chunk()
    manager.stop()

    await persist_session(db_session, manager, settings)

    row = (
        await db_session.execute(
            select(SessionRow).where(SessionRow.id == manager.session_id)
        )
    ).scalar_one()
    assert row.rhythm_id == "sinus_normal"
    assert row.seed == manager.seed
    assert row.engine_semver.count(".") == 2
    assert row.engine_commit == "8c4b92f"
    assert float(row.duration_s) == pytest.approx(10.0)
    assert row.ended_at == row.started_at + dt.timedelta(seconds=10.0)
    assert row.params["heart_rate_hz"] == pytest.approx(70 / 60)


async def test_should_persist_is_false_under_five_seconds(db_session):
    manager, _ = await _seeded_manager(db_session)
    for _ in range(40):  # 4,0 s simulados
        manager.next_chunk()
    assert not should_persist(manager)


async def test_should_persist_is_true_at_or_above_five_seconds(db_session):
    manager, _ = await _seeded_manager(db_session)
    for _ in range(50):  # 5,0 s simulados exactos
        manager.next_chunk()
    assert should_persist(manager)


async def test_should_persist_is_false_before_starting():
    manager = SimulationManager()
    assert not should_persist(manager)
