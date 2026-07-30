import math

import numpy as np
import pytest

from ecg_api.measuring import (
    MEASUREMENT_WINDOW_S,
    MeasurementWindow,
    measurements_payload,
)
from ecg_engine.catalog import get_rhythm
from ecg_engine.types import N_LEADS


def build_source(rhythm_id: str = "sinus_normal", seed: int = 20260730):
    return get_rhythm(rhythm_id).build_source(np.random.default_rng(seed))


class TestMeasurementWindow:
    def test_it_starts_empty(self):
        window = MeasurementWindow(sample_rate_hz=500)
        assert window.duration_s == 0.0
        assert window.signal() is None

    def test_it_concatenates_the_chunks_it_receives(self):
        window = MeasurementWindow(sample_rate_hz=500)
        for _ in range(4):
            window.append(np.zeros((N_LEADS, 50)))

        signal = window.signal()
        assert signal is not None
        assert signal.shape == (N_LEADS, 200)
        assert window.duration_s == pytest.approx(0.4)

    def test_it_forgets_what_falls_out_of_the_window(self):
        # Sin esto la memoria crece sin limite durante una sesion larga: una
        # guardia de ocho horas a 500Hz por doce canales son ~1,4GB.
        window = MeasurementWindow(sample_rate_hz=500)
        chunks = int(MEASUREMENT_WINDOW_S * 500 / 50) + 20
        for _ in range(chunks):
            window.append(np.zeros((N_LEADS, 50)))

        assert window.duration_s == pytest.approx(MEASUREMENT_WINDOW_S, abs=0.1)

    def test_reset_empties_it(self):
        # Un ritmo nuevo arranca un eje de tiempo nuevo: medir a caballo entre
        # dos ritmos daria un promedio de dos fisiologias distintas.
        window = MeasurementWindow(sample_rate_hz=500)
        window.append(np.zeros((N_LEADS, 50)))
        window.reset()
        assert window.signal() is None


class TestMeasurementsPayload:
    def _window_for(self, source, seconds: float, sample_rate_hz: int = 500):
        window = MeasurementWindow(sample_rate_hz=sample_rate_hz)
        window.append(source.render(0.0, int(seconds * sample_rate_hz), sample_rate_hz))
        return window

    def test_it_reports_the_intervals_in_milliseconds(self):
        # El frontend no convierte nada: recibe milisegundos porque es la
        # unidad en la que un clinico lee un ECG.
        source = build_source()
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=True,
        )

        values = payload["values"]
        assert 100.0 < values["pr_ms"] < 220.0
        assert 60.0 < values["qrs_ms"] < 120.0
        assert 300.0 < values["qt_ms"] < 460.0
        assert 600.0 < values["rr_ms"] < 1200.0
        assert 50.0 < values["heart_rate_bpm"] < 100.0

    def test_it_includes_the_corrected_qt(self):
        source = build_source()
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=True,
        )

        values = payload["values"]
        # Sinusal normal ronda 70 lpm, asi que RR < 1s y Bazett estira el QT.
        assert values["qtc_ms"] > values["qt_ms"]

    def test_a_non_measurable_value_travels_as_null_and_not_as_nan(self):
        # NaN no es JSON valido: `json.dumps` lo emite como el literal `NaN`,
        # que `JSON.parse` rechaza. El hueco tiene que viajar como null para
        # que el frontend lo pinte como "no disponible".
        source = build_source("atrial_flutter")
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=False,
        )

        assert payload["values"]["pr_ms"] is None
        assert not any(
            isinstance(v, float) and math.isnan(v)
            for v in payload["values"].values()
        )

    def test_the_payload_carries_its_own_context(self):
        source = build_source()
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=True,
        )

        assert payload["type"] == "measurements"
        assert payload["t_s"] == pytest.approx(10.0)
        assert payload["window_s"] == pytest.approx(10.0)

    def test_the_values_are_an_open_map(self):
        # El contrato se diseña para crecer: eje electrico, frecuencia
        # auricular, y mas adelante lo que necesiten el corazon 3D y el modulo
        # de farmacologia. Que `values` sea un mapa y no un objeto con campos
        # fijos permite anadir metricas sin romper a un cliente antiguo, que
        # simplemente ignora las claves que no conoce.
        source = build_source()
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=True,
        )

        assert isinstance(payload["values"], dict)
        assert all(isinstance(k, str) for k in payload["values"])

    def test_an_empty_window_produces_nothing(self):
        source = build_source()
        assert (
            measurements_payload(
                source=source,
                window=MeasurementWindow(sample_rate_hz=500),
                t_end_s=0.0,
                pr_is_measurable=True,
            )
            is None
        )

    def test_it_survives_a_rhythm_without_discrete_events(self):
        # Fibrilacion ventricular: no hay eventos que medir y measure()
        # devuelve NaN en casi todo. El payload debe salir igualmente, con
        # huecos, en vez de reventar el bucle de streaming.
        source = build_source("ventricular_fibrillation")
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=False,
        )

        assert payload is not None
        assert payload["values"]["pr_ms"] is None
