"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from ecg_api.frames import decode_frame
from ecg_api.main import app


def _next_json_message(ws) -> dict:
    """Descarta cualquier frame binario en tránsito y devuelve el primer
    mensaje de texto (JSON). Tras `stop` puede haber uno o dos frames
    binarios ya en vuelo antes de que llegue `stopped`.

    Los mensajes que el servidor envía al cliente llevan `type:
    "websocket.send"` en el sobre ASGI (`"websocket.receive"` es el tipo
    para los mensajes que el cliente envía al servidor) — de ahí que se
    compruebe contra `"websocket.send"` y no contra `"websocket.receive"`.
    """
    while True:
        event = ws.receive()
        if event.get("type") == "websocket.send" and "text" in event:
            return json.loads(event["text"])


def test_start_receives_started_then_binary_frames():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 20260725}
            )
            started = ws.receive_json()
            assert started["type"] == "started"
            assert started["sample_rate_hz"] == 500
            assert started["channels"] == 12

            decoded = decode_frame(ws.receive_bytes())
            assert decoded.sample_rate_hz == 500
            assert decoded.n_channels == 12
            assert decoded.sequence_number == 0
            assert str(decoded.session_id) == started["session_id"]

            ws.send_json({"type": "stop"})
            stopped = _next_json_message(ws)
            assert stopped["type"] == "stopped"
            assert "duration_s" in stopped


def test_unknown_rhythm_reports_not_found_without_closing():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "start", "rhythm_id": "no_existe"})
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "NOT_FOUND"

            # el socket sigue vivo: un start válido a continuación funciona
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = ws.receive_json()
            assert started["type"] == "started"


def test_update_before_start_reports_invalid_params_without_closing():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "update", "params": {"heart_rate_hz": 1.0}})
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "INVALID_PARAMS"

            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = ws.receive_json()
            assert started["type"] == "started"


def test_update_changes_the_rate_observably():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            ws.receive_json()

            # 1.5 Hz (90 lpm) está dentro del rango editable de
            # `sinus_normal` (1,0 a 1,6667 Hz / 60-100 lpm) y es distinto de
            # su valor por defecto (1,1667 Hz / 70 lpm), así que un cambio
            # observable no se confunde con un clamp al límite del rango.
            ws.send_json(
                {"type": "update", "params": {"heart_rate_hz": 1.5}}
            )
            # El streaming ya está en marcha desde `start`: puede haber un
            # frame binario en vuelo antes de que llegue `updated`, igual
            # que documenta `_next_json_message` para el caso de `stop`.
            updated = _next_json_message(ws)
            assert updated["type"] == "updated"
            assert updated["params"]["heart_rate_hz"] == 1.5


def test_pause_stops_frames_and_resume_continues_them():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            ws.receive_json()
            ws.receive_bytes()  # al menos un frame antes de pausar

            ws.send_json({"type": "pause"})
            paused = ws.receive_json()
            assert paused["type"] == "paused"

            ws.send_json({"type": "resume"})
            resumed = ws.receive_json()
            assert resumed["type"] == "resumed"

            # tras reanudar, vuelven a llegar frames
            decode_frame(ws.receive_bytes())


def test_sequence_number_is_monotonic_across_several_frames():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 5}
            )
            ws.receive_json()

            sequence_numbers = [
                decode_frame(ws.receive_bytes()).sequence_number
                for _ in range(5)
            ]
            assert sequence_numbers == sorted(sequence_numbers)
            assert len(set(sequence_numbers)) == len(sequence_numbers)

            ws.send_json({"type": "stop"})
            assert _next_json_message(ws)["type"] == "stopped"


def test_engine_failure_during_streaming_sends_error_and_closes_with_1011():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            with patch(
                "ecg_engine.EcgEngine.generate",
                side_effect=RuntimeError("fallo simulado del motor"),
            ):
                ws.send_json(
                    {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
                )
                ws.receive_json()  # started
                error = ws.receive_json()
                assert error["type"] == "error"
                assert error["code"] == "ENGINE_FAILURE"
