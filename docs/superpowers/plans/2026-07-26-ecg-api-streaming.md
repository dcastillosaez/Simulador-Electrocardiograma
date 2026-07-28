# Plan B — API y streaming (`apps/api`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el backend FastAPI que expone el catálogo por REST, transmite la señal por WebSocket con el contrato de frame binario del diseño, y persiste sesiones cerradas en PostgreSQL.

**Architecture:** Un plano de control REST sin estado (catálogo servido directo del paquete `ecg-engine`, historial de sesiones desde Postgres) y una ruta caliente WebSocket con un `SimulationManager` por conexión que envuelve `EcgEngine`. El streaming pasa por una cola acotada con descarte de lo más antiguo, para que un cliente lento no haga crecer memoria sin límite. La sesión se persiste una sola vez, al cerrar, nunca en la ruta caliente.

**Tech Stack:** Python 3.12, FastAPI + Starlette WebSockets, SQLAlchemy 2.0 async + asyncpg, Alembic, Pydantic v2, uvicorn (un solo worker), PostgreSQL 16 vía Docker Compose, pytest + pytest-asyncio + httpx.

**Spec:** [`docs/superpowers/specs/2026-07-25-ecg-simulator-fase1-design.md`](../specs/2026-07-25-ecg-simulator-fase1-design.md), secciones 5, 7, 8, 10 y 11.

## Global Constraints

Estas reglas aplican a **todas** las tareas de este plan.

1. **Un solo worker de uvicorn.** El estado de simulación vive en memoria del proceso que sostiene el WebSocket. Es una restricción de despliegue documentada, no un accidente — no hay nada que testear aquí, solo que ningún código de esta capa asuma que puede compartir estado entre procesos.
2. **Sin autenticación, sin Redis, sin reconexión automática.** No-objetivos explícitos del MVP. No los implementes ni dejes huecos para ellos.
3. **REST nunca en la ruta caliente; el WebSocket nunca escribe en Postgres salvo al cerrar.** El streaming de chunks no debe tocar la base de datos en ningún punto de su bucle.
4. **Reparto de parámetros:** el motor recibe únicamente `heart_rate_hz` y los niveles de ruido. Velocidad de papel, ganancia, calibración y layout son de cliente y no cruzan la red — este plan no los modela en absoluto.
5. **El catálogo se sirve directo del paquete `ecg-engine`** (`list_rhythms()`/`get_rhythm()`), nunca de la base de datos. La tabla `rhythms` de Postgres existe solo como ancla de la FK de `sessions` y se rellena por upsert desde ese mismo catálogo al arrancar la aplicación.
6. **Contrato del frame binario**, little-endian, cabecera fija de 40 bytes:

   | Offset | Tipo | Campo | Valor |
   |---|---|---|---|
   | 0 | uint16 | `version` | 1 |
   | 2 | uint16 | `sample_rate_hz` | 500 |
   | 4 | uint8 | `n_channels` | 12 |
   | 5 | uint8 | `reserved` | 0 |
   | 6 | uint16 | `n_samples_per_channel` | 50 |
   | 8 | uint32 | `sequence_number` | — |
   | 12 | uint32 | `reserved2` | 0 |
   | 16 | float64 | `t_start_s` | — |
   | 24 | byte[16] | `session_id` | UUID canónico, `.bytes`, sin reordenar |
   | 40 | float32[] | payload | channel-major, en voltios |

   `sequence_number` monótono creciente por sesión, empieza en 0, se reinicia con cada sesión nueva.
7. **`session_id` no se reordena.** Es el UUID canónico de 16 bytes (`uuid.UUID.bytes`, orden de red / RFC 4122), copiado tal cual en ambos extremos. La regla de little-endian del resto de la cabecera no le aplica a este campo.
8. **Orden canónico de derivaciones**, el mismo que en el motor: `I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6` (`ecg_engine.types.LEAD_ORDER`).
9. **`GET /api/sessions`** no lleva `POST`. La sesión la escribe el propio handler del WebSocket al cerrarse — exponer un endpoint de escritura crearía dos caminos para el mismo dato.
10. **Buffer de envío saturado → se descartan los frames más antiguos**, nunca los más nuevos, y nunca se encola sin límite.
11. **Fallo del motor → `error {code: "ENGINE_FAILURE"}` y cierre de socket 1011.** Parámetros inválidos o ritmo inexistente → `error` sin cerrar el socket.
12. **`engine_semver` y `engine_commit` van en dos campos separados**, nunca fusionados en uno.
13. **Duración de sesión persistible: ≥ 5 s de tiempo simulado** (`EcgEngine.t_s`), no tiempo de reloj de pared. Es determinista y rápido de testear: generar 2500 muestras a 500 Hz produce 5,0 s simulados casi instantáneamente.
14. Mensajes de commit en español, frase llana, sin prefijos tipo `feat:`, sin etiqueta `Co-authored-by` ni mención a asistentes de IA.

---

## Nota sobre la infraestructura de tests

Este plan usa Postgres real para los tests de integración, no una base de datos falsa: es lo único que valida de verdad la migración de Alembic y las restricciones de la tabla. Antes de ejecutar `tests/integration/`, levanta el contenedor:

```bash
cd Simulador_Electrocardiograma
docker compose up -d db
```

Los tests unitarios (`tests/unit/`) no necesitan Postgres ni Docker.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `docker-compose.yml` (raíz del proyecto) | Servicio `db`: PostgreSQL 16 |
| `apps/api/pyproject.toml` | Metadatos, dependencias, dependencia local editable a `ecg-engine` |
| `apps/api/.env.example` | Plantilla de variables de entorno |
| `apps/api/src/ecg_api/__init__.py` | — |
| `apps/api/src/ecg_api/config.py` | `Settings` (pydantic-settings) |
| `apps/api/src/ecg_api/main.py` | Instancia FastAPI, monta routers, evento de arranque (seed del catálogo) |
| `apps/api/src/ecg_api/db/base.py` | `Base`, engine/sesión async de SQLAlchemy |
| `apps/api/src/ecg_api/db/models.py` | `RhythmRow`, `SessionRow` |
| `apps/api/src/ecg_api/db/seed.py` | Upsert del catálogo de código a la tabla `rhythms` |
| `apps/api/alembic.ini` | Configuración de Alembic |
| `apps/api/migrations/env.py` | Entorno de Alembic (async) |
| `apps/api/migrations/versions/0001_initial.py` | Migración inicial: tablas `rhythms` y `sessions` |
| `apps/api/src/ecg_api/frames.py` | `encode_frame` / `decode_frame`, contrato binario |
| `apps/api/src/ecg_api/schemas.py` | Payloads Pydantic de entrada WS, mensajes de salida, esquemas REST |
| `apps/api/src/ecg_api/errors.py` | Excepciones de dominio y su código de error |
| `apps/api/src/ecg_api/simulation.py` | `SimulationManager`, `SimulationState`, `Chunk` |
| `apps/api/src/ecg_api/outbox.py` | `FrameOutbox`: cola acotada, descarta lo más antiguo |
| `apps/api/src/ecg_api/streaming.py` | Bucle de generación de chunks a intervalo fijo |
| `apps/api/src/ecg_api/persistence.py` | `persist_session` |
| `apps/api/src/ecg_api/routers/health.py` | `GET /api/health` |
| `apps/api/src/ecg_api/routers/rhythms.py` | `GET /api/rhythms`, `GET /api/rhythms/{id}` |
| `apps/api/src/ecg_api/routers/sessions.py` | `GET /api/sessions`, `GET /api/sessions/{id}` |
| `apps/api/src/ecg_api/routers/simulation_ws.py` | `WS /ws/simulation` |
| `apps/api/tests/conftest.py` | Fixtures: cliente HTTP, sesión de BD de test, limpieza |
| `apps/api/tests/unit/*` | Tests sin red ni BD |
| `apps/api/tests/integration/*` | Tests con Postgres real vía Docker |

---

### Task 1: Scaffolding del paquete `ecg-api` y `/api/health`

**Files:**
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/src/ecg_api/__init__.py`
- Create: `apps/api/src/ecg_api/main.py`
- Create: `apps/api/src/ecg_api/routers/__init__.py`
- Create: `apps/api/src/ecg_api/routers/health.py`
- Create: `apps/api/README.md`
- Test: `apps/api/tests/unit/test_health.py`

**Interfaces:**
- Consumes: `ecg_engine.__version__` (ya existe en el paquete `ecg-engine`).
- Produces: `app: FastAPI` en `ecg_api.main`, importable como `from ecg_api.main import app`. `GET /api/health` → `{"status": "ok", "engine_version": str}`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_health.py`:

```python
from fastapi.testclient import TestClient

from ecg_api.main import app


def test_health_reports_ok_and_engine_version():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["engine_version"].count(".") == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_health.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/pyproject.toml`:

```toml
[project]
name = "ecg-api"
version = "0.1.0"
description = "API y streaming del simulador de ECG"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.4",
    "sqlalchemy>=2.0",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "numpy>=2.0",
    "ecg-engine",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.24", "httpx>=0.27"]

[tool.uv.sources]
ecg-engine = { path = "../../packages/ecg-engine", editable = true }

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ecg_api"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

Crear `apps/api/src/ecg_api/__init__.py`:

```python
"""API y streaming del simulador de ECG."""

__version__ = "0.1.0"
```

Crear `apps/api/src/ecg_api/routers/__init__.py` (vacío).

Crear `apps/api/src/ecg_api/routers/health.py`:

```python
"""Salud del servicio. Plano de control, sin dependencias externas."""

from __future__ import annotations

from fastapi import APIRouter

import ecg_engine

router = APIRouter()


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine_version": ecg_engine.__version__}
```

Crear `apps/api/src/ecg_api/main.py`:

```python
"""Punto de entrada de la API.

Un solo worker de uvicorn: el estado de simulación vive en memoria del
proceso que sostiene cada WebSocket, y varios workers romperían ese
binding. Es una restricción de despliegue documentada, no un accidente.
"""

from __future__ import annotations

from fastapi import FastAPI

from .routers.health import router as health_router

app = FastAPI(title="Simulador de ECG — API")

app.include_router(health_router)
```

Crear `apps/api/README.md`:

```markdown
# ecg-api

API y streaming del simulador de ECG. FastAPI, un solo worker de uvicorn.

## Desarrollo

    uv sync --extra dev
    docker compose -f ../../docker-compose.yml up -d db
    uv run alembic upgrade head
    uv run uvicorn ecg_api.main:app --reload

## Tests

    uv run pytest tests/unit          # sin Postgres
    uv run pytest tests/integration   # requiere el contenedor db arriba
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv sync --extra dev && uv run pytest tests/unit/test_health.py -v`
Expected: PASS, 1 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "Crear scaffolding de ecg-api con el endpoint de salud"
```

---

### Task 2: `docker-compose.yml` y configuración

**Files:**
- Create: `docker-compose.yml` (raíz de `Simulador_Electrocardiograma/`)
- Create: `apps/api/.env.example`
- Create: `apps/api/src/ecg_api/config.py`
- Modify: `apps/api/src/ecg_api/main.py`
- Test: `apps/api/tests/unit/test_config.py`

**Interfaces:**
- Consumes: nada.
- Produces: `Settings` (pydantic-settings) en `ecg_api.config`, con `database_url: str`, `engine_commit: str`. `get_settings() -> Settings`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_config.py`:

```python
import os

from ecg_api.config import Settings


def test_settings_have_sane_defaults():
    settings = Settings(_env_file=None)
    assert settings.engine_commit == "dev"
    assert "postgresql+asyncpg://" in settings.database_url


def test_settings_read_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:x@host/db")
    monkeypatch.setenv("ENGINE_COMMIT", "8c4b92f")
    settings = Settings(_env_file=None)
    assert settings.database_url == "postgresql+asyncpg://x:x@host/db"
    assert settings.engine_commit == "8c4b92f"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_config.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.config'`

- [ ] **Step 3: Write minimal implementation**

Crear `docker-compose.yml` en la raíz de `Simulador_Electrocardiograma/`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ecg
      POSTGRES_PASSWORD: ecg
      POSTGRES_DB: ecg_simulator
    ports:
      - "5432:5432"
    volumes:
      - ecg_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecg"]
      interval: 2s
      timeout: 2s
      retries: 15

volumes:
  ecg_pgdata:
```

Crear `apps/api/.env.example`:

```
DATABASE_URL=postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator
ENGINE_COMMIT=dev
```

Crear `apps/api/src/ecg_api/config.py`:

```python
"""Configuración de la aplicación, vía variables de entorno."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator"
    engine_commit: str = "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

Modificar `apps/api/src/ecg_api/main.py`, añadiendo el import y exponiendo settings a través de la app (sin usarlas todavía en rutas):

```python
from .config import get_settings
from .routers.health import router as health_router

app = FastAPI(title="Simulador de ECG — API")
app.state.settings = get_settings()

app.include_router(health_router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_config.py tests/unit/test_health.py -v`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/api/
git commit -m "Añadir docker-compose de Postgres y configuración de la API"
```

---

### Task 3: Modelos de base de datos y migración inicial

**Files:**
- Create: `apps/api/src/ecg_api/db/__init__.py`
- Create: `apps/api/src/ecg_api/db/base.py`
- Create: `apps/api/src/ecg_api/db/models.py`
- Create: `apps/api/alembic.ini`
- Create: `apps/api/migrations/env.py`
- Create: `apps/api/migrations/script.py.mako`
- Create: `apps/api/migrations/versions/0001_initial.py`
- Test: `apps/api/tests/integration/test_migration.py`

**Interfaces:**
- Consumes: `Settings.database_url` de la Tarea 2.
- Produces: `Base` (declarative base), `RhythmRow`, `SessionRow` en `ecg_api.db.models`. `get_engine()`, `get_session_factory()` en `ecg_api.db.base`, ambos parametrizables por `database_url` para que los tests puedan apuntar a la base de datos de prueba.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/integration/test_migration.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/integration/test_migration.py -v`
Expected: FAIL con `FileNotFoundError` o `ModuleNotFoundError` (falta `alembic.ini`, `ecg_api.db.models`, dependencias `psycopg2`/`alembic`)

Añade `psycopg2-binary>=2.9` a las dependencias `dev` de `apps/api/pyproject.toml` (hace falta solo para que Alembic pueda ejecutar migraciones síncronas y para la comprobación de creación de la base de test) y ejecuta `uv sync --extra dev`.

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/db/__init__.py` (vacío).

Crear `apps/api/src/ecg_api/db/base.py`:

```python
"""Motor y fábrica de sesiones de SQLAlchemy, async."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def get_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)


def get_session_factory(
    database_url: str,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(database_url), expire_on_commit=False)
```

Crear `apps/api/src/ecg_api/db/models.py`:

```python
"""Tablas de persistencia.

Solo dos: `rhythms`, que ancla la FK de `sessions` y se rellena por upsert
desde el catálogo de código (nunca se escribe a mano), y `sessions`, las
sesiones cerradas. Nada más vive en Postgres — el streaming no toca esta
capa en ningún punto de su bucle.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import BigInteger, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# `Mapped[dt.datetime]` sin más, en SQLAlchemy 2.0, infiere `DateTime()` SIN
# zona horaria. Como la migración crea las columnas `timestamptz`, dejar el
# tipo implícito habría hecho que el modelo ORM y el esquema real de
# Postgres discreparan en `timezone=True/False` — el tipo de desajuste que
# `alembic revision --autogenerate` detectaría como drift espurio, y que
# aquí además importa de verdad: `started_at` se construye con
# `datetime.now(timezone.utc)` (tarea 12), un datetime con zona.
_TZ_DATETIME = DateTime(timezone=True)


class RhythmRow(Base):
    __tablename__ = "rhythms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        _TZ_DATETIME, nullable=False, server_default=func.now()
    )


class SessionRow(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    rhythm_id: Mapped[str] = mapped_column(
        ForeignKey("rhythms.id"), nullable=False
    )
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[dt.datetime] = mapped_column(_TZ_DATETIME, nullable=False)
    ended_at: Mapped[dt.datetime | None] = mapped_column(
        _TZ_DATETIME, nullable=True
    )
    duration_s: Mapped[float | None] = mapped_column(Numeric, nullable=True)
```

Crear `apps/api/alembic.ini`:

```ini
[alembic]
script_location = migrations
prepend_sys_path = .

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

Crear `apps/api/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

Crear `apps/api/migrations/env.py`:

```python
"""Entorno de Alembic. Migraciones síncronas contra el mismo esquema que la
app usa async — Alembic no necesita el driver async, así que la URL de
migración se fuerza a `psycopg2` aunque la app use `asyncpg`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from ecg_api.db.base import Base  # noqa: E402
from ecg_api.db.models import RhythmRow, SessionRow  # noqa: E402,F401

config = context.config
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url, target_metadata=target_metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

Crear `apps/api/migrations/versions/0001_initial.py`:

```python
"""Crear rhythms y sessions

Revision ID: 0001
Revises:
Create Date: 2026-07-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rhythms",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("spec", postgresql.JSONB(), nullable=False),
        sa.Column("engine_semver", sa.String(), nullable=False),
        sa.Column("engine_commit", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "rhythm_id",
            sa.String(),
            sa.ForeignKey("rhythms.id"),
            nullable=False,
        ),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("engine_semver", sa.String(), nullable=False),
        sa.Column("engine_commit", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_s", sa.Numeric(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_table("rhythms")
```

- [ ] **Step 4: Run test to verify it passes**

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_migration.py -v`
Expected: PASS, 2 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "Añadir modelos de base de datos y migración inicial de Alembic"
```

---

### Task 4: Fixtures compartidas de integración y seed del catálogo

**Files:**
- Create: `apps/api/tests/integration/__init__.py`
- Create: `apps/api/tests/integration/conftest.py`
- Create: `apps/api/src/ecg_api/db/seed.py`
- Test: `apps/api/tests/integration/test_seed.py`

**Interfaces:**
- Consumes: `Settings` de la Tarea 2; `Base`, `RhythmRow` de la Tarea 3; `ecg_engine.list_rhythms()`.
- Produces: `seed_catalog(session: AsyncSession, settings: Settings) -> None`. Fixtures pytest `migrated_database` (session-scoped) y `db_session` (function-scoped, transacción con rollback), reutilizadas por todas las tareas de integración siguientes.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/integration/__init__.py` (vacío).

Crear `apps/api/tests/integration/conftest.py`:

```python
"""Fixtures compartidas de los tests de integración.

Requieren Postgres real (`docker compose up -d db`). La base de test se crea
una sola vez por sesión de pytest y se migra a la última revisión; cada test
aísla sus cambios con una transacción propia que siempre se revierte, así
que no hace falta volver a migrar ni truncar tablas entre tests.
"""

from __future__ import annotations

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
```

Crear `apps/api/tests/integration/test_seed.py`:

```python
"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import ecg_engine
from sqlalchemy import select

from ecg_api.config import Settings
from ecg_api.db.models import RhythmRow
from ecg_api.db.seed import seed_catalog


async def test_seed_catalog_inserts_all_twelve_rhythms(db_session):
    settings = Settings(_env_file=None, engine_commit="8c4b92f")
    await seed_catalog(db_session, settings)

    rows = (await db_session.execute(select(RhythmRow))).scalars().all()
    expected_ids = {d.rhythm_id for d in ecg_engine.list_rhythms()}
    assert {row.id for row in rows} == expected_ids
    assert len(expected_ids) == 12


async def test_seed_catalog_is_idempotent(db_session):
    settings = Settings(_env_file=None, engine_commit="8c4b92f")
    await seed_catalog(db_session, settings)
    await seed_catalog(db_session, settings)  # segunda vez: no duplica, no falla

    rows = (await db_session.execute(select(RhythmRow))).scalars().all()
    assert len(rows) == 12


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
```

- [ ] **Step 2: Run test to verify it fails**

Añade `psycopg2-binary>=2.9` y `pytest-asyncio>=0.24` a las dependencias `dev` de `apps/api/pyproject.toml` si no están ya (la Tarea 3 ya añadió `psycopg2-binary`; confirma que sigue ahí) y ejecuta `uv sync --extra dev`.

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_seed.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.db.seed'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/db/seed.py`:

```python
"""Upsert del catálogo de código a la tabla `rhythms`.

La tabla no es la fuente de verdad — lo es `ecg_engine.list_rhythms()` —
sino el ancla de la FK de `sessions`. Se rellena aquí, al arrancar la
aplicación, nunca a mano ni desde una migración de datos.
"""

from __future__ import annotations

import ecg_engine
from ecg_engine.catalog import RhythmDefinition
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from .models import RhythmRow


def _rhythm_spec(definition: RhythmDefinition) -> dict:
    return {
        "default_parameters": dict(definition.default_parameters),
        "editable_parameters": {
            name: {
                "minimum": r.minimum,
                "maximum": r.maximum,
                "default": r.default,
            }
            for name, r in definition.editable_parameters.items()
        },
        "ventricular_rate_hz": definition.ventricular_rate_hz,
        "pr_is_measurable": definition.pr_is_measurable,
        "clinical_description": definition.clinical_description,
        "references": list(definition.references),
        "allowed_overlays": list(definition.allowed_overlays),
    }


async def seed_catalog(session: AsyncSession, settings: Settings) -> None:
    for definition in ecg_engine.list_rhythms():
        stmt = insert(RhythmRow).values(
            id=definition.rhythm_id,
            name=definition.display_name,
            category=definition.category.value,
            spec=_rhythm_spec(definition),
            engine_semver=ecg_engine.__version__,
            engine_commit=settings.engine_commit,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[RhythmRow.id],
            set_={
                "name": stmt.excluded.name,
                "category": stmt.excluded.category,
                "spec": stmt.excluded.spec,
                "engine_semver": stmt.excluded.engine_semver,
                "engine_commit": stmt.excluded.engine_commit,
            },
        )
        await session.execute(stmt)
    await session.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/integration/test_seed.py -v`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "Añadir seed del catálogo y fixtures compartidas de integración"
```

---

### Task 5: `GET /api/rhythms`, `GET /api/rhythms/{id}`

Servidos directo de `ecg-engine`, sin tocar la base de datos: el catálogo de código ya es la fuente de verdad versionada con el motor.

**Files:**
- Create: `apps/api/src/ecg_api/schemas.py`
- Create: `apps/api/src/ecg_api/routers/rhythms.py`
- Modify: `apps/api/src/ecg_api/main.py`
- Test: `apps/api/tests/unit/test_rhythms_router.py`

**Interfaces:**
- Consumes: `ecg_engine.list_rhythms()`, `ecg_engine.get_rhythm()`, `ecg_engine.catalog.RhythmDefinition`.
- Produces: `RhythmSummary`, `RhythmDetail`, `ParameterRangePayload` en `ecg_api.schemas`. Rutas `GET /api/rhythms` (lista) y `GET /api/rhythms/{rhythm_id}` (detalle, 404 si no existe).

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_rhythms_router.py`:

```python
from fastapi.testclient import TestClient

from ecg_api.main import app

client = TestClient(app)


def test_list_rhythms_returns_the_twelve_mvp_rhythms():
    response = client.get("/api/rhythms")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 12
    assert {
        "rhythm_id", "display_name", "category",
        "ventricular_rate_hz", "pr_is_measurable",
    } <= body[0].keys()


def test_get_rhythm_detail_includes_editable_parameters_and_references():
    response = client.get("/api/rhythms/sinus_normal")
    assert response.status_code == 200
    body = response.json()
    assert body["rhythm_id"] == "sinus_normal"
    rate_range = body["editable_parameters"]["heart_rate_hz"]
    assert rate_range["minimum"] < rate_range["maximum"]
    assert len(body["references"]) >= 1


def test_get_rhythm_detail_404_for_unknown_id():
    response = client.get("/api/rhythms/no_existe")
    assert response.status_code == 404


def test_third_degree_block_declares_a_fixed_range():
    """Coherencia con el catálogo: av_block_third tiene frecuencia
    estructural, minimum == maximum. Si esto falla, algo se desincronizó
    entre el motor y cómo la API lo expone."""
    response = client.get("/api/rhythms/av_block_third")
    rate_range = response.json()["editable_parameters"]["heart_rate_hz"]
    assert rate_range["minimum"] == rate_range["maximum"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_rhythms_router.py -v`
Expected: FAIL con 404 en `/api/rhythms` (ruta no registrada) o `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/schemas.py`:

```python
"""Esquemas Pydantic de la API: REST y WebSocket.

Este módulo crece con cada tarea del plan. Los esquemas REST del catálogo
van primero; los del WebSocket y las sesiones se añaden en tareas
posteriores.
"""

from __future__ import annotations

from pydantic import BaseModel


class ParameterRangePayload(BaseModel):
    minimum: float
    maximum: float
    default: float


class RhythmSummary(BaseModel):
    rhythm_id: str
    display_name: str
    category: str
    ventricular_rate_hz: float
    pr_is_measurable: bool


class RhythmDetail(RhythmSummary):
    default_parameters: dict[str, float]
    editable_parameters: dict[str, ParameterRangePayload]
    clinical_description: str
    references: tuple[str, ...]
    allowed_overlays: tuple[str, ...]
```

Crear `apps/api/src/ecg_api/routers/rhythms.py`:

```python
"""Catálogo de ritmos. Servido directo de ecg-engine, nunca de la base de
datos: `ecg_engine.list_rhythms()` ya es la fuente de verdad versionada con
el motor. La tabla `rhythms` de Postgres solo ancla la FK de `sessions`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ecg_engine import get_rhythm as engine_get_rhythm
from ecg_engine import list_rhythms as engine_list_rhythms
from ecg_engine.catalog import RhythmDefinition

from ..schemas import ParameterRangePayload, RhythmDetail, RhythmSummary

router = APIRouter(prefix="/api/rhythms", tags=["rhythms"])


def _to_summary(definition: RhythmDefinition) -> RhythmSummary:
    return RhythmSummary(
        rhythm_id=definition.rhythm_id,
        display_name=definition.display_name,
        category=definition.category.value,
        ventricular_rate_hz=definition.ventricular_rate_hz,
        pr_is_measurable=definition.pr_is_measurable,
    )


def _to_detail(definition: RhythmDefinition) -> RhythmDetail:
    return RhythmDetail(
        **_to_summary(definition).model_dump(),
        default_parameters=dict(definition.default_parameters),
        editable_parameters={
            name: ParameterRangePayload(
                minimum=r.minimum, maximum=r.maximum, default=r.default
            )
            for name, r in definition.editable_parameters.items()
        },
        clinical_description=definition.clinical_description,
        references=definition.references,
        allowed_overlays=definition.allowed_overlays,
    )


@router.get("", response_model=list[RhythmSummary])
def list_rhythms_endpoint() -> list[RhythmSummary]:
    return [_to_summary(d) for d in engine_list_rhythms()]


@router.get("/{rhythm_id}", response_model=RhythmDetail)
def get_rhythm_endpoint(rhythm_id: str) -> RhythmDetail:
    try:
        definition = engine_get_rhythm(rhythm_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_detail(definition)
```

Modificar `apps/api/src/ecg_api/main.py`, añadiendo el router nuevo:

```python
from .config import get_settings
from .routers.health import router as health_router
from .routers.rhythms import router as rhythms_router

app = FastAPI(title="Simulador de ECG — API")
app.state.settings = get_settings()

app.include_router(health_router)
app.include_router(rhythms_router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_rhythms_router.py -v`
Expected: PASS, 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "Servir el catalogo de ritmos por REST directo desde ecg-engine"
```

---

### Task 6: Contrato del frame binario

**Files:**
- Create: `apps/api/src/ecg_api/frames.py`
- Test: `apps/api/tests/unit/test_frames.py`

**Interfaces:**
- Consumes: `ecg_engine.types.N_LEADS`.
- Produces: `HEADER_SIZE: int` (= 40), `encode_frame(*, session_id, sequence_number, t_start_s, sample_rate_hz, channels_v) -> bytes`, `decode_frame(data: bytes) -> DecodedFrame`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_frames.py`:

```python
import struct
import uuid

import numpy as np
import pytest

from ecg_api.frames import HEADER_SIZE, decode_frame, encode_frame
from ecg_engine.types import N_LEADS


def make_channels(n_samples: int = 50) -> np.ndarray:
    return (
        np.arange(N_LEADS * n_samples, dtype=np.float64).reshape(N_LEADS, n_samples)
        * 1e-6
    )


def test_header_is_exactly_forty_bytes():
    assert HEADER_SIZE == 40


def test_encoded_frame_size_matches_header_plus_payload():
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=make_channels(50),
    )
    assert len(frame) == 40 + 12 * 50 * 4


def test_header_fields_are_little_endian_and_in_order():
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=7, t_start_s=1.5,
        sample_rate_hz=500, channels_v=make_channels(50),
    )
    fields = struct.unpack_from("<HHBBHIId", frame, 0)
    assert fields == (1, 500, 12, 0, 50, 7, 0, 1.5)


def test_session_id_bytes_are_not_reordered():
    session_id = uuid.uuid4()
    frame = encode_frame(
        session_id=session_id, sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=make_channels(10),
    )
    assert frame[24:40] == session_id.bytes  # canónico, no .bytes_le


def test_payload_is_channel_major_not_interleaved():
    channels = make_channels(3)
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=channels,
    )
    raw = np.frombuffer(frame[HEADER_SIZE:], dtype="<f4")
    # Las tres primeras posiciones son el canal I completo; las tres
    # siguientes, el canal II completo. Si estuviera intercalado, la
    # posición 1 sería la primera muestra de II, no la segunda de I.
    assert raw[0:3] == pytest.approx(channels[0], abs=1e-9)
    assert raw[3:6] == pytest.approx(channels[1], abs=1e-9)


def test_encode_rejects_wrong_lead_count():
    with pytest.raises(ValueError, match="12"):
        encode_frame(
            session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
            sample_rate_hz=500, channels_v=np.zeros((6, 50)),
        )


def test_decode_is_the_exact_inverse_of_encode():
    session_id = uuid.uuid4()
    channels = make_channels(50)
    frame = encode_frame(
        session_id=session_id, sequence_number=42, t_start_s=8.3,
        sample_rate_hz=500, channels_v=channels,
    )
    decoded = decode_frame(frame)
    assert decoded.version == 1
    assert decoded.sample_rate_hz == 500
    assert decoded.n_channels == 12
    assert decoded.n_samples_per_channel == 50
    assert decoded.sequence_number == 42
    assert decoded.t_start_s == pytest.approx(8.3)
    assert decoded.session_id == session_id
    assert np.allclose(decoded.channels_v, channels, atol=1e-6)  # precisión float32


def test_decode_rejects_a_truncated_frame():
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=make_channels(50),
    )
    with pytest.raises(ValueError, match="incompleto"):
        decode_frame(frame[:-10])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_frames.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.frames'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/frames.py`:

```python
"""Contrato del frame binario del streaming.

Cabecera fija de 40 bytes, little-endian salvo `session_id`, que va en su
UUID canónico (orden de red, RFC 4122) sin reordenar en ningún extremo. La
cabecera de 40 bytes deja el payload alineado a 4, que es lo que exige
`new Float32Array(buffer, 40, n)` en JavaScript — no es un tamaño arbitrario.
"""

from __future__ import annotations

import struct
import uuid
from dataclasses import dataclass

import numpy as np

from ecg_engine.types import N_LEADS

FRAME_VERSION = 1
HEADER_FORMAT = "<HHBBHIId16s"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)


def encode_frame(
    *,
    session_id: uuid.UUID,
    sequence_number: int,
    t_start_s: float,
    sample_rate_hz: int,
    channels_v: np.ndarray,
) -> bytes:
    if channels_v.ndim != 2 or channels_v.shape[0] != N_LEADS:
        raise ValueError(
            f"channels_v debe tener forma (12, n), recibido {channels_v.shape}"
        )
    n_samples = channels_v.shape[1]
    header = struct.pack(
        HEADER_FORMAT,
        FRAME_VERSION,
        sample_rate_hz,
        N_LEADS,
        0,
        n_samples,
        sequence_number,
        0,
        t_start_s,
        session_id.bytes,
    )
    payload = np.ascontiguousarray(channels_v, dtype="<f4").tobytes()
    return header + payload


@dataclass(frozen=True, slots=True)
class DecodedFrame:
    version: int
    sample_rate_hz: int
    n_channels: int
    n_samples_per_channel: int
    sequence_number: int
    t_start_s: float
    session_id: uuid.UUID
    channels_v: np.ndarray


def decode_frame(data: bytes) -> DecodedFrame:
    if len(data) < HEADER_SIZE:
        raise ValueError(f"frame demasiado corto: {len(data)} bytes")
    (
        version,
        sample_rate_hz,
        n_channels,
        _reserved,
        n_samples,
        sequence_number,
        _reserved2,
        t_start_s,
        session_bytes,
    ) = struct.unpack(HEADER_FORMAT, data[:HEADER_SIZE])

    expected_payload = n_channels * n_samples * 4
    payload = data[HEADER_SIZE : HEADER_SIZE + expected_payload]
    if len(payload) != expected_payload:
        raise ValueError(
            f"payload incompleto: esperados {expected_payload} bytes, "
            f"recibidos {len(payload)}"
        )
    channels_v = np.frombuffer(payload, dtype="<f4").reshape(n_channels, n_samples)
    return DecodedFrame(
        version=version,
        sample_rate_hz=sample_rate_hz,
        n_channels=n_channels,
        n_samples_per_channel=n_samples,
        sequence_number=sequence_number,
        t_start_s=t_start_s,
        session_id=uuid.UUID(bytes=session_bytes),
        channels_v=channels_v,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_frames.py -v`
Expected: PASS, 8 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/frames.py apps/api/tests/unit/test_frames.py
git commit -m "Añadir el codificador y decodificador del frame binario"
```

---

### Task 7: Esquemas de mensajes del WebSocket

**Files:**
- Modify: `apps/api/src/ecg_api/schemas.py`
- Test: `apps/api/tests/unit/test_ws_schemas.py`

**Interfaces:**
- Consumes: `ecg_engine.EngineParams`, `ecg_engine.NoiseParams`, `ecg_engine.VariabilityParams`.
- Produces: `StartMessage`, `UpdateMessage`, `PauseMessage`, `ResumeMessage`, `StopMessage`, `PingMessage`, `ClientMessage` (union), `ClientMessageError`, `parse_client_message(raw: str) -> ClientMessage`, `engine_params_to_dict(params: EngineParams) -> dict`, y los constructores de mensajes salientes `started_message`, `updated_message`, `paused_message`, `resumed_message`, `stopped_message`, `error_message`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_ws_schemas.py`:

```python
import json
import uuid

import pytest

from ecg_api.schemas import (
    ClientMessageError,
    EngineParamsPayload,
    PauseMessage,
    PingMessage,
    ResumeMessage,
    StartMessage,
    StopMessage,
    UpdateMessage,
    engine_params_to_dict,
    error_message,
    parse_client_message,
    started_message,
    stopped_message,
    updated_message,
)
from ecg_engine import EngineParams, NoiseParams


def test_parse_start_message_with_full_params():
    raw = json.dumps({
        "type": "start", "rhythm_id": "sinus_normal", "seed": 20260725,
        "params": {"heart_rate_hz": 1.2},
    })
    message = parse_client_message(raw)
    assert isinstance(message, StartMessage)
    assert message.rhythm_id == "sinus_normal"
    assert message.seed == 20260725
    assert message.params.heart_rate_hz == 1.2


def test_parse_start_message_without_params_defers_to_rhythm_defaults():
    raw = json.dumps({"type": "start", "rhythm_id": "sinus_normal"})
    message = parse_client_message(raw)
    assert message.params is None
    assert message.seed is None


def test_parse_update_message():
    raw = json.dumps({"type": "update", "params": {"heart_rate_hz": 1.5}})
    message = parse_client_message(raw)
    assert isinstance(message, UpdateMessage)
    assert message.params.heart_rate_hz == 1.5


@pytest.mark.parametrize(
    "type_, cls",
    [("pause", PauseMessage), ("resume", ResumeMessage), ("stop", StopMessage)],
)
def test_parse_control_messages_without_body(type_, cls):
    message = parse_client_message(json.dumps({"type": type_}))
    assert isinstance(message, cls)


def test_ping_is_recognised_but_reserved():
    """No se despacha en fase 1, pero el tipo ya existe en el protocolo: se
    podrá activar sin romper clientes que ya lo envían sin esperar respuesta."""
    message = parse_client_message(json.dumps({"type": "ping"}))
    assert isinstance(message, PingMessage)


def test_parse_rejects_unknown_type():
    with pytest.raises(ClientMessageError, match="desconocido"):
        parse_client_message(json.dumps({"type": "teleport"}))


def test_parse_rejects_invalid_json():
    with pytest.raises(ClientMessageError):
        parse_client_message("{not json")


def test_parse_rejects_update_without_params():
    with pytest.raises(ClientMessageError):
        parse_client_message(json.dumps({"type": "update"}))


def test_engine_params_payload_round_trips_to_engine_params():
    payload = EngineParamsPayload(heart_rate_hz=70 / 60)
    params = payload.to_engine_params()
    assert isinstance(params, EngineParams)
    assert params.heart_rate_hz == pytest.approx(70 / 60)
    assert isinstance(params.noise, NoiseParams)


def test_engine_params_to_dict_is_the_inverse_shape():
    params = EngineParams(heart_rate_hz=1.5)
    payload = engine_params_to_dict(params)
    assert payload["heart_rate_hz"] == 1.5
    assert payload["noise"]["emg_v"] == 0.0
    assert "rsa_fraction" in payload["variability"]


def test_server_message_builders_produce_the_documented_shape():
    session_id = uuid.uuid4()
    assert started_message(
        session_id=session_id, seed=1, sample_rate_hz=500, channels=12
    ) == {
        "type": "started", "session_id": str(session_id), "seed": 1,
        "sample_rate_hz": 500, "channels": 12,
    }
    assert stopped_message(duration_s=12.5) == {
        "type": "stopped", "duration_s": 12.5,
    }
    assert error_message(code="NOT_FOUND", detail="x") == {
        "type": "error", "code": "NOT_FOUND", "detail": "x",
    }
    assert (
        updated_message(params=EngineParams(heart_rate_hz=1.0))["params"][
            "heart_rate_hz"
        ]
        == 1.0
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_ws_schemas.py -v`
Expected: FAIL con `ImportError: cannot import name 'StartMessage' from 'ecg_api.schemas'`

- [ ] **Step 3: Write minimal implementation**

Añadir al final de `apps/api/src/ecg_api/schemas.py`:

```python
# --- WebSocket: parámetros del motor --------------------------------------

import json
import uuid
from dataclasses import asdict
from typing import Literal, Union

from pydantic import Field, ValidationError

from ecg_engine import EngineParams, NoiseParams, VariabilityParams


class NoiseParamsPayload(BaseModel):
    emg_v: float = 0.0
    mains_v: float = 0.0
    baseline_v: float = 0.0
    motion_v: float = 0.0
    clip_v: float | None = None


class VariabilityParamsPayload(BaseModel):
    respiration_hz: float = 0.25
    rsa_fraction: float = 0.04
    amplitude_fraction: float = 0.03
    rr_jitter_fraction: float = 0.015


class EngineParamsPayload(BaseModel):
    heart_rate_hz: float
    noise: NoiseParamsPayload = Field(default_factory=NoiseParamsPayload)
    variability: VariabilityParamsPayload = Field(
        default_factory=VariabilityParamsPayload
    )

    def to_engine_params(self) -> EngineParams:
        return EngineParams(
            heart_rate_hz=self.heart_rate_hz,
            noise=NoiseParams(**self.noise.model_dump()),
            variability=VariabilityParams(**self.variability.model_dump()),
        )


def engine_params_to_dict(params: EngineParams) -> dict:
    """El sentido inverso de `to_engine_params`, para mensajes salientes y
    para la columna `params` de la sesión persistida. Sin Pydantic de por
    medio: `EngineParams` y sus dataclasses anidadas ya son inmutables y
    completas, no hace falta validarlas otra vez, solo volcarlas."""
    return {
        "heart_rate_hz": params.heart_rate_hz,
        "noise": asdict(params.noise),
        "variability": asdict(params.variability),
    }


# --- WebSocket: mensajes del cliente ---------------------------------------

class StartMessage(BaseModel):
    type: Literal["start"]
    rhythm_id: str
    params: EngineParamsPayload | None = None
    seed: int | None = None


class UpdateMessage(BaseModel):
    type: Literal["update"]
    params: EngineParamsPayload


class PauseMessage(BaseModel):
    type: Literal["pause"]


class ResumeMessage(BaseModel):
    type: Literal["resume"]


class StopMessage(BaseModel):
    type: Literal["stop"]


class PingMessage(BaseModel):
    """Reservado. Se reconoce pero no se despacha en fase 1: la versión del
    contrato queda lista para medir latencia sin romper clientes existentes
    cuando haga falta en fase 2."""

    type: Literal["ping"]


ClientMessage = Union[
    StartMessage, UpdateMessage, PauseMessage, ResumeMessage, StopMessage,
    PingMessage,
]

_MESSAGE_TYPES: dict[str, type[BaseModel]] = {
    "start": StartMessage,
    "update": UpdateMessage,
    "pause": PauseMessage,
    "resume": ResumeMessage,
    "stop": StopMessage,
    "ping": PingMessage,
}


class ClientMessageError(ValueError):
    """JSON inválido, tipo desconocido, o el cuerpo no valida contra su
    esquema. El llamante la traduce a `error {code: "INVALID_PARAMS"}`."""


def parse_client_message(raw: str) -> ClientMessage:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ClientMessageError(f"JSON inválido: {exc}") from exc
    if not isinstance(payload, dict) or "type" not in payload:
        raise ClientMessageError("falta el campo 'type'")
    model = _MESSAGE_TYPES.get(payload["type"])
    if model is None:
        raise ClientMessageError(
            f"tipo de mensaje desconocido: {payload['type']!r}"
        )
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise ClientMessageError(str(exc)) from exc


# --- WebSocket: mensajes del servidor ---------------------------------------

def started_message(
    *, session_id: uuid.UUID, seed: int, sample_rate_hz: int, channels: int
) -> dict:
    return {
        "type": "started",
        "session_id": str(session_id),
        "seed": seed,
        "sample_rate_hz": sample_rate_hz,
        "channels": channels,
    }


def updated_message(*, params: EngineParams) -> dict:
    return {"type": "updated", "params": engine_params_to_dict(params)}


def paused_message() -> dict:
    return {"type": "paused"}


def resumed_message() -> dict:
    return {"type": "resumed"}


def stopped_message(*, duration_s: float) -> dict:
    return {"type": "stopped", "duration_s": duration_s}


def error_message(*, code: str, detail: str) -> dict:
    return {"type": "error", "code": code, "detail": detail}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_ws_schemas.py -v`
Expected: PASS, 13 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/schemas.py apps/api/tests/unit/test_ws_schemas.py
git commit -m "Añadir esquemas de mensajes del websocket de simulacion"
```

---

### Task 8: Errores de dominio

**Files:**
- Create: `apps/api/src/ecg_api/errors.py`
- Test: `apps/api/tests/unit/test_errors.py`

**Interfaces:**
- Consumes: nada.
- Produces: `SimulationError`, `RhythmNotFoundError` (`code = "NOT_FOUND"`), `InvalidParamsError` (`code = "INVALID_PARAMS"`), `EngineFailureError` (`code = "ENGINE_FAILURE"`).

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_errors.py`:

```python
from ecg_api.errors import (
    EngineFailureError,
    InvalidParamsError,
    RhythmNotFoundError,
    SimulationError,
)


def test_each_error_carries_the_documented_code():
    assert RhythmNotFoundError("x").code == "NOT_FOUND"
    assert InvalidParamsError("x").code == "INVALID_PARAMS"
    assert EngineFailureError("x").code == "ENGINE_FAILURE"


def test_all_domain_errors_derive_from_simulation_error():
    assert issubclass(RhythmNotFoundError, SimulationError)
    assert issubclass(InvalidParamsError, SimulationError)
    assert issubclass(EngineFailureError, SimulationError)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_errors.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.errors'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/errors.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_errors.py -v`
Expected: PASS, 2 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/errors.py apps/api/tests/unit/test_errors.py
git commit -m "Añadir las excepciones de dominio del streaming"
```

---

### Task 9: `SimulationManager`

El envoltorio del motor por conexión. No sabe nada de WebSockets, JSON ni frames binarios: solo el ciclo de vida de una sesión. Esa separación es lo que permite testear toda la lógica sin abrir un socket.

**Files:**
- Create: `apps/api/src/ecg_api/simulation.py`
- Test: `apps/api/tests/unit/test_simulation_manager.py`

**Interfaces:**
- Consumes: `ecg_engine.EcgEngine`, `ecg_engine.EngineParams`; `RhythmNotFoundError` de la Tarea 8.
- Produces: `SimulationState` (enum: `RUNNING`, `PAUSED`, `STOPPED`), `Chunk` (`sequence_number: int`, `t_start_s: float`, `channels_v: np.ndarray`), `SimulationManager` con `start()`, `update()`, `pause()`, `resume()`, `stop()`, `next_chunk()`, y las propiedades `session_id`, `state`, `started_at`, `rhythm_id`, `seed`, `params`, `duration_s`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_simulation_manager.py`:

```python
import uuid

import pytest

from ecg_api.errors import RhythmNotFoundError
from ecg_api.simulation import CHUNK_SAMPLES, SimulationManager, SimulationState
from ecg_engine import EngineParams
from ecg_engine.types import N_LEADS


def test_start_returns_a_fresh_session_id_and_sets_running():
    manager = SimulationManager()
    session_id = manager.start("sinus_normal", None, 20260725)
    assert isinstance(session_id, uuid.UUID)
    assert manager.session_id == session_id
    assert manager.state is SimulationState.RUNNING
    assert manager.rhythm_id == "sinus_normal"
    assert manager.seed == 20260725


def test_start_without_seed_assigns_one():
    manager = SimulationManager()
    manager.start("sinus_normal", None, None)
    assert isinstance(manager.seed, int)


def test_start_without_params_uses_the_rhythm_defaults():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    assert manager.params.heart_rate_hz == pytest.approx(70 / 60)


def test_start_with_unknown_rhythm_raises_the_domain_error():
    manager = SimulationManager()
    with pytest.raises(RhythmNotFoundError):
        manager.start("no_existe", None, 1)
    assert manager.state is SimulationState.STOPPED  # no quedó a medias


def test_next_chunk_has_the_documented_shape():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    chunk = manager.next_chunk()
    assert chunk.sequence_number == 0
    assert chunk.t_start_s == pytest.approx(0.0)
    assert chunk.channels_v.shape == (N_LEADS, CHUNK_SAMPLES)


def test_sequence_number_increments_and_t_start_advances():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    first = manager.next_chunk()
    second = manager.next_chunk()
    assert second.sequence_number == first.sequence_number + 1
    assert second.t_start_s == pytest.approx(first.t_start_s + CHUNK_SAMPLES / 500)


def test_update_clamps_to_the_rhythm_range_like_the_engine_does():
    manager = SimulationManager()
    manager.start("sinus_bradycardia", None, 1)
    applied = manager.update(EngineParams(heart_rate_hz=300 / 60))
    assert applied.heart_rate_hz <= 60 / 60


def test_pause_and_resume_toggle_state_without_touching_the_engine():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    manager.pause()
    assert manager.state is SimulationState.PAUSED
    manager.resume()
    assert manager.state is SimulationState.RUNNING


def test_stop_returns_the_simulated_duration():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    for _ in range(50):  # 50 chunks * 50 muestras a 500 Hz = 5,0 s simulados
        manager.next_chunk()
    duration_s = manager.stop()
    assert duration_s == pytest.approx(5.0)
    assert manager.state is SimulationState.STOPPED


def test_duration_is_simulated_time_not_wall_clock():
    """La regla de persistencia (≥5 s) mira tiempo simulado, no tiempo real:
    por eso este test tarda milisegundos en producir una sesión de 10 s."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    assert manager.duration_s == pytest.approx(0.0)
    for _ in range(100):
        manager.next_chunk()
    assert manager.duration_s == pytest.approx(10.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_simulation_manager.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.simulation'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/simulation.py`:

```python
"""Envoltorio del motor por conexión WebSocket.

Un `SimulationManager` no sabe nada de WebSockets, JSON ni frames binarios:
solo envuelve `EcgEngine` con el ciclo de vida que necesita una sesión y
produce chunks de señal. Esa separación es la que permite testear toda la
lógica de sesión sin abrir un solo socket.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid
from dataclasses import dataclass
from enum import Enum

import numpy as np

from ecg_engine import EcgEngine, EngineParams

from .errors import RhythmNotFoundError

CHUNK_SAMPLES = 50  # 100 ms a 500 Hz — la cadencia de streaming del diseño
_SEED_UPPER_BOUND = 2**31


class SimulationState(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"


@dataclass(frozen=True, slots=True)
class Chunk:
    sequence_number: int
    t_start_s: float
    channels_v: np.ndarray


class SimulationManager:
    def __init__(self) -> None:
        self.session_id: uuid.UUID | None = None
        self.state: SimulationState = SimulationState.STOPPED
        self.started_at: dt.datetime | None = None
        self._engine: EcgEngine | None = None
        self._sequence_number: int = 0

    def start(
        self,
        rhythm_id: str,
        params: EngineParams | None,
        seed: int | None,
    ) -> uuid.UUID:
        resolved_seed = (
            seed if seed is not None else secrets.randbelow(_SEED_UPPER_BOUND)
        )
        try:
            self._engine = EcgEngine(
                rhythm_id=rhythm_id, seed=resolved_seed, params=params
            )
        except KeyError as exc:
            raise RhythmNotFoundError(str(exc)) from exc
        self.session_id = uuid.uuid4()
        self.started_at = dt.datetime.now(dt.timezone.utc)
        self._sequence_number = 0
        self.state = SimulationState.RUNNING
        return self.session_id

    @property
    def rhythm_id(self) -> str:
        assert self._engine is not None
        return self._engine.rhythm_id

    @property
    def seed(self) -> int:
        assert self._engine is not None
        return self._engine.seed

    @property
    def params(self) -> EngineParams:
        assert self._engine is not None
        return self._engine.params

    @property
    def duration_s(self) -> float:
        """Tiempo de simulación transcurrido, no tiempo de reloj de pared.

        Es lo que permite testear la regla de persistencia (≥ 5 s) sin
        esperar 5 segundos reales: generar 2500 muestras a 500 Hz produce
        5,0 s simulados casi al instante.
        """
        assert self._engine is not None
        return self._engine.t_s

    def update(self, params: EngineParams) -> EngineParams:
        assert self._engine is not None
        self._engine.update_params(params)
        return self._engine.params

    def pause(self) -> None:
        self.state = SimulationState.PAUSED

    def resume(self) -> None:
        self.state = SimulationState.RUNNING

    def stop(self) -> float:
        self.state = SimulationState.STOPPED
        return self.duration_s

    def next_chunk(self) -> Chunk:
        """Genera el siguiente trozo. El llamante decide cuándo llamar —
        normalmente solo mientras `state is RUNNING`; pausar no es más que
        dejar de llamar aquí, igual que en `EcgEngine.generate`."""
        assert self._engine is not None
        t_start_s = self._engine.t_s
        channels_v = self._engine.generate(CHUNK_SAMPLES)
        chunk = Chunk(
            sequence_number=self._sequence_number,
            t_start_s=t_start_s,
            channels_v=channels_v,
        )
        self._sequence_number += 1
        return chunk
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_simulation_manager.py -v`
Expected: PASS, 10 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/simulation.py apps/api/tests/unit/test_simulation_manager.py
git commit -m "Añadir el SimulationManager que envuelve el motor por conexion"
```

---

### Task 10: `FrameOutbox` — cola acotada con descarte de lo más antiguo

**Files:**
- Create: `apps/api/src/ecg_api/outbox.py`
- Test: `apps/api/tests/unit/test_outbox.py`

**Interfaces:**
- Consumes: nada.
- Produces: `FrameOutbox(maxsize: int = 20)` con `put(frame: bytes) -> None`, `async get() -> bytes`, `__len__`, `dropped_count: int`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_outbox.py`:

```python
import asyncio

import pytest

from ecg_api.outbox import FrameOutbox


def test_put_and_get_preserve_count_under_capacity():
    outbox = FrameOutbox(maxsize=5)
    outbox.put(b"a")
    outbox.put(b"b")
    assert len(outbox) == 2


def test_put_drops_the_oldest_frame_when_full():
    outbox = FrameOutbox(maxsize=3)
    for i in range(5):
        outbox.put(bytes([i]))
    assert len(outbox) == 3
    assert outbox.dropped_count == 2


async def test_get_returns_frames_in_fifo_order():
    outbox = FrameOutbox(maxsize=5)
    outbox.put(b"first")
    outbox.put(b"second")
    assert await outbox.get() == b"first"
    assert await outbox.get() == b"second"


def test_full_outbox_keeps_the_newest_frames_not_the_oldest():
    """La política es descartar lo más antiguo. Si se descartara lo más
    nuevo, un cliente lento vería la simulación congelada en el pasado en
    vez de saltar hacia el presente al ponerse al día."""
    outbox = FrameOutbox(maxsize=2)
    outbox.put(b"oldest")
    outbox.put(b"middle")
    outbox.put(b"newest")
    assert list(outbox._frames) == [b"middle", b"newest"]


async def test_get_waits_until_a_frame_is_available():
    outbox = FrameOutbox(maxsize=5)

    async def producer():
        await asyncio.sleep(0.01)
        outbox.put(b"delayed")

    task = asyncio.create_task(producer())
    frame = await outbox.get()
    await task
    assert frame == b"delayed"


def test_maxsize_must_be_positive():
    with pytest.raises(ValueError, match="maxsize"):
        FrameOutbox(maxsize=0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_outbox.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.outbox'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/outbox.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_outbox.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/outbox.py apps/api/tests/unit/test_outbox.py
git commit -m "Añadir la cola de salida con descarte del frame mas antiguo"
```

---

### Task 11: Bucle de streaming

**Files:**
- Create: `apps/api/src/ecg_api/streaming.py`
- Test: `apps/api/tests/unit/test_streaming.py`

**Interfaces:**
- Consumes: `SimulationManager`, `SimulationState` de la Tarea 9; `FrameOutbox` de la Tarea 10; `encode_frame` de la Tarea 6.
- Produces: `CHUNK_INTERVAL_S: float` (= 0.1), `async stream_chunks(manager, outbox, sample_rate_hz, *, interval_s=CHUNK_INTERVAL_S) -> None` — corre indefinidamente hasta que se cancele su tarea.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_streaming.py`:

```python
import asyncio

import pytest

from ecg_api.frames import decode_frame
from ecg_api.outbox import FrameOutbox
from ecg_api.simulation import SimulationManager
from ecg_api.streaming import stream_chunks


async def _run_briefly(manager, outbox, n_iterations: int, interval_s: float = 0.01):
    task = asyncio.create_task(
        stream_chunks(manager, outbox, sample_rate_hz=500, interval_s=interval_s)
    )
    await asyncio.sleep(interval_s * n_iterations * 1.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_running_manager_produces_frames_at_the_configured_cadence():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    outbox = FrameOutbox(maxsize=100)

    await _run_briefly(manager, outbox, n_iterations=5)

    assert len(outbox) >= 2  # margen frente al jitter del scheduler


async def test_frames_have_increasing_sequence_numbers_and_the_right_session():
    manager = SimulationManager()
    session_id = manager.start("sinus_normal", None, 1)
    outbox = FrameOutbox(maxsize=100)

    await _run_briefly(manager, outbox, n_iterations=5)

    n_frames = len(outbox)
    assert n_frames > 0  # si no hay frames, las comprobaciones de abajo son
    # verdad por vacuidad y el test no prueba nada
    decoded = [decode_frame(await outbox.get()) for _ in range(n_frames)]
    sequence_numbers = [d.sequence_number for d in decoded]
    assert sequence_numbers == sorted(sequence_numbers)
    assert all(d.session_id == session_id for d in decoded)


async def test_paused_manager_produces_no_new_frames():
    manager = SimulationManager()
    manager.start("sinus_normal", None, 1)
    outbox = FrameOutbox(maxsize=100)

    await _run_briefly(manager, outbox, n_iterations=3)
    frames_before_pause = len(outbox)
    assert frames_before_pause > 0  # si no, "no crece" no significa nada
    manager.pause()
    await _run_briefly(manager, outbox, n_iterations=3)

    assert len(outbox) == frames_before_pause
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/unit/test_streaming.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.streaming'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/streaming.py`:

```python
"""Bucle de producción de chunks a intervalo fijo.

Genera un chunk cada `interval_s` mientras `manager.state` sea `RUNNING`; en
cualquier otro estado se limita a esperar. Pausar la simulación no es más
que dejar de llamar a `next_chunk`, el mismo principio que ya usa
`EcgEngine.generate`.

No conoce el WebSocket: escribe en un `FrameOutbox`, que es lo que permite
testear el bucle con un objeto en memoria en vez de una conexión de red real.
"""

from __future__ import annotations

import asyncio

from .frames import encode_frame
from .outbox import FrameOutbox
from .simulation import SimulationManager, SimulationState

CHUNK_INTERVAL_S = 0.1  # ~10 mensajes/s, la cadencia del diseño


async def stream_chunks(
    manager: SimulationManager,
    outbox: FrameOutbox,
    sample_rate_hz: int,
    *,
    interval_s: float = CHUNK_INTERVAL_S,
) -> None:
    while True:
        if manager.state is SimulationState.RUNNING:
            assert manager.session_id is not None
            chunk = manager.next_chunk()
            frame = encode_frame(
                session_id=manager.session_id,
                sequence_number=chunk.sequence_number,
                t_start_s=chunk.t_start_s,
                sample_rate_hz=sample_rate_hz,
                channels_v=chunk.channels_v,
            )
            outbox.put(frame)
        await asyncio.sleep(interval_s)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/unit/test_streaming.py -v`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/streaming.py apps/api/tests/unit/test_streaming.py
git commit -m "Añadir el bucle de streaming de chunks"
```

---

### Task 12: Persistencia de sesión

**Files:**
- Create: `apps/api/src/ecg_api/persistence.py`
- Test: `apps/api/tests/integration/test_persistence.py`

**Interfaces:**
- Consumes: `SessionRow` de la Tarea 3; `engine_params_to_dict` de la Tarea 7; `SimulationManager` de la Tarea 9; `Settings` de la Tarea 2; `seed_catalog` de la Tarea 4 (solo en el test, para satisfacer la FK).
- Produces: `MIN_PERSISTABLE_DURATION_S: float` (= 5.0), `async persist_session(session, manager, settings) -> None`, `should_persist(manager) -> bool`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/integration/test_persistence.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_persistence.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.persistence'`

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/persistence.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/integration/test_persistence.py -v`
Expected: PASS, 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/persistence.py apps/api/tests/integration/test_persistence.py
git commit -m "Añadir la persistencia de sesion al cerrarse"
```

---

### Task 13: `WS /ws/simulation` — la ruta caliente

Aquí se conecta todo lo anterior. Dos trampas que conviene conocer antes de tocar el código:

**La caché de `get_settings()` fija la base de datos para toda la sesión de tests.** `Settings` usa `lru_cache`: la primera vez que algo llama a `get_settings()` en todo el proceso de pytest, el resultado queda fijado para el resto — no importa qué variable de entorno cambie después. Como el ciclo de vida de la app (`lifespan`) llama a `get_settings()`, hay que fijar `DATABASE_URL` a la base de test **antes** de que ningún test importe `ecg_api.main`, o los tests de esta tarea y la siguiente acabarían escribiendo en la base de desarrollo según qué test corriera primero.

**Un fallo del motor a mitad de streaming no llega por el mismo camino que un fallo al despachar un mensaje.** El bucle de producción de chunks corre en una tarea de fondo; si el motor lanza ahí, nadie lo ve hasta que se engancha un `done_callback` a esa tarea. Sin eso, el cliente se quedaría sin datos y sin explicación.

**El arreglo de la trampa anterior tiene un efecto secundario en un test de la Tarea 2.** Fijar `DATABASE_URL`/`ENGINE_COMMIT` en `os.environ` desde `conftest.py` los deja puestos para **todo el proceso** de pytest, no solo para los tests de integración. `test_settings_have_sane_defaults` (Tarea 2) construye `Settings(_env_file=None)` esperando los valores por defecto — `_env_file=None` solo desactiva la lectura de `.env`, no la del entorno, así que ese test empieza a fallar en cuanto corre junto a la suite de integración. Hay que limpiar esas dos variables al principio del test con `monkeypatch.delenv(..., raising=False)`.

**Files:**
- Create: `apps/api/src/ecg_api/routers/simulation_ws.py`
- Modify: `apps/api/src/ecg_api/main.py`
- Modify: `apps/api/tests/integration/conftest.py`
- Modify: `apps/api/tests/unit/test_config.py`
- Test: `apps/api/tests/integration/test_simulation_ws.py`

**Interfaces:**
- Consumes: todo lo de las Tareas 6-12.
- Produces: `WS /ws/simulation`. `app.state.settings`, `app.state.session_factory` disponibles desde el arranque de la aplicación (vía `lifespan`).

- [ ] **Step 1: Write the failing test**

Modificar `apps/api/tests/integration/conftest.py`, añadiendo justo después del docstring del módulo:

```python
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
```

Crear `apps/api/tests/integration/test_simulation_ws.py`:

```python
"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from ecg_api.frames import decode_frame
from ecg_api.main import app


def _next_json_message(ws) -> dict:
    """Descarta cualquier frame binario en tránsito y devuelve el primer
    mensaje de texto (JSON). Tras `stop` puede haber uno o dos frames
    binarios ya en vuelo antes de que llegue `stopped`.

    Los mensajes que el servidor envía al cliente llevan `type:
    "websocket.send"` en el sobre ASGI (`"websocket.receive"` es el tipo
    para los mensajes que el cliente envía al servidor) — de ahí que se
    compruebe contra `"websocket.send"` y no contra `"websocket.receive"`.
    """
    while True:
        event = ws.receive()
        if event.get("type") == "websocket.send" and "text" in event:
            return json.loads(event["text"])


def test_start_receives_started_then_binary_frames():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 20260725}
            )
            started = ws.receive_json()
            assert started["type"] == "started"
            assert started["sample_rate_hz"] == 500
            assert started["channels"] == 12

            decoded = decode_frame(ws.receive_bytes())
            assert decoded.sample_rate_hz == 500
            assert decoded.n_channels == 12
            assert decoded.sequence_number == 0
            assert str(decoded.session_id) == started["session_id"]

            ws.send_json({"type": "stop"})
            stopped = _next_json_message(ws)
            assert stopped["type"] == "stopped"
            assert "duration_s" in stopped


def test_unknown_rhythm_reports_not_found_without_closing():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "start", "rhythm_id": "no_existe"})
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "NOT_FOUND"

            # el socket sigue vivo: un start válido a continuación funciona
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = ws.receive_json()
            assert started["type"] == "started"


def test_update_before_start_reports_invalid_params_without_closing():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "update", "params": {"heart_rate_hz": 1.0}})
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "INVALID_PARAMS"

            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = ws.receive_json()
            assert started["type"] == "started"


def test_update_changes_the_rate_observably():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            ws.receive_json()

            ws.send_json(
                {"type": "update", "params": {"heart_rate_hz": 1.5}}
            )
            updated = ws.receive_json()
            assert updated["type"] == "updated"
            # 1,5 Hz = 90 lpm, dentro del rango editable de sinus_normal
            # (60-100 lpm). 2,0 Hz se recortaría al máximo del ritmo y la
            # comparación de igualdad nunca sería cierta.
            assert updated["params"]["heart_rate_hz"] == 1.5


def test_pause_stops_frames_and_resume_continues_them():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            ws.receive_json()
            ws.receive_bytes()  # al menos un frame antes de pausar

            ws.send_json({"type": "pause"})
            paused = ws.receive_json()
            assert paused["type"] == "paused"

            ws.send_json({"type": "resume"})
            resumed = ws.receive_json()
            assert resumed["type"] == "resumed"

            # tras reanudar, vuelven a llegar frames
            decode_frame(ws.receive_bytes())


def test_sequence_number_is_monotonic_across_several_frames():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 5}
            )
            ws.receive_json()

            sequence_numbers = [
                decode_frame(ws.receive_bytes()).sequence_number
                for _ in range(5)
            ]
            assert sequence_numbers == sorted(sequence_numbers)
            assert len(set(sequence_numbers)) == len(sequence_numbers)

            ws.send_json({"type": "stop"})
            assert _next_json_message(ws)["type"] == "stopped"


def test_engine_failure_during_streaming_sends_error_and_closes_with_1011():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            with patch(
                "ecg_engine.EcgEngine.generate",
                side_effect=RuntimeError("fallo simulado del motor"),
            ):
                ws.send_json(
                    {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
                )
                ws.receive_json()  # started
                error = ws.receive_json()
                assert error["type"] == "error"
                assert error["code"] == "ENGINE_FAILURE"
```

- [ ] **Step 2: Run test to verify it fails**

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_simulation_ws.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_api.routers.simulation_ws'` (o 404 al conectar el WebSocket, si el módulo importa pero la ruta no está registrada)

- [ ] **Step 3: Write minimal implementation**

Crear `apps/api/src/ecg_api/routers/simulation_ws.py`:

```python
"""WS /ws/simulation — la ruta caliente.

Controla el ciclo de vida completo de una simulación: recibe mensajes de
control en JSON, produce chunks en tareas de fondo, y los envía en binario
a través de una cola con descarte de lo más antiguo. Persiste la sesión
exactamente una vez, al cerrarse — nunca durante el streaming.
"""

from __future__ import annotations

import asyncio
import functools
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ecg_engine.types import DEFAULT_SAMPLE_RATE_HZ

from ..errors import SimulationError
from ..outbox import FrameOutbox
from ..persistence import persist_session, should_persist
from ..schemas import (
    ClientMessageError,
    PauseMessage,
    PingMessage,
    ResumeMessage,
    StartMessage,
    StopMessage,
    UpdateMessage,
    error_message,
    parse_client_message,
    paused_message,
    resumed_message,
    started_message,
    stopped_message,
    updated_message,
)
from ..simulation import SimulationManager
from ..streaming import stream_chunks

router = APIRouter()
logger = logging.getLogger("ecg_api.simulation_ws")

OUTBOX_MAXSIZE = 20

# La frecuencia de muestreo no es una opción de configuración: es
# `DEFAULT_SAMPLE_RATE_HZ` del motor, la misma constante que `EcgEngine` usa
# quien no le pase `sample_rate_hz` explícito. Convertirla en un valor de
# `Settings` independiente habría creado dos fuentes de verdad que podían
# desincronizarse — el servidor anunciando en `started` y en cada cabecera
# de frame una frecuencia distinta de la que el motor realmente genera.


async def _sender_loop(websocket: WebSocket, outbox: FrameOutbox) -> None:
    while True:
        frame = await outbox.get()
        await websocket.send_bytes(frame)


def _log_engine_failure(manager: SimulationManager, exc: BaseException) -> None:
    logger.error(
        "fallo del motor: session_id=%s seed=%s",
        manager.session_id,
        manager.seed if manager.session_id else None,
        exc_info=exc,
    )


async def _close_after_engine_failure(websocket: WebSocket, detail: str) -> None:
    try:
        await websocket.send_json(
            error_message(code="ENGINE_FAILURE", detail=detail)
        )
    except Exception:  # noqa: BLE001 — el socket puede estar ya cerrado
        pass
    try:
        await websocket.close(code=1011)
    except Exception:  # noqa: BLE001
        pass


def _on_background_task_done(
    task: asyncio.Task, *, websocket: WebSocket, manager: SimulationManager
) -> None:
    """Un fallo del motor durante el streaming corre en una tarea de fondo,
    no en el bucle que despacha mensajes. Sin este enganche, el cliente se
    quedaría sin datos y sin ningún `error` que lo explique."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    _log_engine_failure(manager, exc)
    asyncio.create_task(_close_after_engine_failure(websocket, str(exc)))


async def _stop_background_tasks(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _reject_if_no_active_session(
    websocket: WebSocket, manager: SimulationManager
) -> bool:
    """True si ya se envió un error y el mensaje debe descartarse."""
    if manager.session_id is not None:
        return False
    await websocket.send_json(
        error_message(
            code="INVALID_PARAMS",
            detail="no hay ninguna simulación activa; envía 'start' primero",
        )
    )
    return True


@router.websocket("/ws/simulation")
async def simulation_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    settings = websocket.app.state.settings
    session_factory = websocket.app.state.session_factory

    manager = SimulationManager()
    outbox = FrameOutbox(maxsize=OUTBOX_MAXSIZE)
    background_tasks: list[asyncio.Task] = []
    persisted = False

    async def _maybe_persist() -> None:
        nonlocal persisted
        if persisted or not should_persist(manager):
            return
        async with session_factory() as db:
            await persist_session(db, manager, settings)
        persisted = True

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = parse_client_message(raw)
            except ClientMessageError as exc:
                await websocket.send_json(
                    error_message(code="INVALID_PARAMS", detail=str(exc))
                )
                continue

            if isinstance(message, StartMessage):
                try:
                    session_id = manager.start(
                        message.rhythm_id,
                        message.params.to_engine_params()
                        if message.params
                        else None,
                        message.seed,
                    )
                except SimulationError as exc:
                    await websocket.send_json(
                        error_message(code=exc.code, detail=str(exc))
                    )
                    continue
                await websocket.send_json(
                    started_message(
                        session_id=session_id,
                        seed=manager.seed,
                        sample_rate_hz=DEFAULT_SAMPLE_RATE_HZ,
                        channels=12,
                    )
                )
                producer_task = asyncio.create_task(
                    stream_chunks(manager, outbox, DEFAULT_SAMPLE_RATE_HZ)
                )
                sender_task = asyncio.create_task(_sender_loop(websocket, outbox))
                for task in (producer_task, sender_task):
                    task.add_done_callback(
                        functools.partial(
                            _on_background_task_done,
                            websocket=websocket,
                            manager=manager,
                        )
                    )
                background_tasks = [producer_task, sender_task]

            elif isinstance(message, UpdateMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                applied = manager.update(message.params.to_engine_params())
                await websocket.send_json(updated_message(params=applied))

            elif isinstance(message, PauseMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                manager.pause()
                await websocket.send_json(paused_message())

            elif isinstance(message, ResumeMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                manager.resume()
                await websocket.send_json(resumed_message())

            elif isinstance(message, StopMessage):
                if await _reject_if_no_active_session(websocket, manager):
                    continue
                duration_s = manager.stop()
                await _stop_background_tasks(background_tasks)
                await websocket.send_json(stopped_message(duration_s=duration_s))
                await _maybe_persist()
                return

            elif isinstance(message, PingMessage):
                continue  # reservado: se reconoce, no se despacha en fase 1

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — cualquier fallo no anticipado en
        # el bucle principal se trata como ENGINE_FAILURE: el catálogo de
        # códigos de la spec no distingue más granularidad, y cerrar la
        # conexión es lo seguro cuando no se sabe en qué estado quedó la
        # sesión.
        _log_engine_failure(manager, exc)
        await _close_after_engine_failure(websocket, str(exc))
    finally:
        await _stop_background_tasks(background_tasks)
        await _maybe_persist()
```

Modificar `apps/api/src/ecg_api/main.py` por completo:

```python
"""Punto de entrada de la API.

Un solo worker de uvicorn: el estado de simulación vive en memoria del
proceso que sostiene cada WebSocket, y varios workers romperían ese
binding. Es una restricción de despliegue documentada, no un accidente.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from .config import get_settings
from .db.base import get_engine
from .db.seed import seed_catalog
from .routers.health import router as health_router
from .routers.rhythms import router as rhythms_router
from .routers.simulation_ws import router as simulation_ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    engine = get_engine(settings.database_url)
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with app.state.session_factory() as session:
        await seed_catalog(session, settings)
    yield
    await engine.dispose()


app = FastAPI(title="Simulador de ECG — API", lifespan=lifespan)

app.include_router(health_router)
app.include_router(rhythms_router)
app.include_router(simulation_ws_router)
```

Los tests de las Tareas 1 y 5 usan `TestClient(app)` sin bloque `with`, que no dispara el ciclo de vida — y ni `/api/health` ni `/api/rhythms` leen `app.state`, así que siguen en verde sin tocarlos.

Modificar `apps/api/tests/unit/test_config.py`, limpiando las variables de entorno que ahora fija `conftest.py` de integración:

```python
def test_settings_have_sane_defaults(monkeypatch):
    # `tests/integration/conftest.py` fija `DATABASE_URL`/`ENGINE_COMMIT` en
    # el entorno del proceso de pytest para que `lifespan` apunte siempre a
    # la base de test (ver su comentario). `_env_file=None` solo desactiva
    # la lectura de `.env`, no la del entorno, así que hace falta limpiarlas
    # aquí explícitamente para probar los valores por defecto reales cuando
    # los tests de esta tarea y los de integración corren en la misma sesión.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ENGINE_COMMIT", raising=False)
    settings = Settings(_env_file=None)
    assert settings.engine_commit == "dev"
    assert "postgresql+asyncpg://" in settings.database_url
```

El resto del fichero (`test_settings_read_from_environment`) no cambia.

- [ ] **Step 4: Run test to verify it passes**

Primero confirma que nada se rompió:

Run: `cd apps/api && uv run pytest tests/unit -v`
Expected: PASS, todos los tests unitarios en verde

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_simulation_ws.py -v`
Expected: PASS, 7 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/routers/simulation_ws.py apps/api/src/ecg_api/main.py apps/api/tests/integration/conftest.py apps/api/tests/unit/test_config.py apps/api/tests/integration/test_simulation_ws.py
git commit -m "Conectar el websocket de simulacion: la ruta caliente completa"
```

---

### Task 14: `GET /api/sessions`, `GET /api/sessions/{id}`

Lectura pura de Postgres. El único escritor es `persist_session`, llamado desde el WebSocket al cerrarse — esta tarea no escribe nada.

**Una condición de carrera real, destapada por los tests de esta tarea.** Los tests de persistencia arrancan una simulación por WebSocket, la dejan superar el umbral de 5 s, envían `stop` y cierran la conexión sin esperar el `stopped` de vuelta — exactamente lo que hace un cliente real cuando la pestaña se cierra o la red cae justo después de parar. Starlette cancela la corrutina del handler al desconectar, y esa cancelación puede llegar a mitad de `await session.commit()` dentro de `persist_session`, perdiendo en silencio una sesión que ya había decidido persistirse. No es un artefacto de test: es un bug de pérdida de datos.

El arreglo blinda esa escritura ya decidida con `anyio.CancelScope(shield=True)` en `_maybe_persist()` de `simulation_ws.py` (tarea 13). Pero blindar contra cancelación tiene un coste que hay que compensar: `shield=True` protege de la *propagación de cancelación*, no de un fallo de I/O — si la conexión estuviera genuinamente muerta en vez de solo "el cliente no esperó", la vía de escape por cancelación del cliente queda bloqueada a propósito, y sin más, `commit()` podría colgarse para siempre en vez de fallar rápido. Por eso el shield lleva dentro un `anyio.fail_after(5.0)`: cambia "pierde la sesión" por "cuelga el handler", no lo deja sin red de seguridad.

**Files:**
- Modify: `apps/api/src/ecg_api/schemas.py`
- Create: `apps/api/src/ecg_api/routers/sessions.py`
- Modify: `apps/api/src/ecg_api/main.py`
- Modify: `apps/api/src/ecg_api/routers/simulation_ws.py` (tarea 13, ver arriba)
- Test: `apps/api/tests/integration/test_sessions_router.py`

**Interfaces:**
- Consumes: `SessionRow` de la Tarea 3.
- Produces: `SessionSummary`, `SessionDetail` en `ecg_api.schemas`. `GET /api/sessions` (lista, más recientes primero, límite de 50), `GET /api/sessions/{session_id}` (detalle, 404 si no existe o el id no es un UUID válido).

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/integration/test_sessions_router.py`:

```python
"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

from fastapi.testclient import TestClient

from ecg_api.main import app


def _start_and_stop_a_session(client, rhythm_id="sinus_normal", seed=1):
    with client.websocket_connect("/ws/simulation") as ws:
        ws.send_json({"type": "start", "rhythm_id": rhythm_id, "seed": seed})
        started = ws.receive_json()
        for _ in range(60):  # 60 * 100 ms = 6 s simulados, por encima del umbral de 5
            ws.receive_bytes()
        ws.send_json({"type": "stop"})
    return started["session_id"]


def test_list_sessions_includes_a_persisted_session():
    with TestClient(app) as client:
        session_id = _start_and_stop_a_session(client)
        response = client.get("/api/sessions")
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert session_id in ids


def test_get_session_detail_has_the_documented_fields():
    with TestClient(app) as client:
        session_id = _start_and_stop_a_session(
            client, rhythm_id="sinus_bradycardia", seed=7
        )
        response = client.get(f"/api/sessions/{session_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["rhythm_id"] == "sinus_bradycardia"
        assert body["seed"] == 7
        assert body["engine_semver"].count(".") == 2
        assert body["duration_s"] >= 5.0
        assert "params" in body


def test_get_session_404_for_unknown_id():
    with TestClient(app) as client:
        response = client.get(
            "/api/sessions/00000000-0000-0000-0000-000000000000"
        )
        assert response.status_code == 404


def test_get_session_404_for_malformed_id():
    with TestClient(app) as client:
        response = client.get("/api/sessions/not-a-uuid")
        assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_sessions_router.py -v`
Expected: FAIL con 404 en `/api/sessions` (ruta no registrada) o `ImportError`

- [ ] **Step 3: Write minimal implementation**

Añadir al final de `apps/api/src/ecg_api/schemas.py`:

```python
# --- REST: sesiones ---------------------------------------------------------

import datetime as dt


class SessionSummary(BaseModel):
    id: uuid.UUID
    rhythm_id: str
    started_at: dt.datetime
    duration_s: float | None


class SessionDetail(SessionSummary):
    params: dict
    seed: int
    engine_semver: str
    engine_commit: str
    ended_at: dt.datetime | None
```

Crear `apps/api/src/ecg_api/routers/sessions.py`:

```python
"""Historial de sesiones. Lectura pura de Postgres.

El único escritor es `persist_session`, llamado desde el handler del
WebSocket al cerrarse — esta capa no escribe nada.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from ..db.models import SessionRow
from ..schemas import SessionDetail, SessionSummary

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

LIST_LIMIT = 50


def _to_summary(row: SessionRow) -> SessionSummary:
    return SessionSummary(
        id=row.id,
        rhythm_id=row.rhythm_id,
        started_at=row.started_at,
        duration_s=float(row.duration_s) if row.duration_s is not None else None,
    )


def _to_detail(row: SessionRow) -> SessionDetail:
    return SessionDetail(
        **_to_summary(row).model_dump(),
        params=row.params,
        seed=row.seed,
        engine_semver=row.engine_semver,
        engine_commit=row.engine_commit,
        ended_at=row.ended_at,
    )


@router.get("", response_model=list[SessionSummary])
async def list_sessions(request: Request) -> list[SessionSummary]:
    session_factory = request.app.state.session_factory
    async with session_factory() as db:
        rows = (
            await db.execute(
                select(SessionRow)
                .order_by(SessionRow.started_at.desc())
                .limit(LIST_LIMIT)
            )
        ).scalars().all()
    return [_to_summary(r) for r in rows]


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, request: Request) -> SessionDetail:
    try:
        parsed_id = uuid.UUID(session_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404, detail="id de sesión inválido"
        ) from exc

    session_factory = request.app.state.session_factory
    async with session_factory() as db:
        row = await db.get(SessionRow, parsed_id)
    if row is None:
        raise HTTPException(status_code=404, detail="sesión no encontrada")
    return _to_detail(row)
```

Modificar `apps/api/src/ecg_api/main.py`, añadiendo el router nuevo:

```python
from .routers.health import router as health_router
from .routers.rhythms import router as rhythms_router
from .routers.sessions import router as sessions_router
from .routers.simulation_ws import router as simulation_ws_router

...

app.include_router(health_router)
app.include_router(rhythms_router)
app.include_router(sessions_router)
app.include_router(simulation_ws_router)
```

Modificar `apps/api/src/ecg_api/routers/simulation_ws.py`: añadir el import de `anyio` y blindar la escritura de `_maybe_persist()` contra la cancelación del cliente al desconectar.

Añadir el import, junto al resto de imports del módulo:

```python
import anyio
```

Sustituir el cuerpo de `_maybe_persist`:

```python
    async def _maybe_persist() -> None:
        nonlocal persisted
        if persisted or not should_persist(manager):
            return
        # `shield=True`: si el cliente cierra el socket justo tras enviar
        # `stop` sin esperar el `stopped` de vuelta (un cierre de pestaña, una
        # caída de red), Starlette cancela esta corrutina al desconectar. Sin
        # blindar la escritura, esa cancelación puede llegar a mitad de
        # `session.commit()` y la sesión —que ya cumplió el umbral de 5 s— se
        # pierde en silencio.
        #
        # El shield tiene un coste que hay que compensar: protege de la
        # cancelación del cliente, no de un fallo de I/O real. Sin el
        # `fail_after`, una conexión genuinamente muerta colgaría el handler
        # para siempre en vez de fallar rápido, porque la única vía de escape
        # —la cancelación externa— queda bloqueada a propósito. Con él, el
        # peor caso pasa de "cuelga indefinidamente" a "falla en 5 s".
        try:
            with anyio.CancelScope(shield=True):
                with anyio.fail_after(5.0):
                    async with session_factory() as db:
                        await persist_session(db, manager, settings)
        except Exception:  # noqa: BLE001 — cualquier fallo de persistencia,
            # no solo el timeout: `_maybe_persist()` se llama tanto al
            # recibir `stop` como, otra vez, en el `finally` de
            # `simulation_ws()`. Si no marcamos `persisted` aquí ante CUALQUIER
            # fallo (timeout, conexión caída, error de Postgres), el `finally`
            # reintentaría contra la misma conexión rota y dejaría escapar un
            # segundo error sin capturar, tumbando el handler del WebSocket en
            # vez de cerrarlo con gracia.
            logger.error(
                "No se pudo persistir la sesión %s: se descarta sin reintentar",
                manager.session_id,
                exc_info=True,
            )
        persisted = True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/integration/test_sessions_router.py -v`
Expected: PASS, 4 passed

Y confirma que el WebSocket sigue en verde, porque el cambio toca un fichero de la tarea 13:

Run: `cd apps/api && uv run pytest tests/integration/test_simulation_ws.py -v`
Expected: PASS, 7 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/schemas.py apps/api/src/ecg_api/routers/sessions.py apps/api/src/ecg_api/main.py apps/api/src/ecg_api/routers/simulation_ws.py apps/api/tests/integration/test_sessions_router.py
git commit -m "Añadir el historial de sesiones por REST"
```

---

### Task 15: Test de integración de extremo a extremo

El que pide la sección 11 de la spec por su nombre: conectar, `start`, validar la cabecera de los frames y la monotonía de `sequence_number`, `update` con cambio observable en la señal, `stop`, y verificar la sesión persistida. Las tareas anteriores ya cubren cada pieza por separado; esta las encadena en un único flujo, como lo vería un cliente real.

**Files:**
- Test: `apps/api/tests/integration/test_end_to_end.py`

**Interfaces:**
- Consumes: todo lo anterior. No produce interfaces nuevas — es el test que ata el sistema completo.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/integration/test_end_to_end.py`:

```python
"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar.

Flujo de extremo a extremo, tal como lo vería un cliente real: conectar,
arrancar, comprobar los frames, cambiar la frecuencia en caliente, parar, y
confirmar que la sesión quedó escrita en la base de datos con lo que
realmente ocurrió.
"""

from fastapi.testclient import TestClient
from sqlalchemy import select

from ecg_api.db.models import SessionRow
from ecg_api.frames import decode_frame
from ecg_api.main import app


def test_full_simulation_lifecycle_end_to_end(migrated_database):
    # `migrated_database` no se usa directamente: es session-scoped y
    # garantiza que el esquema existe antes de que `TestClient(app)`
    # dispare el `lifespan` y siembre el catálogo. Sin esta dependencia
    # explícita, pytest recoge los ficheros por orden alfabético y este
    # test —el único de la carpeta que no pide la fixture— se ejecutaría
    # antes que `test_migration.py`, fallando con "relation rhythms does
    # not exist" en vez de ejercitar el flujo que pretende probar.
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            # 1. Conectar y arrancar.
            ws.send_json(
                {
                    "type": "start",
                    "rhythm_id": "sinus_normal",
                    "seed": 20260725,
                    "params": {"heart_rate_hz": 60 / 60},
                }
            )
            started = ws.receive_json()
            assert started["type"] == "started"
            session_id = started["session_id"]

            # 2. La cabecera de los frames es correcta y la secuencia
            #    monótona, sin huecos, en las primeras diez muestras.
            decoded_frames = [decode_frame(ws.receive_bytes()) for _ in range(10)]
            for frame in decoded_frames:
                assert frame.sample_rate_hz == 500
                assert frame.n_channels == 12
                assert frame.n_samples_per_channel == 50
                assert str(frame.session_id) == session_id
            sequence_numbers = [f.sequence_number for f in decoded_frames]
            assert sequence_numbers == list(range(10))

            # 3. `update` cambia la frecuencia, y el cambio es observable:
            #    el RR medio de los latidos que siguen se acorta. Se usa
            #    100 lpm, el extremo superior de editable_parameters para
            #    sinus_normal (60-100 lpm): 150 lpm queda fuera de rango
            #    clínico para este ritmo y el motor lo recortaría en
            #    silencio a 100, haciendo que esta aserción fallase contra
            #    un valor que el propio catálogo nunca deja aplicar.
            ws.send_json(
                {"type": "update", "params": {"heart_rate_hz": 100 / 60}}
            )
            updated = ws.receive_json()
            assert updated["type"] == "updated"
            assert updated["params"]["heart_rate_hz"] == 100 / 60

            # El renderer cachea eventos con `RENDER_MARGIN_S` (0,6 s) de
            # antelación sobre la ventana que pide cada trozo, así que los
            # primeros ~10 trozos tras `update` aún contienen algún latido
            # ya cacheado a la frecuencia vieja (comprobado con un script
            # de sonda: sin descartar, el periodo dominante medido es 0,958
            # en vez de 0,6; descartando 10 trozos cae limpio a 0,618).
            # Eso no es un defecto — el margen es necesario para que la T de
            # un latido anterior siga sumando en la ventana actual — así que
            # el test deja asentar la transición antes de medir.
            warmup_frames = [decode_frame(ws.receive_bytes()) for _ in range(10)]
            assert len(warmup_frames) == 10  # descartados a propósito

            more_frames = [decode_frame(ws.receive_bytes()) for _ in range(20)]
            fast_signal = _concat_channel_ii(more_frames)
            assert _dominant_beat_period_s(fast_signal) < 60 / 100 * 1.5

            # 4. `stop` cierra la sesión con una duración positiva.
            ws.send_json({"type": "stop"})
            stopped = None
            while stopped is None:
                event = ws.receive()
                # `WebSocketTestSession.receive()` devuelve el envoltorio
                # ASGI tal como lo emite el servidor: type="websocket.send"
                # (la acción que hizo el servidor), no "websocket.receive"
                # como cabria pensar desde el lado del cliente que lee.
                if event.get("type") == "websocket.send" and "text" in event:
                    import json

                    payload = json.loads(event["text"])
                    if payload.get("type") == "stopped":
                        stopped = payload
            assert stopped["duration_s"] > 0.0

        # 5. La sesión quedó persistida con lo que realmente ocurrió: el
        #    ritmo, la semilla, y la duración total (no la frecuencia
        #    inicial, sino la vigente en el momento del `stop`).
        session_factory = app.state.session_factory

        async def _fetch() -> SessionRow:
            async with session_factory() as db:
                return await db.get(SessionRow, __import__("uuid").UUID(session_id))

        import asyncio

        row = asyncio.run(_fetch())
        assert row is not None
        assert row.rhythm_id == "sinus_normal"
        assert row.seed == 20260725
        assert row.params["heart_rate_hz"] == 100 / 60
        assert float(row.duration_s) > 0.0


def _concat_channel_ii(frames) -> "list[float]":
    from ecg_engine.types import LEAD_ORDER

    lead_ii = LEAD_ORDER.index("II")
    signal: list[float] = []
    for frame in frames:
        signal.extend(frame.channels_v[lead_ii].tolist())
    return signal


def _dominant_beat_period_s(signal_v: "list[float]", sample_rate_hz: int = 500) -> float:
    """Periodo dominante por autocorrelación simple. No hace falta más
    precisión que la de distinguir 70 lpm (RR≈0,86 s) de 150 lpm (RR≈0,4 s)."""
    import numpy as np

    signal = np.asarray(signal_v) - np.mean(signal_v)
    autocorr = np.correlate(signal, signal, mode="full")[len(signal) - 1 :]
    min_lag = int(0.25 * sample_rate_hz)  # ritmos > 240 lpm quedan fuera de rango
    peak_lag = min_lag + int(np.argmax(autocorr[min_lag:]))
    return peak_lag / sample_rate_hz
```

- [ ] **Step 2: Run test to verify it fails**

Con `docker compose up -d db` en marcha:

Run: `cd apps/api && uv run pytest tests/integration/test_end_to_end.py -v`
Expected: FAIL si algo de las tareas 1-14 está incompleto. Si todas están hechas, este test debería pasar directamente — es el único de este plan que no introduce código de producción nuevo, solo lo verifica todo junto.

- [ ] **Step 3: Write minimal implementation**

No hay implementación nueva que escribir: si el test falla, el fallo señala qué pieza de una tarea anterior no se comporta como su propio test decía. Vuelve a esa tarea, no añadas código aquí.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/integration/test_end_to_end.py -v`
Expected: PASS, 1 passed

Y la suite completa, para cerrar el plan:

Run: `cd apps/api && uv run pytest -v`
Expected: PASS, toda la suite en verde (unitarios + integración)

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/integration/test_end_to_end.py
git commit -m "Añadir el test de integracion de extremo a extremo"
```

---

## Cierre del plan

Al terminar la tarea 15, `apps/api` cumple la parte de los criterios de aceptación de la fase 1 que le corresponde:

| Criterio | Cubierto por |
|---|---|
| 3. Frecuencia cardíaca y ruido modificables en caliente | Tareas 9, 13 |
| 4. Sesión persistida, reproducible desde `seed` + `params` + `engine_semver` + `engine_commit` | Tareas 3, 12, 14 |
| Contrato del frame binario, cabecera de 40 bytes, `session_id` sin reordenar | Tarea 6, verificado en 13 y 15 |
| Manejo de errores: `NOT_FOUND`, `INVALID_PARAMS`, `ENGINE_FAILURE` con cierre 1011 | Tareas 8, 13 |
| Buffer de envío saturado → descarta lo más antiguo | Tarea 10 |
| Integración WS de extremo a extremo (spec §11) | Tarea 15 |

Quedan fuera de este plan, por ser del plan C (frontend) o de fases posteriores:

- **Criterio 1** (los doce ritmos correctos): ya cubierto por el plan A: el motor no cambia aquí.
- **Criterio 2** (60 fps, diez minutos sin fugas): es del cliente. Este plan solo garantiza que el servidor sostiene el streaming sin degradarse (heredado del motor, tarea 17 del plan A); el trazado en pantalla es plan C.
- **Criterio 7** (revisión clínica): sigue pendiente de los doce trazados, no de la API.
- **Un solo worker de uvicorn**: restricción de despliegue documentada en las Global Constraints; no hay nada que testear en código, solo que el despliegue real no lance más de uno.

**Siguiente paso tras ejecutar este plan:** escribir el plan C (frontend), con el contrato del frame binario y el protocolo del WebSocket ya verificados en código en vez de sobre el papel.
