from fastapi.testclient import TestClient

from ecg_api.main import app
from ecg_engine import CUSTOM_PATIENT_ID

client = TestClient(app)


def test_list_rhythms_returns_the_twelve_mvp_rhythms_and_the_custom_patient():
    """Doce hallazgos clínicos y un hueco para inventar el decimotercero.

    El paciente personalizado se sirve por el mismo endpoint a propósito: para
    la interfaz es una opción más del selector, y hacerle un camino aparte
    habría duplicado el flujo entero de elegir un ritmo.
    """
    response = client.get("/api/rhythms")
    assert response.status_code == 200
    body = response.json()
    ids = {r["rhythm_id"] for r in body}
    assert CUSTOM_PATIENT_ID in ids
    assert len(ids - {CUSTOM_PATIENT_ID}) == 12
    assert {
        "rhythm_id", "display_name", "category",
        "ventricular_rate_hz", "pr_is_measurable",
    } <= body[0].keys()


def test_the_custom_patient_is_marked_as_its_own_category():
    """La interfaz tiene que poder separarlo de los ritmos auditados sin
    comparar identificadores a mano."""
    response = client.get(f"/api/rhythms/{CUSTOM_PATIENT_ID}")
    assert response.status_code == 200
    assert response.json()["category"] == "custom"


def test_get_rhythm_detail_includes_editable_parameters_and_references():
    response = client.get("/api/rhythms/sinus_normal")
    assert response.status_code == 200
    body = response.json()
    assert body["rhythm_id"] == "sinus_normal"
    rate_range = body["editable_parameters"]["heart_rate_hz"]
    assert rate_range["minimum"] < rate_range["maximum"]
    assert len(body["references"]) >= 1


def test_get_rhythm_detail_404_for_unknown_id():
    response = client.get("/api/rhythms/no_existe")
    assert response.status_code == 404


def test_third_degree_block_declares_a_fixed_range():
    """Coherencia con el catálogo: av_block_third tiene frecuencia
    estructural, minimum == maximum. Si esto falla, algo se desincronizó
    entre el motor y cómo la API lo expone."""
    response = client.get("/api/rhythms/av_block_third")
    rate_range = response.json()["editable_parameters"]["heart_rate_hz"]
    assert rate_range["minimum"] == rate_range["maximum"]
