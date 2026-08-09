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

import json
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


@pytest.fixture(scope="session", autouse=True)
def _schema_exists(migrated_database: str) -> str:
    """El esquema, antes de cualquier test de esta carpeta.

    Los tests que abren un `TestClient(app)` disparan el `lifespan`, que
    siembra el catálogo contra Postgres, pero no piden `migrated_database`: sin
    esto dependían de que otro test lo hubiera migrado antes. Y `test_migration`
    deja la base en `base` a mitad de su propio ciclo, así que "antes" ni
    siquiera era estable. Ejecutados en solitario fallaban todos con "relation
    rhythms does not exist", que no es lo que pretenden probar.
    """
    return migrated_database


# --- Lectura del WebSocket -------------------------------------------------

# Lo que el servidor publica por su cuenta, sin que el cliente lo pida. Van por
# el mismo socket que las respuestas a los comandos —el contrato es
# multiplexado— y a 1 Hz cada uno, publicando ya en el primer tic. Un test que
# lea "el siguiente mensaje" y espere que sea su respuesta se cruza con ellos.
BACKGROUND_MESSAGE_TYPES = frozenset({"measurements", "pharmacology"})

# Tope de mensajes a descartar antes de rendirse. Existe para que un contrato
# roto falle con un error legible en vez de colgar el test para siempre.
_MAX_SKIPPED = 200


def _next_send(ws):
    """El siguiente mensaje del SERVIDOR, en crudo.

    En el sobre ASGI, `websocket.send` son los mensajes que el servidor manda al
    cliente (`websocket.receive` son los del cliente al servidor).
    """
    while True:
        event = ws.receive()
        kind = event.get("type")
        if kind == "websocket.send":
            return event
        if kind in ("websocket.close", "websocket.disconnect"):
            raise AssertionError(
                f"el socket se cerró antes de lo esperado: {event!r}"
            )


def receive_json_of_type(ws, expected_type: str) -> dict:
    """El siguiente mensaje JSON de ese tipo.

    Descarta frames binarios y los canales de fondo. Cualquier otro tipo se
    considera un fallo y se reporta con su contenido: si esperando `stopped`
    llega un `error`, el error es la información útil.
    """
    for _ in range(_MAX_SKIPPED):
        event = _next_send(ws)
        if "text" not in event:
            continue
        message = json.loads(event["text"])
        if message.get("type") == expected_type:
            return message
        if message.get("type") not in BACKGROUND_MESSAGE_TYPES:
            raise AssertionError(
                f"se esperaba {expected_type!r} y llegó {message!r}"
            )
    raise AssertionError(
        f"no llegó ningún {expected_type!r} en {_MAX_SKIPPED} mensajes"
    )


def receive_frame_bytes(ws) -> bytes:
    """El siguiente frame binario, saltando los canales de fondo."""
    for _ in range(_MAX_SKIPPED):
        event = _next_send(ws)
        if "bytes" in event:
            return event["bytes"]
        message = json.loads(event["text"])
        if message.get("type") not in BACKGROUND_MESSAGE_TYPES:
            raise AssertionError(
                f"se esperaba un frame binario y llegó {message!r}"
            )
    raise AssertionError(f"no llegó ningún frame en {_MAX_SKIPPED} mensajes")


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
