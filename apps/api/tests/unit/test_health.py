from fastapi.testclient import TestClient

from ecg_api.main import app


def test_health_reports_ok_and_engine_version():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["engine_version"].count(".") == 2
