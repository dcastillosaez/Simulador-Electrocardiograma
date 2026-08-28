"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import ecg_engine
from sqlalchemy import select

from ecg_api.config import Settings
from ecg_api.db.models import RhythmRow
from ecg_api.db.seed import seed_catalog


async def test_seed_catalog_inserts_every_catalogue_entry(db_session):
    """El paciente personalizado también se siembra.

    No porque sea un ritmo —no lo es— sino porque `sessions.rhythm_id` tiene
    una FK contra esta tabla: sin su fila, una sesión con paciente inventado
    no se podría guardar.
    """
    settings = Settings(_env_file=None, engine_commit="8c4b92f")
    await seed_catalog(db_session, settings)

    rows = (await db_session.execute(select(RhythmRow))).scalars().all()
    expected_ids = {d.rhythm_id for d in ecg_engine.list_rhythms()}
    assert {row.id for row in rows} == expected_ids
    assert ecg_engine.CUSTOM_PATIENT_ID in expected_ids
    assert len(expected_ids - {ecg_engine.CUSTOM_PATIENT_ID}) == 12


async def test_seed_catalog_is_idempotent(db_session):
    settings = Settings(_env_file=None, engine_commit="8c4b92f")
    await seed_catalog(db_session, settings)
    await seed_catalog(db_session, settings)  # segunda vez: no duplica, no falla

    rows = (await db_session.execute(select(RhythmRow))).scalars().all()
    assert len(rows) == len(ecg_engine.list_rhythms())


async def test_seed_catalog_updates_engine_commit_on_reseed(db_session):
    settings_a = Settings(_env_file=None, engine_commit="aaaaaaa")
    settings_b = Settings(_env_file=None, engine_commit="bbbbbbb")
    await seed_catalog(db_session, settings_a)
    await seed_catalog(db_session, settings_b)

    row = (
        await db_session.execute(
            select(RhythmRow).where(RhythmRow.id == "sinus_normal")
        )
    ).scalar_one()
    assert row.engine_commit == "bbbbbbb"
