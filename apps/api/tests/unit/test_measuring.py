import math

import numpy as np
import pytest

from ecg_api.measuring import (
    MEASUREMENT_WINDOW_S,
    MeasurementWindow,
    measurements_payload,
)
from ecg_engine.catalog import AtrialActivity, get_rhythm
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
            atrial_activity=AtrialActivity.ORGANIZED,
        )

        values = payload["values"]
        assert 100.0 < values["pr_ms"] < 220.0
        assert 60.0 < values["qrs_ms"] < 120.0
        assert 300.0 < values["qt_ms"] < 460.0
        assert 600.0 < values["rr_ms"] < 1200.0
        assert 50.0 < values["ventricular_rate_bpm"] < 100.0

    def test_it_includes_the_corrected_qt(self):
        source = build_source()
        payload = measurements_payload(
            source=source,
            window=self._window_for(source, 10.0),
            t_end_s=10.0,
            pr_is_measurable=True,
            atrial_activity=AtrialActivity.ORGANIZED,
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
            atrial_activity=AtrialActivity.ORGANIZED,
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
            atrial_activity=AtrialActivity.ORGANIZED,
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
            atrial_activity=AtrialActivity.ORGANIZED,
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
                atrial_activity=AtrialActivity.ORGANIZED,
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
            atrial_activity=AtrialActivity.ABSENT,
        )

        assert payload is not None
        assert payload["values"]["pr_ms"] is None


class TestAtrialAndVentricularRates:
    """Las dos frecuencias tal y como salen por el WebSocket."""

    def _payload(self, rhythm_id: str, seconds: float = 10.0):
        definition = get_rhythm(rhythm_id)
        source = build_source(rhythm_id)
        window = MeasurementWindow(sample_rate_hz=500)
        window.append(source.render(0.0, int(seconds * 500), 500))
        return measurements_payload(
            source=source,
            window=window,
            t_end_s=seconds,
            pr_is_measurable=definition.pr_is_measurable,
            atrial_activity=definition.atrial_activity,
        )

    def test_sinus_rhythm_publishes_both_rates_and_a_one_to_one(self):
        payload = self._payload("sinus_normal")
        values = payload["values"]
        assert values["atrial_rate_bpm"] == pytest.approx(
            values["ventricular_rate_bpm"], rel=0.05
        )
        assert payload["av_relationship"] == "1:1"
        assert payload["atrial_activity"] == "organized"

    def test_complete_block_publishes_two_different_rates(self):
        # El caso que motiva la separacion: publicar un unico numero aqui es
        # publicar 75 lpm para un paciente cuyo pulso es 40.
        values = self._payload("av_block_third")["values"]
        assert values["atrial_rate_bpm"] > values["ventricular_rate_bpm"]

    def test_complete_block_is_reported_as_dissociated(self):
        assert self._payload("av_block_third")["av_relationship"] == "dissociated"

    def test_atrial_flutter_publishes_its_two_to_one_conduction(self):
        payload = self._payload("atrial_flutter")
        assert payload["values"]["atrial_rate_bpm"] == pytest.approx(300, rel=0.1)
        assert payload["av_relationship"] == "2:1"

    def test_atrial_fibrillation_has_a_hole_with_a_reason(self):
        # El hueco no es un fallo del simulador: es el hallazgo. La etiqueta
        # viaja al lado para que la interfaz pueda decirlo con palabras.
        payload = self._payload("atrial_fibrillation")
        assert payload["values"]["atrial_rate_bpm"] is None
        assert payload["atrial_activity"] == "fibrillatory"
        assert payload["av_relationship"] is None

    def test_ventricular_fibrillation_has_neither_rate(self):
        payload = self._payload("ventricular_fibrillation")
        assert payload["values"]["atrial_rate_bpm"] is None
        assert payload["values"]["ventricular_rate_bpm"] is None
        assert payload["atrial_activity"] == "absent"

    def test_the_payload_is_json_serialisable(self):
        # NaN no sobrevive a `json.dumps`/`JSON.parse`. Las dos frecuencias
        # nuevas viajan por el mismo canal y valen NaN a menudo.
        import json

        for rhythm_id in ("sinus_normal", "atrial_fibrillation",
                          "ventricular_fibrillation", "atrial_flutter"):
            json.loads(json.dumps(self._payload(rhythm_id)))
