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

    # --- Aforo del WebSocket -------------------------------------------
    # Un solo worker sostiene todas las simulaciones (ver main.py), asi que
    # estos numeros son los que separan "el aula va lenta" de "el aula se
    # queda sin servicio". Los valores por defecto van holgados para un aula
    # y apretados para un script: cincuenta puestos, cinco por maquina.
    max_ws_connections: int = 50
    max_ws_connections_per_client: int = 5
    # Un mensaje de control legitimo son unos cientos de bytes. 64 KiB deja
    # sitio de sobra para cualquier ampliacion del contrato y corta de raiz el
    # JSON de megabytes que solo sirve para hacer trabajar al parser.
    max_ws_message_bytes: int = 64 * 1024
    # Cuanto se espera a que una conexion recien abierta pida su primera
    # simulacion. Es para que una pestana olvidada suelte su plaza, no para
    # frenar a nadie: el frontend abre el socket al cargar y no manda `start`
    # hasta que el usuario elige un ritmo, asi que el plazo va holgado.
    idle_start_timeout_s: float = 300.0
    # Solo `true` si hay un proxy propio delante. Ver `client_key` en
    # limits.py: creerse la cabecera sin proxy regala plazas infinitas.
    trust_proxy: bool = False

    # --- Modo escritorio (fase G) ---------------------------------------
    # Secreto que el shell de escritorio genera en cada arranque y comparte
    # con la interfaz. Cuando esta puesto, la API exige presentarlo.
    #
    # No es autenticacion de usuario: es lo que impide que CUALQUIER proceso
    # del mismo equipo hable con el simulador. En un escritorio el backend
    # escucha en 127.0.0.1, y eso lo alcanza cualquier programa del usuario.
    # Vacio en servidor, donde la puerta la pone otra cosa.
    desktop_token: str = ""
    # El origen desde el que Tauri sirve la interfaz. Se anade a la lista de
    # origenes permitidos solo cuando hay token, es decir, solo en escritorio.
    desktop_origin: str = "http://tauri.localhost"

    @property
    def is_desktop(self) -> bool:
        return bool(self.desktop_token)

    @property
    def allowed_origins(self) -> list[str]:
        """Los origenes que valen para CORS y para el handshake del WebSocket.

        En escritorio hay que anadir el de Tauri --que no es `localhost` sino
        un esquema propio-- pero solo ahi: aflojar la lista en servidor por
        comodidad del escritorio seria abrir una puerta donde no hace falta.
        """
        origins = self.cors_origins_list
        if self.is_desktop and self.desktop_origin not in origins:
            return [*origins, self.desktop_origin]
        return origins

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
