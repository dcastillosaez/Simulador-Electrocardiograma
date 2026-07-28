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
