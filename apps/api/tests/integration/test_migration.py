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


def _inspect_tables() -> list[str]:
    engine = create_async_engine(TEST_DATABASE_URL)

    async def _run():
        async with engine.connect() as conn:
            return await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_table_names()
            )

    return asyncio.run(_run())


def test_migration_creates_rhythms_and_sessions_tables(alembic_config):
    command.upgrade(alembic_config, "head")
    try:
        tables = _inspect_tables()
        assert "rhythms" in tables
        assert "sessions" in tables
    finally:
        command.downgrade(alembic_config, "base")


def test_downgrade_removes_both_tables(alembic_config):
    """El `finally` de arriba ya ejecuta el downgrade como limpieza, pero
    limpiar no es lo mismo que verificar: sin este test, un downgrade roto
    -orden de DROP invertido por la FK, o que no borre nada- pasaría
    inadvertido.

    Vuelve a dejar el esquema en `head` al terminar. Este fichero gestiona
    su propio ciclo de upgrade/downgrade con un fixture independiente del
    `migrated_database` de `conftest.py`; si este test se queda en `base`,
    cualquier test posterior en la misma sesión que dependa de
    `migrated_database` (session-scoped, ya inicializado) hereda un esquema
    inexistente sin que su fixture vuelva a ejecutarse para arreglarlo.
    """
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, "base")
    try:
        tables = _inspect_tables()
        assert "rhythms" not in tables
        assert "sessions" not in tables
    finally:
        command.upgrade(alembic_config, "head")
