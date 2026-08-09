"""Motor y fábrica de sesiones de SQLAlchemy, async.

Dos motores soportados y una diferencia que importa entre ellos: SQLite —el de
la aplicación de escritorio— no aplica las claves foráneas salvo que se le pida
en cada conexión. Ver `_enable_sqlite_foreign_keys`.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _enable_sqlite_foreign_keys(engine: AsyncEngine) -> None:
    """`PRAGMA foreign_keys=ON` en cada conexión nueva.

    SQLite trae las claves foráneas DESACTIVADAS por compatibilidad histórica:
    sin esto, declararlas en el esquema no sirve de nada y las inserciones
    huérfanas entran sin protestar.

    No es hipotético. El defecto que se corrigió en `persist_session` —las
    administraciones escribiéndose antes que su sesión— lo delató Postgres
    rechazando la clave foránea. Sobre SQLite sin este pragma, aquel mismo
    defecto habría escrito registros clínicos sin sesión durante meses, en
    silencio, y el replay habría empezado a fallar mucho después y por causas
    que no habrían apuntado aquí.
    """

    @event.listens_for(engine.sync_engine, "connect")
    def _set_pragma(dbapi_connection, _connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


def get_engine(database_url: str) -> AsyncEngine:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    if engine.dialect.name == "sqlite":
        _enable_sqlite_foreign_keys(engine)
    return engine


def get_session_factory(
    database_url: str,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(database_url), expire_on_commit=False)
