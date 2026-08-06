from fastapi.testclient import TestClient

from ecg_api.main import app

client = TestClient(app)


def test_list_drugs_returns_the_phase_f_library():
    response = client.get("/api/drugs")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 15
    assert {
        "drug_id", "display_name", "category", "routes", "dose_unit",
        "reference_dose", "max_cumulative_dose", "onset_s", "peak_s",
        "duration_s",
    } <= body[0].keys()


def test_get_drug_detail_includes_effects_and_references():
    response = client.get("/api/drugs/amiodarone")
    assert response.status_code == 200
    body = response.json()
    assert body["drug_id"] == "amiodarone"
    assert body["effects"]["qt_delta_ms"] > 0
    assert len(body["references"]) >= 1
    assert body["clinical_note"]


def test_drug_detail_omits_neutral_effects():
    """Volcar los diecisiete campos llenaría la ficha de ceros y unos que no
    dicen nada de la molécula."""
    body = client.get("/api/drugs/atropine").json()
    assert "st_shift_mv" not in body["effects"]
    assert body["effects"]["heart_rate_delta_bpm"] > 0


def test_get_drug_404_for_unknown_id():
    assert client.get("/api/drugs/agua_bendita").status_code == 404


def test_interactions_endpoint_is_not_shadowed_by_the_drug_id_route():
    """Con las rutas en el orden inverso, FastAPI resolvería
    `/interactions` como un fármaco con ese nombre y devolvería un 404."""
    response = client.get("/api/drugs/interactions")
    assert response.status_code == 200
    body = response.json()
    rule_ids = {r["rule_id"] for r in body}
    assert "ccb_beta_blocker_av" in rule_ids
    assert all(len(r["participants"]) >= 2 for r in body)
