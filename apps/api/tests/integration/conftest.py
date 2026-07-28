"""Fixtures compartidas de los tests de integración.

Requieren Postgres real (`docker compose up -d db`). La base de test se crea
una sola vez por sesión de pytest y se migra a la última revisión; cada test
aísla sus cambios con una transacción propia que siempre se revierte, así
que no hace falta volver a migrar ni truncar tablas entre tests.
"""

from __future__ import annotations

import os

# `get_settings()` está cacheada con `lru_cache`: la primera llamada en todo
# el proceso de pytest fija los valores para el resto de la sesión. Fijar
# aquí la URL de la base de test, antes de que ningún módulo de la app
# importe `ecg_api.config`, es lo que garantiza que el WebSocket y los
# routers REST —que la leen a través del ciclo de vida de la app— apunten
# siempre a `ecg_simulator_test`, sin importar qué test se ejecute primero.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator_test"
)
os.environ.setdefault("ENGINE_COMMIT", "test")

from collections.abc import AsyncIterator

import psycopg2
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

TEST_DATABASE_URL = (
    "postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator_test"
)
TEST_DATABASE_URL_SYNC = (
    "postgresql+psycopg2://ecg:ecg@localhost:5432/ecg_simulator_test"
)


def _ensure_test_database_exists() -> None:
    try:
        conn = psycopg2.connect("postgresql://ecg:ecg@localhost:5432/postgres")
    except psycopg2.OperationalError as exc:
        raise RuntimeError(
            "No se pudo conectar a Postgres en localhost:5432. "
            "Levanta el contenedor con: docker compose up -d db"
        ) from exc
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


@pytest.fixture(scope="session")
def migrated_database() -> AsyncIterator[str]:
    _ensure_test_database_exists()
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL_SYNC)
    command.upgrade(cfg, "head")
    yield TEST_DATABASE_URL
    command.downgrade(cfg, "base")


@pytest_asyncio.fixture
async def db_session(migrated_database: str) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(migrated_database)
    connection = await engine.connect()
    transaction = await connection.begin()
    session_factory = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    session = session_factory()
    try:
        yield session
    finally:
        await session.close()
        await transaction.rollback()
        await connection.close()
        await engine.dispose()
