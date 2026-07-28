from fastapi.testclient import TestClient

from ecg_api.main import app


def test_cors_allows_the_configured_origin():
    # Sin `with`: no dispara el `lifespan` (que sembraría el catálogo contra
    # Postgres), igual que test_health.py. CORSMiddleware ya está montado
    # en el momento en que se construye `app`, no en el lifespan.
    client = TestClient(app)
    response = client.get(
        "/api/health", headers={"Origin": "http://localhost:5173"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_an_unlisted_origin():
    client = TestClient(app)
    response = client.get(
        "/api/health", headers={"Origin": "https://otro-origen.example"}
    )
    assert "access-control-allow-origin" not in response.headers
