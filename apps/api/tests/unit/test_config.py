from ecg_api.config import Settings


def test_settings_have_sane_defaults(monkeypatch):
    # `tests/integration/conftest.py` fija `DATABASE_URL`/`ENGINE_COMMIT` en
    # el entorno del proceso de pytest para que `lifespan` apunte siempre a
    # la base de test (ver su comentario). `_env_file=None` solo desactiva
    # la lectura de `.env`, no la del entorno, así que hace falta limpiarlas
    # aquí explícitamente para probar los valores por defecto reales cuando
    # los tests de esta tarea y los de integración corren en la misma sesión.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ENGINE_COMMIT", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    settings = Settings(_env_file=None)
    assert settings.engine_commit == "dev"
    assert "postgresql+asyncpg://" in settings.database_url
    assert settings.cors_origins_list == ["http://localhost:5173"]


def test_settings_read_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:x@host/db")
    monkeypatch.setenv("ENGINE_COMMIT", "8c4b92f")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173,https://ecg.example.org")
    settings = Settings(_env_file=None)
    assert settings.database_url == "postgresql+asyncpg://x:x@host/db"
    assert settings.engine_commit == "8c4b92f"
    assert settings.cors_origins_list == [
        "http://localhost:5173",
        "https://ecg.example.org",
    ]


def test_cors_origins_list_ignores_blank_entries(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, ,https://ecg.example.org,")
    settings = Settings(_env_file=None)
    assert settings.cors_origins_list == [
        "http://localhost:5173",
        "https://ecg.example.org",
    ]
