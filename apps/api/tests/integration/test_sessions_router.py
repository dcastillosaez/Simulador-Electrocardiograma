"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

from fastapi.testclient import TestClient

from ecg_api.main import app


def _start_and_stop_a_session(client, rhythm_id="sinus_normal", seed=1):
    with client.websocket_connect("/ws/simulation") as ws:
        ws.send_json({"type": "start", "rhythm_id": rhythm_id, "seed": seed})
        started = ws.receive_json()
        for _ in range(60):  # 60 * 100 ms = 6 s simulados, por encima del umbral de 5
            ws.receive_bytes()
        ws.send_json({"type": "stop"})
    return started["session_id"]


def test_list_sessions_includes_a_persisted_session():
    with TestClient(app) as client:
        session_id = _start_and_stop_a_session(client)
        response = client.get("/api/sessions")
        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert session_id in ids


def test_get_session_detail_has_the_documented_fields():
    with TestClient(app) as client:
        session_id = _start_and_stop_a_session(
            client, rhythm_id="sinus_bradycardia", seed=7
        )
        response = client.get(f"/api/sessions/{session_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["rhythm_id"] == "sinus_bradycardia"
        assert body["seed"] == 7
        assert body["engine_semver"].count(".") == 2
        assert body["duration_s"] >= 5.0
        assert "params" in body


def test_get_session_404_for_unknown_id():
    with TestClient(app) as client:
        response = client.get(
            "/api/sessions/00000000-0000-0000-0000-000000000000"
        )
        assert response.status_code == 404


def test_get_session_404_for_malformed_id():
    with TestClient(app) as client:
        response = client.get("/api/sessions/not-a-uuid")
        assert response.status_code == 404
