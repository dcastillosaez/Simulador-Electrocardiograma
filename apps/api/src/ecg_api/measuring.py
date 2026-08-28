"""Medidas fisiológicas publicadas durante el streaming.

Las calcula el motor (`ecg_engine.measure`), no este módulo: aquí solo vive
la ventana de señal sobre la que se miden y la traducción del resultado al
contrato que viaja por el WebSocket. El frontend nunca calcula un intervalo
ni corrige un QT — recibe milisegundos y los pinta.

El contrato es deliberadamente abierto: `values` es un mapa, no un objeto de
campos fijos. Añadir el eje eléctrico, la frecuencia auricular o lo que
necesiten el corazón 3D y el módulo de farmacología no rompe a un cliente
anterior, que se limita a ignorar las claves que no conoce.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any

import numpy as np

from ecg_engine import AtrialActivity, av_relationship, measure, qtc_bazett_s
from ecg_engine.types import SignalSource

MEASUREMENT_WINDOW_S: float = 10.0
"""Ventana sobre la que se promedian las medidas.

Diez segundos es la tira de ritmo con la que se lee un ECG de verdad. Menos
haría bailar el PR con cada extrasístole; más tardaría demasiado en reflejar
un cambio de parámetros que el usuario acaba de hacer.
"""

MEASUREMENT_INTERVAL_S: float = 1.0
"""Cada cuánto se publica. Un ECG no cambia diez veces por segundo, y medir
sobre diez segundos de señal en cada frame sería trabajo tirado."""


def _ms(seconds: float) -> float | None:
    """Segundos a milisegundos, con el hueco explícito.

    `measure` devuelve NaN cuando algo no es medible —disociación AV,
    morfologías mezcladas, ausencia de eventos— y NaN no es JSON válido:
    `json.dumps` lo emite como el literal `NaN`, que `JSON.parse` rechaza.
    El hueco viaja como `null` y el frontend lo pinta como no disponible.
    """
    if seconds is None or math.isnan(seconds):
        return None
    return round(seconds * 1000.0, 1)


def _bpm(rate_hz: float) -> float | None:
    """Hercios a latidos por minuto, con el mismo hueco explícito que `_ms`."""
    if rate_hz is None or math.isnan(rate_hz):
        return None
    return round(rate_hz * 60.0, 1)


class MeasurementWindow:
    """Los últimos `MEASUREMENT_WINDOW_S` de señal generada.

    Acotada a propósito: sin descartar lo viejo, una guardia de ocho horas a
    500 Hz por doce canales acumularía del orden de 1,4 GB.
    """

    def __init__(
        self,
        sample_rate_hz: int,
        window_s: float = MEASUREMENT_WINDOW_S,
    ) -> None:
        self._sample_rate_hz = sample_rate_hz
        self._capacity_samples = int(window_s * sample_rate_hz)
        self._chunks: deque[np.ndarray] = deque()
        self._samples = 0

    @property
    def sample_rate_hz(self) -> int:
        return self._sample_rate_hz

    @property
    def duration_s(self) -> float:
        return self._samples / float(self._sample_rate_hz)

    def append(self, channels_v: np.ndarray) -> None:
        self._chunks.append(channels_v)
        self._samples += channels_v.shape[1]
        while self._chunks and self._samples - self._chunks[0].shape[1] >= (
            self._capacity_samples
        ):
            self._samples -= self._chunks.popleft().shape[1]

    def signal(self) -> np.ndarray | None:
        if not self._chunks:
            return None
        return np.concatenate(list(self._chunks), axis=1)

    def reset(self) -> None:
        """Un ritmo nuevo arranca un eje de tiempo nuevo: medir a caballo
        entre dos ritmos promediaría dos fisiologías distintas."""
        self._chunks.clear()
        self._samples = 0


def measurements_payload(
    *,
    source: SignalSource,
    window: MeasurementWindow,
    t_end_s: float,
    pr_is_measurable: bool,
    atrial_activity: AtrialActivity,
) -> dict[str, Any] | None:
    """Compone el mensaje de medidas, o `None` si aún no hay señal que medir.

    Publica dos frecuencias, no una. En un ritmo sinusal dicen lo mismo; en
    un bloqueo completo la aurícula va a 75 y el ventrículo a 40, y «la»
    frecuencia cardíaca no existe como número único. La lectura que las une
    —el ratio de conducción, o la disociación— viaja al lado, porque es lo
    que convierte dos cifras en un diagnóstico.

    `atrial_activity` acompaña siempre a la frecuencia auricular y no solo
    cuando falta: un hueco sin explicación se lee como un fallo del
    simulador, y aquí el hueco es el hallazgo —en una fibrilación no hay
    frecuencia auricular que medir, y decirlo es parte de la enseñanza.
    """
    signal_v = window.signal()
    if signal_v is None:
        return None

    duration_s = window.duration_s
    t_start_s = max(0.0, t_end_s - duration_s)
    # La fibrilación ventricular no tiene línea de eventos: su fuente no
    # implementa `events` porque no hay latidos discretos que enumerar. Sin
    # eventos, `measure` devuelve NaN en los tiempos y el payload sale con
    # huecos, que es exactamente lo correcto — una FV no tiene PR ni QT.
    events = source.events(t_start_s, t_end_s) if hasattr(source, "events") else []

    result = measure(
        events,
        signal_v,
        window.sample_rate_hz,
        pr_is_measurable=pr_is_measurable,
        atrial_rate_is_measurable=atrial_activity is AtrialActivity.ORGANIZED,
    )
    qtc_s = qtc_bazett_s(result.qt_s, result.rr_mean_s)

    return {
        "type": "measurements",
        "t_s": round(t_end_s, 3),
        "window_s": round(duration_s, 3),
        "atrial_activity": atrial_activity.value,
        "av_relationship": av_relationship(
            events, result.atrial_rate_hz, result.ventricular_rate_hz
        ),
        "values": {
            "atrial_rate_bpm": _bpm(result.atrial_rate_hz),
            "ventricular_rate_bpm": _bpm(result.ventricular_rate_hz),
            "rr_ms": _ms(result.rr_mean_s),
            "pr_ms": _ms(result.pr_mean_s),
            "qrs_ms": _ms(result.qrs_duration_s),
            "qt_ms": _ms(result.qt_s),
            "qtc_ms": _ms(qtc_s),
        },
    }
