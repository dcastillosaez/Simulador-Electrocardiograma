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
- Produces: `Settings` (pydantic-settings) en `ecg_api.config`, con `database_url: str`, `engine_commit: str`, `sample_rate_hz: int`. `get_settings() -> Settings`.

- [ ] **Step 1: Write the failing test**

Crear `apps/api/tests/unit/test_config.py`:

```python
import os

from ecg_api.config import Settings


def test_settings_have_sane_defaults():
    settings = Settings(_env_file=None)
    assert settings.sample_rate_hz == 500
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
    sample_rate_hz: int = 500


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

from sqlalchemy import BigInteger, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RhythmRow(Base):
    __tablename__ = "rhythms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        nullable=False, server_default=func.now()
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
    started_at: Mapped[dt.datetime] = mapped_column(nullable=False)
    ended_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
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
Expected: PASS, 1 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "Añadir modelos de base de datos y migración inicial de Alembic"
```

---
