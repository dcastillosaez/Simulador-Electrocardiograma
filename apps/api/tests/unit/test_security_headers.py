from fastapi.testclient import TestClient

from ecg_api.main import app

# Sin `with`: no dispara el `lifespan` (que sembraria el catalogo contra
# Postgres), igual que test_cors.py. Los middlewares se montan al construir la
# app, no en el lifespan.
client = TestClient(app)


def test_a_json_response_cannot_be_sniffed_as_html():
    # Sin `nosniff`, el navegador puede decidir por su cuenta que un JSON es
    # HTML y ejecutarlo: es la base de los XSS por confusion de tipo.
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"


def test_the_api_cannot_be_framed():
    response = client.get("/api/health")
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_the_api_url_does_not_travel_as_a_referrer():
    response = client.get("/api/health")
    assert response.headers["referrer-policy"] == "no-referrer"


def test_hsts_is_not_emitted_by_the_application():
    # Solo tiene sentido detras de TLS, y en desarrollo esto corre en claro.
    # Una cabecera que ordena al navegador no volver a hablar en claro con
    # este host es dificil de retirar una vez emitida: la pone el proxy, que
    # es quien sabe si hay TLS.
    response = client.get("/api/health")
    assert "strict-transport-security" not in response.headers
