"""El token del modo escritorio.

En escritorio el backend escucha en 127.0.0.1 y eso lo alcanza cualquier
proceso del equipo. El token distingue a la ventana del simulador de todo lo
demas. En servidor no existe y nada de esto se activa.
"""

import pytest
from fastapi.testclient import TestClient

from ecg_api.config import Settings, get_settings
from ecg_api.desktop_auth import token_matches
from ecg_api.main import app


@pytest.fixture
def modo_escritorio(monkeypatch):
    """Arranca la app con token, y deja el mundo como estaba.

    `app` es un objeto de módulo compartido por todos los tests, y entrar con
    `with TestClient(app)` ejecuta el lifespan, que escribe `app.state.settings`.
    Sin restaurarlo, los tests que crean su `TestClient` sin `with` —los de los
    routers— heredan un estado con token y empiezan a recibir 401 por algo que
    no tiene nada que ver con ellos.
    """
    previo = getattr(app.state, "settings", None)
    monkeypatch.setenv("DESKTOP_TOKEN", "secreto-de-arranque")
    get_settings.cache_clear()
    yield "secreto-de-arranque"
    get_settings.cache_clear()
    if previo is None:
        if hasattr(app.state, "settings"):
            del app.state.settings
    else:
        app.state.settings = previo


class TestTokenMatches:
    def test_sin_token_configurado_no_hay_puerta(self):
        # En servidor el token esta vacio: el middleware debe dejar pasar todo
        # en vez de bloquear la API entera.
        assert token_matches("", None) is True
        assert token_matches("", "loquesea") is True

    def test_el_token_correcto_pasa(self):
        assert token_matches("secreto", "secreto") is True

    def test_el_incorrecto_no(self):
        assert token_matches("secreto", "otro") is False

    def test_no_presentarlo_no(self):
        assert token_matches("secreto", None) is False
        assert token_matches("secreto", "") is False


class TestModoEscritorioEnSettings:
    def test_por_defecto_no_es_escritorio(self):
        assert Settings().is_desktop is False

    def test_con_token_es_escritorio(self):
        assert Settings(desktop_token="abc").is_desktop is True

    def test_el_origen_de_tauri_solo_se_admite_en_escritorio(self):
        # Aflojar la lista en servidor por comodidad del escritorio seria
        # abrir una puerta donde no hace falta.
        servidor = Settings()
        escritorio = Settings(desktop_token="abc")
        assert "http://tauri.localhost" not in servidor.allowed_origins
        assert "http://tauri.localhost" in escritorio.allowed_origins

    def test_los_origenes_de_siempre_siguen(self):
        escritorio = Settings(desktop_token="abc")
        assert "http://localhost:5600" in escritorio.allowed_origins


class TestMiddleware:
    def test_sin_token_configurado_la_api_responde_normal(self):
        client = TestClient(app)
        assert client.get("/api/rhythms").status_code == 200

    def test_con_token_una_peticion_sin_el_se_rechaza(self, modo_escritorio):
        with TestClient(app) as client:
            assert client.get("/api/rhythms").status_code == 401
            respuesta = client.get(
                "/api/rhythms", headers={"X-ECG-Token": modo_escritorio}
            )
            assert respuesta.status_code == 200

    def test_health_sigue_abierto(self, modo_escritorio):
        # Es lo que el propio shell consulta para saber si el backend responde,
        # y en ese momento todavia no le ha entregado el token a nadie.
        with TestClient(app) as client:
            assert client.get("/api/health").status_code == 200
