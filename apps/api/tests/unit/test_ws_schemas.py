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
