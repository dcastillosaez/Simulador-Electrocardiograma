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
