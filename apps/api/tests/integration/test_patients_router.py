"""La biblioteca de pacientes inventados, contra la base de datos real.

Requiere Postgres (`docker compose up -d db`) o `ECG_TEST_DB=sqlite`.
"""

from fastapi.testclient import TestClient

from ecg_api.main import app

from .conftest import receive_frame_bytes, receive_json_of_type

BLOQUEO = {
    "atrial_rate_bpm": 78.0,
    "av_conduction": "complete_block",
    "escape_rate_bpm": 38.0,
    "qrs_ms": 140.0,
    "qt_ms": 480.0,
    "systolic_bp_mmhg": 95.0,
    "diastolic_bp_mmhg": 60.0,
}


def _create(client, name: str, patient: dict | None = None):
    return client.post(
        "/api/patients", json={"name": name, "patient": patient or BLOQUEO}
    )


def test_a_saved_patient_comes_back_with_what_was_saved():
    with TestClient(app) as client:
        created = _create(client, "Bloqueo para la clase del martes")
        assert created.status_code == 201
        body = created.json()
        assert body["name"] == "Bloqueo para la clase del martes"
        assert body["patient"]["escape_rate_bpm"] == 38.0
        assert body["patient"]["qrs_ms"] == 140.0
        assert body["engine_semver"].count(".") == 2

        fetched = client.get(f"/api/patients/{body['id']}")
        assert fetched.status_code == 200
        assert fetched.json()["patient"] == body["patient"]

        client.delete(f"/api/patients/{body['id']}")


def test_the_defaults_fill_in_what_the_editor_did_not_send():
    """Un paciente guardado por una versión anterior del editor tiene que
    seguir cargando: los campos que falten toman su valor por defecto."""
    with TestClient(app) as client:
        created = _create(client, "Mínimo", patient={"atrial_rate_bpm": 90.0})
        assert created.status_code == 201
        patient = created.json()["patient"]
        assert patient["pr_ms"] == 160.0
        assert patient["systolic_bp_mmhg"] == 120.0
        client.delete(f"/api/patients/{created.json()['id']}")


def test_two_patients_cannot_share_a_name():
    with TestClient(app) as client:
        first = _create(client, "Repetido")
        assert first.status_code == 201
        second = _create(client, "Repetido")
        assert second.status_code == 409
        assert "Repetido" in second.json()["detail"]
        client.delete(f"/api/patients/{first.json()['id']}")


def test_a_blank_name_is_refused():
    """Un paciente llamado «   » existe en la tabla y no existe en la
    pantalla."""
    with TestClient(app) as client:
        assert _create(client, "   ").status_code == 422


def test_a_patient_can_be_edited_and_the_list_shows_it_first():
    with TestClient(app) as client:
        created = _create(client, "Antes").json()
        updated = client.put(
            f"/api/patients/{created['id']}",
            json={
                "name": "Después",
                "patient": {**BLOQUEO, "escape_rate_bpm": 30.0},
            },
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Después"
        assert updated.json()["patient"]["escape_rate_bpm"] == 30.0

        listed = client.get("/api/patients").json()
        assert listed[0]["name"] == "Después"  # ordenados por última edición

        client.delete(f"/api/patients/{created['id']}")


def test_a_deleted_patient_is_gone():
    with TestClient(app) as client:
        created = _create(client, "Para borrar").json()
        assert client.delete(f"/api/patients/{created['id']}").status_code == 204
        assert client.get(f"/api/patients/{created['id']}").status_code == 404


def test_an_invalid_patient_is_refused_before_it_reaches_the_database():
    with TestClient(app) as client:
        response = _create(
            client, "Imposible", patient={"qrs_ms": 200.0, "qt_ms": 180.0}
        )
        assert response.status_code == 422


def test_an_unknown_id_is_a_404_and_not_a_crash():
    with TestClient(app) as client:
        assert client.get("/api/patients/no-es-un-uuid").status_code == 404


def test_a_session_run_with_a_saved_patient_persists_its_full_description():
    """La prueba de que un paciente guardado sirve para reproducir una sesión.

    La fila de `sessions` guarda el paciente entero dentro de `params`, no un
    puntero a la biblioteca: por eso el caso se puede borrar después sin que
    la sesión deje de ser reproducible.
    """
    with TestClient(app) as client:
        saved = _create(client, "Caso de examen").json()
        patient = saved["patient"]

        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {
                    "type": "start",
                    "rhythm_id": "custom_patient",
                    "seed": 3,
                    "params": {"heart_rate_hz": 70 / 60, "patient": patient},
                }
            )
            started = receive_json_of_type(ws, "started")
            for _ in range(60):
                receive_frame_bytes(ws)
            ws.send_json({"type": "stop"})

        client.delete(f"/api/patients/{saved['id']}")

        detail = client.get(f"/api/sessions/{started['session_id']}").json()
        assert detail["rhythm_id"] == "custom_patient"
        assert detail["params"]["patient"]["escape_rate_bpm"] == 38.0
        assert detail["params"]["patient"]["av_conduction"] == "complete_block"
