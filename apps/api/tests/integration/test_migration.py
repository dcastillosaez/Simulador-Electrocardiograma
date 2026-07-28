"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import asyncio

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DATABASE_URL = (
    "postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator_test"
)
TEST_DATABASE_URL_SYNC = (
    "postgresql+psycopg2://ecg:ecg@localhost:5432/ecg_simulator_test"
)


def _ensure_test_database_exists() -> None:
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    conn = psycopg2.connect(
        "postgresql://ecg:ecg@localhost:5432/postgres"
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_database WHERE datname = 'ecg_simulator_test'"
            )
            if cur.fetchone() is None:
                cur.execute("CREATE DATABASE ecg_simulator_test")
    finally:
        conn.close()


@pytest.fixture(scope="module")
def alembic_config() -> Config:
    _ensure_test_database_exists()
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL_SYNC)
    return cfg


def test_migration_creates_rhythms_and_sessions_tables(alembic_config):
    command.upgrade(alembic_config, "head")
    try:
        engine = create_async_engine(TEST_DATABASE_URL)

        async def _inspect():
            async with engine.connect() as conn:
                return await conn.run_sync(
                    lambda sync_conn: inspect(sync_conn).get_table_names()
                )

        tables = asyncio.run(_inspect())
        assert "rhythms" in tables
        assert "sessions" in tables
    finally:
        command.downgrade(alembic_config, "base")
