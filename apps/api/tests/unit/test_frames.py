import struct
import uuid

import numpy as np
import pytest

from ecg_api.frames import HEADER_SIZE, decode_frame, encode_frame
from ecg_engine.types import N_LEADS


def make_channels(n_samples: int = 50) -> np.ndarray:
    return (
        np.arange(N_LEADS * n_samples, dtype=np.float64).reshape(N_LEADS, n_samples)
        * 1e-6
    )


def test_header_is_exactly_forty_bytes():
    assert HEADER_SIZE == 40


def test_encoded_frame_size_matches_header_plus_payload():
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=make_channels(50),
    )
    assert len(frame) == 40 + 12 * 50 * 4


def test_header_fields_are_little_endian_and_in_order():
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=7, t_start_s=1.5,
        sample_rate_hz=500, channels_v=make_channels(50),
    )
    fields = struct.unpack_from("<HHBBHIId", frame, 0)
    assert fields == (1, 500, 12, 0, 50, 7, 0, 1.5)


def test_session_id_bytes_are_not_reordered():
    session_id = uuid.uuid4()
    frame = encode_frame(
        session_id=session_id, sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=make_channels(10),
    )
    assert frame[24:40] == session_id.bytes  # canónico, no .bytes_le


def test_payload_is_channel_major_not_interleaved():
    channels = make_channels(3)
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=channels,
    )
    raw = np.frombuffer(frame[HEADER_SIZE:], dtype="<f4")
    # Las tres primeras posiciones son el canal I completo; las tres
    # siguientes, el canal II completo. Si estuviera intercalado, la
    # posición 1 sería la primera muestra de II, no la segunda de I.
    assert raw[0:3] == pytest.approx(channels[0], abs=1e-9)
    assert raw[3:6] == pytest.approx(channels[1], abs=1e-9)


def test_encode_rejects_wrong_lead_count():
    with pytest.raises(ValueError, match="12"):
        encode_frame(
            session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
            sample_rate_hz=500, channels_v=np.zeros((6, 50)),
        )


def test_decode_is_the_exact_inverse_of_encode():
    session_id = uuid.uuid4()
    channels = make_channels(50)
    frame = encode_frame(
        session_id=session_id, sequence_number=42, t_start_s=8.3,
        sample_rate_hz=500, channels_v=channels,
    )
    decoded = decode_frame(frame)
    assert decoded.version == 1
    assert decoded.sample_rate_hz == 500
    assert decoded.n_channels == 12
    assert decoded.n_samples_per_channel == 50
    assert decoded.sequence_number == 42
    assert decoded.t_start_s == pytest.approx(8.3)
    assert decoded.session_id == session_id
    assert np.allclose(decoded.channels_v, channels, atol=1e-6)  # precisión float32


def test_decode_rejects_a_truncated_frame():
    frame = encode_frame(
        session_id=uuid.uuid4(), sequence_number=0, t_start_s=0.0,
        sample_rate_hz=500, channels_v=make_channels(50),
    )
    with pytest.raises(ValueError, match="incompleto"):
        decode_frame(frame[:-10])
