from fastapi.testclient import TestClient

from ecg_api.main import app

client = TestClient(app)


def test_list_rhythms_returns_the_twelve_mvp_rhythms():
    response = client.get("/api/rhythms")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 12
    assert {
        "rhythm_id", "display_name", "category",
        "ventricular_rate_hz", "pr_is_measurable",
    } <= body[0].keys()


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
