"""Migraciones, invocadas desde código y con rutas absolutas.

`alembic.ini` declara `script_location = migrations` y `prepend_sys_path = .`:
rutas relativas al **directorio de trabajo**. Desde la consola, en `apps/api`,
funciona. Dentro del ejecutable de escritorio el directorio de trabajo es donde
el usuario haya hecho doble clic —el escritorio, la carpeta de descargas, lo que
sea—, y Alembic no encontraría ni una revisión.

Aquí el `Config` se construye a mano, sin fichero, con la ruta de las
revisiones resuelta desde este módulo. Es lo que permite que el mismo código
migre en desarrollo, en los tests y dentro del `.exe`.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

logger = logging.getLogger("ecg_api.migrator")


def migrations_path() -> Path:
    """Dónde están las revisiones.

    Dos respuestas, porque son dos mundos distintos:

    - **En desarrollo**, `apps/api/migrations`, relativo a este fichero.
    - **Empaquetado**, dentro del bundle. PyInstaller extrae los datos a un
      directorio propio que anuncia en `sys._MEIPASS`, y ahí `__file__` apunta
      a una ruta del archivo comprimido que no existe en disco: resolver por
      `parents[...]` daba una carpeta inexistente y Alembic abortaba el
      arranque con «Path doesn't exist».
    """
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "migrations"
    return Path(__file__).resolve().parents[3] / "migrations"


def alembic_config(database_url_sync: str) -> Config:
    """Un `Config` sin `alembic.ini`, con todo resuelto en absoluto."""
    cfg = Config()
    cfg.set_main_option("script_location", str(migrations_path()))
    cfg.set_main_option("sqlalchemy.url", database_url_sync)
    return cfg


def to_sync_url(database_url: str) -> str:
    """La URL equivalente con driver síncrono.

    Alembic migra en síncrono; la aplicación habla en asíncrono. Se traduce en
    un sitio para que no haya dos verdades sobre dónde está la base.
    """
    return (
        database_url
        .replace("+asyncpg", "+psycopg2")
        .replace("+aiosqlite", "")
    )


def current_revision(database_url_sync: str) -> str | None:
    engine = create_engine(database_url_sync)
    try:
        with engine.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()


def head_revision(database_url_sync: str) -> str | None:
    return ScriptDirectory.from_config(
        alembic_config(database_url_sync)
    ).get_current_head()


def upgrade_to_head(database_url: str) -> None:
    """Deja la base en la última revisión.

    Registra de dónde a dónde va. Cuando alguien reporte «se me ha perdido el
    historial», esa línea del log es lo primero que hay que mirar.
    """
    sync_url = to_sync_url(database_url)
    desde = current_revision(sync_url)
    hasta = head_revision(sync_url)
    if desde == hasta:
        logger.info("base de datos ya en la revisión %s", hasta)
        return
    logger.info("migrando la base de datos de %s a %s", desde or "vacía", hasta)
    command.upgrade(alembic_config(sync_url), "head")
