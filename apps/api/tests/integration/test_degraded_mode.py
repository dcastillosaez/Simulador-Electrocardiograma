"""Sin base de datos, el simulador sigue simulando.

Es el criterio de aceptación de la fase G3. La base de datos guarda historial y
nada más: el catálogo de ritmos sale del motor, así que simular, medir y
administrar fármacos no la tocan. Antes, un fallo al sembrar el catálogo
tumbaba el arranque entero — y en el escritorio de alguien que va a dar clase,
«no se guardará el historial» y «no arranca» no son el mismo problema.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ecg_api.config import get_settings
from ecg_api.main import app

from .conftest import receive_frame_bytes, receive_json_of_type

# Un puerto donde no hay nada escuchando. No vale con una base inexistente en
# un Postgres que sí responde: eso falla al autenticar, más tarde y por otro
# camino. Aquí se simula el caso real —el motor de base de datos no está— que
# es lo que le pasará al usuario cuyo fichero se corrompió o cuyo disco está
# lleno.
SIN_BASE = "postgresql+asyncpg://ecg:ecg@127.0.0.1:59999/no_existe"


@pytest.fixture
def app_sin_base(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", SIN_BASE)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_la_aplicacion_arranca_sin_base_de_datos(app_sin_base):
    with TestClient(app) as client:
        respuesta = client.get("/api/health")
        assert respuesta.status_code == 200
        assert respuesta.json()["status"] == "ok"
        # Y lo dice, que es la otra mitad del criterio: degradarse en silencio
        # sería peor que fallar.
        assert respuesta.json()["persistence"] == "unavailable"


def test_el_catalogo_sigue_disponible(app_sin_base):
    # Sale del motor, no de la tabla `rhythms`.
    with TestClient(app) as client:
        respuesta = client.get("/api/rhythms")
        assert respuesta.status_code == 200
        # Los doce ritmos y el paciente personalizado: el catálogo entero sale
        # del motor, así que sin base de datos no falta ninguno.
        assert len(respuesta.json()) == 13


def test_se_puede_simular_sin_base_de_datos(app_sin_base):
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = receive_json_of_type(ws, "started")
            assert started["sample_rate_hz"] == 500
            # Y llega señal de verdad, no solo el acuse de recibo.
            assert len(receive_frame_bytes(ws)) > 0


def test_parar_una_sesion_no_revienta_sin_base_de_datos(app_sin_base):
    # `_maybe_persist` corre igualmente al cerrar: tiene que darse por
    # enterado y callarse, no intentar escribir en una base que no existe.
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            receive_json_of_type(ws, "started")
            ws.send_json({"type": "stop"})
            assert receive_json_of_type(ws, "stopped")["type"] == "stopped"


def test_el_historial_responde_que_no_esta_disponible(app_sin_base):
    # 503 con motivo, no 500 con traza: la interfaz tiene que poder decir «no
    # disponible» en vez de «error».
    with TestClient(app) as client:
        respuesta = client.get("/api/sessions")
        assert respuesta.status_code == 503
        assert "historial" in respuesta.json()["detail"].lower()
