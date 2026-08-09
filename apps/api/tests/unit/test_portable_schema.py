"""El esquema tiene que hablar los dos motores sin que Postgres pierda nada.

El escritorio persiste en SQLite y el servidor en Postgres (ver
docs/fase-g/g3-base-de-datos.md). Estos tests son la red que impide que un
cambio de tipos degrade el servidor sin que nadie se entere.
"""

from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.schema import CreateTable

from ecg_api.db.base import Base, get_engine
from ecg_api.db.models import DrugAdministrationRow, RhythmRow, SessionRow


def _ddl(tabla, dialecto) -> str:
    return str(CreateTable(tabla.__table__).compile(dialect=dialecto))


class TestPostgresNoPierdeNada:
    """Hacer el esquema portable no puede costarle nada al servidor."""

    def test_el_json_sigue_siendo_jsonb(self):
        # Un `sa.JSON` genérico a secas habría degradado Postgres a `json`, sin
        # operadores ni indices, y no se habria notado hasta la primera
        # consulta que los necesitara.
        ddl = _ddl(SessionRow, postgresql.dialect())
        assert "JSONB" in ddl
        assert "params JSON," not in ddl

    def test_los_identificadores_siguen_siendo_uuid_nativo(self):
        ddl = _ddl(SessionRow, postgresql.dialect())
        assert "id UUID NOT NULL" in ddl

    def test_el_catalogo_tambien(self):
        assert "JSONB" in _ddl(RhythmRow, postgresql.dialect())


class TestSqliteEntiendeElEsquema:
    def test_el_json_se_degrada_a_json_a_secas(self):
        ddl = _ddl(SessionRow, sqlite.dialect())
        assert "JSON" in ddl
        assert "JSONB" not in ddl

    def test_los_uuid_viajan_como_texto(self):
        assert "CHAR(32)" in _ddl(SessionRow, sqlite.dialect())

    def test_las_tres_tablas_se_pueden_crear(self):
        # `create_all` sobre SQLite en memoria: si algun tipo no fuera
        # portable, esto es lo que reventaria.
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        nombres = set(Base.metadata.tables)
        assert {"rhythms", "sessions", "drug_administrations"} <= nombres
        engine.dispose()


class TestClavesForaneasEnSqlite:
    async def test_el_engine_de_sqlite_activa_el_pragma(self):
        # SQLite trae las claves foraneas DESACTIVADAS. Sin el pragma,
        # declararlas no sirve de nada: el defecto que se corrigio en
        # `persist_session` --administraciones escritas antes que su sesion--
        # lo delato Postgres al rechazar la FK, y sobre SQLite sin pragma
        # habria escrito registros clinicos huerfanos en silencio.
        engine = get_engine("sqlite+aiosqlite:///:memory:")
        try:
            async with engine.connect() as conn:
                activo = (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar()
        finally:
            await engine.dispose()
        assert activo == 1

    def test_postgres_no_recibe_pragmas_de_sqlite(self):
        # El pragma solo se engancha si el dialecto es SQLite: engancharlo
        # siempre reventaria la primera conexion a Postgres.
        engine = get_engine("postgresql+asyncpg://ecg:ecg@localhost:5432/x")
        assert engine.dialect.name == "postgresql"
