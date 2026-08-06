"""Farmacología de extremo a extremo por WebSocket.

Requiere Postgres real: `docker compose up -d db` antes de ejecutar.
"""

import json

from fastapi.testclient import TestClient

from ecg_api.main import app


def _next_json_of_type(ws, expected: str, *, limit: int = 400) -> dict:
    """Devuelve el primer mensaje de texto del tipo pedido.

    Con cuatro bucles de fondo escribiendo en el mismo socket —chunks,
    medidas y farmacología— filtrar por tipo es la única forma estable de
    afirmar algo sobre un canal concreto.
    """
    for _ in range(limit):
        event = ws.receive()
        if event.get("type") != "websocket.send" or "text" not in event:
            continue
        message = json.loads(event["text"])
        if message.get("type") == expected:
            return message
    raise AssertionError(f"no llegó ningún mensaje de tipo {expected!r}")


def _start(ws) -> dict:
    ws.send_json({"type": "start", "rhythm_id": "sinus_normal", "seed": 20260806})
    return ws.receive_json()


def test_administer_returns_the_administration_record():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            ws.send_json({"type": "administer", "drug_id": "atropine", "dose": 1.0})
            message = _next_json_of_type(ws, "administered")
            administration = message["administration"]
            assert administration["drug_id"] == "atropine"
            assert administration["dose"] == 1.0
            assert administration["dose_unit"] == "mg"
            assert administration["route"] == "IV"
            ws.send_json({"type": "stop"})


def test_administer_pushes_pharmacology_immediately():
    """Sin esperar al tic de 1 Hz: el usuario acaba de pulsar el botón."""
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            ws.send_json({"type": "administer", "drug_id": "atropine", "dose": 1.0})
            _next_json_of_type(ws, "administered")
            payload = _next_json_of_type(ws, "pharmacology")
            assert [d["drug_id"] for d in payload["active"]] == ["atropine"]
            assert "heart_rate_bpm" in payload["physiology"]
            ws.send_json({"type": "stop"})


def test_pharmacology_channel_streams_without_drugs():
    """El canal existe desde el principio: la interfaz necesita el estado
    fisiológico basal aunque no se haya administrado nada."""
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            payload = _next_json_of_type(ws, "pharmacology")
            assert payload["active"] == []
            assert payload["physiology"]["heart_rate_bpm"] > 0
            ws.send_json({"type": "stop"})


def test_administer_before_start_is_rejected():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "administer", "drug_id": "atropine", "dose": 1.0})
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "INVALID_PARAMS"


def test_unknown_drug_is_rejected_without_closing_the_socket():
    """Un error de catálogo deja la conexión viva: el operador corrige y
    reintenta sin reconectar."""
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            ws.send_json(
                {"type": "administer", "drug_id": "agua_bendita", "dose": 1.0}
            )
            error = _next_json_of_type(ws, "error")
            assert error["code"] == "INVALID_PARAMS"
            ws.send_json({"type": "administer", "drug_id": "atropine", "dose": 1.0})
            assert _next_json_of_type(ws, "administered")
            ws.send_json({"type": "stop"})


def test_route_not_allowed_is_rejected():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            ws.send_json(
                {
                    "type": "administer",
                    "drug_id": "adenosine",
                    "dose": 6.0,
                    "route": "PO",
                }
            )
            error = _next_json_of_type(ws, "error")
            assert error["code"] == "INVALID_PARAMS"
            assert "PO" in error["detail"]
            ws.send_json({"type": "stop"})


def test_malformed_administer_is_rejected():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            ws.send_json({"type": "administer", "drug_id": "atropine"})
            error = _next_json_of_type(ws, "error")
            assert error["code"] == "INVALID_PARAMS"
            ws.send_json({"type": "stop"})


def test_update_does_not_echo_the_drugged_rate():
    """El `updated` devuelve el mando, no lo que la adrenalina puso: si no,
    el deslizador de la interfaz se movería solo."""
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            _start(ws)
            ws.send_json({"type": "administer", "drug_id": "epinephrine", "dose": 1.0})
            _next_json_of_type(ws, "administered")
            ws.send_json({"type": "update", "params": {"heart_rate_hz": 1.5}})
            updated = _next_json_of_type(ws, "updated")
            assert updated["params"]["heart_rate_hz"] == 1.5
            ws.send_json({"type": "stop"})
