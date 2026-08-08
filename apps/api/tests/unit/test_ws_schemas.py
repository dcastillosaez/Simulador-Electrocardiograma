import json
import uuid

import pytest

from ecg_api.schemas import (
    ClientMessageError,
    EngineParamsPayload,
    PauseMessage,
    PingMessage,
    ResumeMessage,
    StartMessage,
    StopMessage,
    UpdateMessage,
    engine_params_to_dict,
    error_message,
    parse_client_message,
    started_message,
    stopped_message,
    updated_message,
)
from ecg_engine import EngineParams, NoiseParams


def test_parse_start_message_with_full_params():
    raw = json.dumps({
        "type": "start", "rhythm_id": "sinus_normal", "seed": 20260725,
        "params": {"heart_rate_hz": 1.2},
    })
    message = parse_client_message(raw)
    assert isinstance(message, StartMessage)
    assert message.rhythm_id == "sinus_normal"
    assert message.seed == 20260725
    assert message.params.heart_rate_hz == 1.2


def test_parse_start_message_without_params_defers_to_rhythm_defaults():
    raw = json.dumps({"type": "start", "rhythm_id": "sinus_normal"})
    message = parse_client_message(raw)
    assert message.params is None
    assert message.seed is None


def test_parse_update_message():
    raw = json.dumps({"type": "update", "params": {"heart_rate_hz": 1.5}})
    message = parse_client_message(raw)
    assert isinstance(message, UpdateMessage)
    assert message.params.heart_rate_hz == 1.5


@pytest.mark.parametrize(
    "type_, cls",
    [("pause", PauseMessage), ("resume", ResumeMessage), ("stop", StopMessage)],
)
def test_parse_control_messages_without_body(type_, cls):
    message = parse_client_message(json.dumps({"type": type_}))
    assert isinstance(message, cls)


def test_ping_is_recognised_but_reserved():
    """No se despacha en fase 1, pero el tipo ya existe en el protocolo: se
    podrá activar sin romper clientes que ya lo envían sin esperar respuesta."""
    message = parse_client_message(json.dumps({"type": "ping"}))
    assert isinstance(message, PingMessage)


def test_parse_rejects_unknown_type():
    with pytest.raises(ClientMessageError, match="desconocido"):
        parse_client_message(json.dumps({"type": "teleport"}))


def test_parse_rejects_invalid_json():
    with pytest.raises(ClientMessageError):
        parse_client_message("{not json")


def test_parse_rejects_update_without_params():
    with pytest.raises(ClientMessageError):
        parse_client_message(json.dumps({"type": "update"}))


def test_engine_params_payload_round_trips_to_engine_params():
    payload = EngineParamsPayload(heart_rate_hz=70 / 60)
    params = payload.to_engine_params()
    assert isinstance(params, EngineParams)
    assert params.heart_rate_hz == pytest.approx(70 / 60)
    assert isinstance(params.noise, NoiseParams)


def test_engine_params_to_dict_is_the_inverse_shape():
    params = EngineParams(heart_rate_hz=1.5)
    payload = engine_params_to_dict(params)
    assert payload["heart_rate_hz"] == 1.5
    assert payload["noise"]["emg_v"] == 0.0
    assert "rsa_fraction" in payload["variability"]


def test_server_message_builders_produce_the_documented_shape():
    session_id = uuid.uuid4()
    assert started_message(
        session_id=session_id, seed=1, sample_rate_hz=500, channels=12
    ) == {
        "type": "started", "session_id": str(session_id), "seed": 1,
        "sample_rate_hz": 500, "channels": 12,
    }
    assert stopped_message(duration_s=12.5) == {
        "type": "stopped", "duration_s": 12.5,
    }
    assert error_message(code="NOT_FOUND", detail="x") == {
        "type": "error", "code": "NOT_FOUND", "detail": "x",
    }
    assert (
        updated_message(params=EngineParams(heart_rate_hz=1.0))["params"][
            "heart_rate_hz"
        ]
        == 1.0
    )


def test_axis_round_trips_through_engine_params():
    payload = EngineParamsPayload.model_validate(
        {
            "heart_rate_hz": 70 / 60,
            "axis": {"orientation_deg": -30.0, "qrs_offset_deg": 15.0},
        }
    )
    engine = payload.to_engine_params()
    assert engine.axis.orientation_deg == -30.0
    assert engine.axis.qrs_offset_deg == 15.0
    # p_offset_deg no venía en el payload: cae al default de diseño.
    assert engine.axis.p_offset_deg == 3.4

    dumped = engine_params_to_dict(engine)
    assert dumped["axis"]["orientation_deg"] == -30.0
    assert dumped["axis"]["qrs_offset_deg"] == 15.0


def test_axis_is_optional_and_defaults_to_the_reference_orientation():
    payload = EngineParamsPayload.model_validate({"heart_rate_hz": 1.0})
    assert payload.to_engine_params().axis.orientation_deg == 50.0


# --- Limites de lo que se acepta del cliente -------------------------------


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_numbers_are_rejected(literal):
    # `json.loads` acepta estos tres literales, Pydantic los admite en un float
    # por defecto, y el clamp del catalogo los deja pasar enteros: toda
    # comparacion con NaN es falsa, asi que `min(max(nan, x), y)` devuelve
    # `nan`. El clamp protege de una frecuencia de mil millones, no de esto.
    raw = f'{{"type": "start", "rhythm_id": "sinus_normal", "params": {{"heart_rate_hz": {literal}}}}}'
    with pytest.raises(ClientMessageError):
        parse_client_message(raw)


def test_an_absurd_heart_rate_is_rejected_instead_of_clamped():
    raw = json.dumps({
        "type": "start", "rhythm_id": "sinus_normal",
        "params": {"heart_rate_hz": 1e9},
    })
    with pytest.raises(ClientMessageError):
        parse_client_message(raw)


def test_a_heart_rate_of_zero_is_rejected():
    raw = json.dumps({
        "type": "start", "rhythm_id": "x", "params": {"heart_rate_hz": 0.0},
    })
    with pytest.raises(ClientMessageError):
        parse_client_message(raw)


def test_free_text_has_a_ceiling():
    # Sin tope, un cliente escribe megabytes en la base de datos --las notas se
    # persisten con la administracion-- y nadie se lo impide.
    raw = json.dumps({
        "type": "administer", "drug_id": "atropine", "dose": 1.0,
        "notes": "x" * 5000,
    })
    with pytest.raises(ClientMessageError):
        parse_client_message(raw)


def test_a_dose_of_zero_or_less_is_rejected():
    for dose in (0.0, -1.0):
        raw = json.dumps({
            "type": "administer", "drug_id": "atropine", "dose": dose,
        })
        with pytest.raises(ClientMessageError):
            parse_client_message(raw)


def test_a_seed_outside_the_servers_own_range_is_rejected():
    # El servidor sortea el suyo en [0, 2**31); uno fuera de ese rango no
    # reproduce nada, que es lo unico para lo que sirve un seed.
    raw = json.dumps({"type": "start", "rhythm_id": "x", "seed": 2**40})
    with pytest.raises(ClientMessageError):
        parse_client_message(raw)


def test_the_usual_parameters_still_pass():
    # La red no debe cerrarse tanto que estorbe: 70 lpm con ruido de monitor.
    raw = json.dumps({
        "type": "start", "rhythm_id": "sinus_normal", "seed": 7,
        "params": {
            "heart_rate_hz": 70 / 60,
            "noise": {"emg_v": 0.00002, "mains_v": 0.00001},
            "axis": {"orientation_deg": -30.0},
        },
    })
    message = parse_client_message(raw)
    assert isinstance(message, StartMessage)
    assert message.params.noise.emg_v == 0.00002
