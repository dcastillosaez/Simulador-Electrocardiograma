"""Contrato del frame binario del streaming.

Cabecera fija de 40 bytes, little-endian salvo `session_id`, que va en su
UUID canónico (orden de red, RFC 4122) sin reordenar en ningún extremo. La
cabecera de 40 bytes deja el payload alineado a 4, que es lo que exige
`new Float32Array(buffer, 40, n)` en JavaScript — no es un tamaño arbitrario.
"""

from __future__ import annotations

import struct
import uuid
from dataclasses import dataclass

import numpy as np

from ecg_engine.types import N_LEADS

FRAME_VERSION = 1
HEADER_FORMAT = "<HHBBHIId16s"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)


def encode_frame(
    *,
    session_id: uuid.UUID,
    sequence_number: int,
    t_start_s: float,
    sample_rate_hz: int,
    channels_v: np.ndarray,
) -> bytes:
    if channels_v.ndim != 2 or channels_v.shape[0] != N_LEADS:
        raise ValueError(
            f"channels_v debe tener forma (12, n), recibido {channels_v.shape}"
        )
    n_samples = channels_v.shape[1]
    header = struct.pack(
        HEADER_FORMAT,
        FRAME_VERSION,
        sample_rate_hz,
        N_LEADS,
        0,
        n_samples,
        sequence_number,
        0,
        t_start_s,
        session_id.bytes,
    )
    payload = np.ascontiguousarray(channels_v, dtype="<f4").tobytes()
    return header + payload


@dataclass(frozen=True, slots=True)
class DecodedFrame:
    version: int
    sample_rate_hz: int
    n_channels: int
    n_samples_per_channel: int
    sequence_number: int
    t_start_s: float
    session_id: uuid.UUID
    channels_v: np.ndarray


def decode_frame(data: bytes) -> DecodedFrame:
    if len(data) < HEADER_SIZE:
        raise ValueError(f"frame demasiado corto: {len(data)} bytes")
    (
        version,
        sample_rate_hz,
        n_channels,
        _reserved,
        n_samples,
        sequence_number,
        _reserved2,
        t_start_s,
        session_bytes,
    ) = struct.unpack(HEADER_FORMAT, data[:HEADER_SIZE])

    expected_payload = n_channels * n_samples * 4
    payload = data[HEADER_SIZE : HEADER_SIZE + expected_payload]
    if len(payload) != expected_payload:
        raise ValueError(
            f"payload incompleto: esperados {expected_payload} bytes, "
            f"recibidos {len(payload)}"
        )
    channels_v = np.frombuffer(payload, dtype="<f4").reshape(n_channels, n_samples)
    return DecodedFrame(
        version=version,
        sample_rate_hz=sample_rate_hz,
        n_channels=n_channels,
        n_samples_per_channel=n_samples,
        sequence_number=sequence_number,
        t_start_s=t_start_s,
        session_id=uuid.UUID(bytes=session_bytes),
        channels_v=channels_v,
    )
