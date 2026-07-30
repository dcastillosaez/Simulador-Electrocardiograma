"""Configuración de la aplicación, vía variables de entorno."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator"
    engine_commit: str = "dev"
    # El dev server escucha en 5600 y no en el 5173 por defecto de Vite: ese
    # puerto cae dentro de un rango que Windows reserva para si (ver
    # apps/web/vite.config.ts). Se mantienen los dos para no romper a quien
    # arranque el frontend en una maquina donde el 5173 si esta libre.
    cors_origins: str = "http://localhost:5600,http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
