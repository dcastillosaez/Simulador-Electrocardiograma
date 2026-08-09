"""Requiere Postgres real: `docker compose up -d db` antes de ejecutar."""

import time
from unittest.mock import patch

from fastapi.testclient import TestClient

from ecg_api.frames import decode_frame
from ecg_api.main import app

from .conftest import receive_frame_bytes, receive_json_of_type

# Por este socket viajan cuatro canales: las respuestas a los comandos, los
# frames binarios, y las medidas y la farmacología, que salen solas a 1 Hz y ya
# en el primer tic. Nada garantiza el orden entre ellos, así que aquí no se lee
# "el siguiente mensaje" sino "el siguiente de este tipo". Leerlo a ciegas es lo
# que hacía fallar a este fichero entero contra un servidor que funcionaba.


def test_start_receives_started_then_binary_frames():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 20260725}
            )
            started = receive_json_of_type(ws, "started")
            assert started["type"] == "started"
            assert started["sample_rate_hz"] == 500
            assert started["channels"] == 12

            decoded = decode_frame(receive_frame_bytes(ws))
            assert decoded.sample_rate_hz == 500
            assert decoded.n_channels == 12
            assert decoded.sequence_number == 0
            assert str(decoded.session_id) == started["session_id"]

            ws.send_json({"type": "stop"})
            stopped = receive_json_of_type(ws, "stopped")
            assert stopped["type"] == "stopped"
            assert "duration_s" in stopped


def test_unknown_rhythm_reports_not_found_without_closing():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "start", "rhythm_id": "no_existe"})
            error = receive_json_of_type(ws, "error")
            assert error["type"] == "error"
            assert error["code"] == "NOT_FOUND"

            # el socket sigue vivo: un start válido a continuación funciona
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = receive_json_of_type(ws, "started")
            assert started["type"] == "started"


def test_update_before_start_reports_invalid_params_without_closing():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json({"type": "update", "params": {"heart_rate_hz": 1.0}})
            error = receive_json_of_type(ws, "error")
            assert error["type"] == "error"
            assert error["code"] == "INVALID_PARAMS"

            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            started = receive_json_of_type(ws, "started")
            assert started["type"] == "started"


def test_update_changes_the_rate_observably():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            receive_json_of_type(ws, "started")

            # 1.5 Hz (90 lpm) está dentro del rango editable de
            # `sinus_normal` (1,0 a 1,6667 Hz / 60-100 lpm) y es distinto de
            # su valor por defecto (1,1667 Hz / 70 lpm), así que un cambio
            # observable no se confunde con un clamp al límite del rango.
            ws.send_json(
                {"type": "update", "params": {"heart_rate_hz": 1.5}}
            )
            # El streaming ya está en marcha desde `start`, así que entre el
            # comando y su respuesta hay frames y medidas en vuelo.
            updated = receive_json_of_type(ws, "updated")
            assert updated["type"] == "updated"
            assert updated["params"]["heart_rate_hz"] == 1.5


def test_pause_stops_frames_and_resume_continues_them():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            receive_json_of_type(ws, "started")
            receive_frame_bytes(ws)  # al menos un frame antes de pausar

            ws.send_json({"type": "pause"})
            paused = receive_json_of_type(ws, "paused")
            assert paused["type"] == "paused"

            ws.send_json({"type": "resume"})
            resumed = receive_json_of_type(ws, "resumed")
            assert resumed["type"] == "resumed"

            # tras reanudar, vuelven a llegar frames
            decode_frame(receive_frame_bytes(ws))


def test_sequence_number_is_monotonic_across_several_frames():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 5}
            )
            receive_json_of_type(ws, "started")

            sequence_numbers = [
                decode_frame(receive_frame_bytes(ws)).sequence_number
                for _ in range(5)
            ]
            assert sequence_numbers == sorted(sequence_numbers)
            assert len(set(sequence_numbers)) == len(sequence_numbers)

            ws.send_json({"type": "stop"})
            receive_json_of_type(ws, "stopped")


def test_second_start_replaces_the_first_session_cleanly():
    """Un `start` sobre un socket con una sesión ya activa reemplaza esa
    sesión en vez de dejar el par de tareas de fondo anterior huérfano.

    Antes del arreglo, la sesión vieja seguía produciendo frames al mismo
    `outbox` (duplicando la cadencia real de streaming) y los frames que
    ya estuvieran en cola llegaban después del `started` de la sesión
    nueva llevando el `session_id` de la sesión vieja horneado en la
    cabecera."""
    with TestClient(app) as client:
        with client.websocket_connect("/ws/simulation") as ws:
            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 1}
            )
            first = receive_json_of_type(ws, "started")
            assert first["type"] == "started"
            first_session_id = first["session_id"]
            decode_frame(receive_frame_bytes(ws))  # deja que el streaming arranque

            ws.send_json(
                {"type": "start", "rhythm_id": "sinus_normal", "seed": 2}
            )
            second = receive_json_of_type(ws, "started")
            assert second["type"] == "started"
            second_session_id = second["session_id"]
            assert second_session_id != first_session_id

            # `session_id`/`sequence_number` por sí solos no bastan para
            # detectar un productor huérfano: `stream_chunks` lee
            # `manager.session_id` en vivo en cada iteración (así que una
            # tarea vieja ya escribiría con el `session_id` nuevo tras el
            # reemplazo) y el incremento de `_sequence_number` es síncrono,
            # así que sigue siendo monótono y sin duplicados aunque hubiera
            # dos productores corriendo a la vez. Lo único que delata un
            # segundo productor huérfano es la CADENCIA: el doble de
            # productores llenan el outbox al doble de velocidad.
            start_s = time.monotonic()
            decoded_frames = [decode_frame(receive_frame_bytes(ws)) for _ in range(10)]
            elapsed_s = time.monotonic() - start_s

            session_ids = {str(f.session_id) for f in decoded_frames}
            assert session_ids == {second_session_id}

            sequence_numbers = [f.sequence_number for f in decoded_frames]
            assert sequence_numbers == sorted(sequence_numbers)
            assert len(set(sequence_numbers)) == len(sequence_numbers)

            # A ~10 frames/s (CHUNK_INTERVAL_S=0.1s) con un solo productor,
            # 10 frames tardan ~1,0s reales. Con el productor viejo huérfano
            # sumándose, tardarían ~0,5s. 0,7s separa ambos casos con margen
            # de sobra a cada lado para el jitter del scheduler.
            assert elapsed_s > 0.7, (
                f"10 frames llegaron en {elapsed_s:.3f}s: sugiere mas de "
                "un productor escribiendo en el outbox tras el start repetido"
            )


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
                receive_json_of_type(ws, "started")
                error = receive_json_of_type(ws, "error")
                assert error["type"] == "error"
                assert error["code"] == "ENGINE_FAILURE"
