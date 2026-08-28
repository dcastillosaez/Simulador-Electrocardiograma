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


def test_cors_allows_the_methods_the_patient_library_needs():
    """Guardar un caso es un POST con `Content-Type: application/json`, y eso
    dispara un preflight. Con la lista de métodos en solo `GET`, el navegador
    lo rechazaba antes de que la petición llegara a salir: el botón de
    guardar no hacía nada y la consola hablaba de CORS, no de pacientes."""
    client = TestClient(app)
    response = client.options(
        "/api/patients",
        headers={
            "Origin": "http://localhost:5600",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-methods"]
    assert {"POST", "PUT", "DELETE"} <= {m.strip() for m in allowed.split(",")}


# --- El WebSocket comprueba el origen por su cuenta -------------------------

from ecg_api.routers.simulation_ws import _origin_is_allowed

ALLOWED = ["http://localhost:5600", "http://localhost:5173"]


def test_ws_accepts_a_listed_origin():
    assert _origin_is_allowed("http://localhost:5600", ALLOWED) is True


def test_ws_rejects_an_unlisted_origin():
    # CORS no cubre el WebSocket --Starlette solo lo aplica a HTTP normal-- y
    # el navegador tampoco bloquea un WS entre origenes distintos. Sin esta
    # comprobacion, cualquier web abierta en otra pestana se conecta al
    # servidor del aula.
    assert _origin_is_allowed("https://sitio-ajeno.example", ALLOWED) is False


def test_ws_accepts_a_client_that_is_not_a_browser():
    # Sin cabecera `Origin` no hay navegador, y el ataque que esto previene
    # solo existe dentro de uno. Cerrar aqui no anadiria seguridad y romperia
    # los tests, los scripts y cualquier cliente de laboratorio.
    assert _origin_is_allowed(None, ALLOWED) is True
