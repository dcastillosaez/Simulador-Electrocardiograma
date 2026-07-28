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
