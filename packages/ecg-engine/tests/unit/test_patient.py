"""El paciente personalizado: lo que se pide es lo que sale."""

import math

import numpy as np
import pytest

from ecg_engine.beat import get_template, qrs_duration_s, qt_duration_s
from ecg_engine.custom_beat import (
    WIDE_QRS_THRESHOLD_MS,
    custom_atrial_id,
    custom_ventricular_id,
)
from ecg_engine.measurements import DISSOCIATED, av_relationship, measure
from ecg_engine.mechanics import ContractionMode
from ecg_engine.patient import (
    AvConduction,
    PatientSpec,
    build_patient_source,
)
from ecg_engine.types import LEAD_ORDER, EventKind, WaveTarget

SAMPLE_RATE_HZ = 500
SEED = 20260725


def simulate(spec: PatientSpec, seconds: float = 30.0):
    source = build_patient_source(spec, np.random.default_rng(SEED))
    signal = source.render(0.0, int(seconds * SAMPLE_RATE_HZ), SAMPLE_RATE_HZ)
    events = source.events(0.0, seconds)
    return events, signal


def measured(spec: PatientSpec, seconds: float = 30.0):
    events, signal = simulate(spec, seconds)
    return measure(
        events,
        signal,
        SAMPLE_RATE_HZ,
        pr_is_measurable=spec.pr_is_measurable,
    )


class TestIntervalsAreWhatWasAsked:
    """La propiedad que sostiene todo lo demás.

    Si el editor dice «QRS de 140 ms» y la medida sobre la señal generada
    dice 128, el paciente personalizado no sirve para enseñar a medir: el
    alumno mediría bien y el simulador le diría que se ha equivocado.
    """

    @pytest.mark.parametrize("qrs_ms", [70.0, 90.0, 110.0, 140.0, 180.0])
    def test_the_qrs_lasts_what_was_asked(self, qrs_ms):
        template = get_template(
            custom_ventricular_id(qrs_ms=qrs_ms, qt_ms=max(qrs_ms + 250, 400))
        )
        assert qrs_duration_s(template) * 1000 == pytest.approx(qrs_ms, abs=0.5)

    @pytest.mark.parametrize("qt_ms", [300.0, 400.0, 480.0, 600.0])
    def test_the_qt_lasts_what_was_asked(self, qt_ms):
        template = get_template(custom_ventricular_id(qrs_ms=90.0, qt_ms=qt_ms))
        assert qt_duration_s(template) * 1000 == pytest.approx(qt_ms, abs=0.5)

    def test_the_measurement_over_the_generated_signal_agrees(self):
        """No basta con que la plantilla mida bien: lo que cuenta es lo que
        `measure` publica sobre la señal que sale por el WebSocket."""
        result = measured(PatientSpec(pr_ms=200.0, qrs_ms=130.0, qt_ms=460.0))
        assert result.pr_mean_s * 1000 == pytest.approx(200.0, abs=2.0)
        assert result.qrs_duration_s * 1000 == pytest.approx(130.0, abs=1.0)
        assert result.qt_s * 1000 == pytest.approx(460.0, abs=1.0)

    def test_a_qt_shorter_than_its_own_qrs_is_refused(self):
        # No es un paciente enfermo: es una descripción imposible, y pintaría
        # la T dentro del complejo.
        with pytest.raises(ValueError, match="qt_ms"):
            PatientSpec(qrs_ms=200.0, qt_ms=180.0)


class TestMorphology:
    def test_a_wide_qrs_is_drawn_as_ventricular_not_as_a_stretched_normal(self):
        """Un QRS ancho tiene otra forma, no la misma estirada.

        Se comprueba por la polaridad de la T, que en la morfología ancha es
        opuesta: es la diferencia visible entre un bloqueo de rama y un
        complejo normal al que le han dado de sí.
        """
        wide = get_template(
            custom_ventricular_id(qrs_ms=WIDE_QRS_THRESHOLD_MS + 20, qt_ms=460.0)
        )
        narrow = get_template(custom_ventricular_id(qrs_ms=90.0, qt_ms=400.0))
        wide_t = wide.components_for(WaveTarget.T)[0].amplitude_v
        narrow_t = narrow.components_for(WaveTarget.T)[0].amplitude_v
        assert narrow_t > 0 > wide_t

    def test_an_inverted_t_flips_the_wave(self):
        template = get_template(
            custom_ventricular_id(qrs_ms=90.0, qt_ms=400.0, t_scale=-1.0)
        )
        assert template.components_for(WaveTarget.T)[0].amplitude_v < 0

    def test_st_elevation_lifts_the_segment_by_what_was_asked(self):
        template = get_template(
            custom_ventricular_id(qrs_ms=90.0, qt_ms=400.0, st_shift_mv=0.2)
        )
        st = template.components_for(WaveTarget.ST)[0]
        assert st.amplitude_v == pytest.approx(0.0002)

    def test_the_st_sits_between_the_qrs_and_the_t(self):
        """Con el QT movido, heredar la posición del ST de la plantilla base
        habría pintado la elevación encima de la onda T."""
        template = get_template(custom_ventricular_id(qrs_ms=90.0, qt_ms=600.0))
        st = template.components_for(WaveTarget.ST)[0]
        t = template.components_for(WaveTarget.T)[0]
        assert 0.0 < st.center_s < t.center_s

    def test_a_flattened_p_keeps_the_beat(self):
        """Aplanar la P no quita la despolarización: la aurícula sigue
        mandando latidos al nodo AV aunque no se vea nada."""
        spec = PatientSpec(p_amplitude_scale=0.0)
        events, _ = simulate(spec, seconds=10.0)
        assert any(e.kind is EventKind.ATRIAL for e in events)
        assert any(e.kind is EventKind.VENTRICULAR for e in events)
        assert get_template(custom_atrial_id(p_scale=0.0)).components[0].amplitude_v == 0

    def test_the_st_shift_reaches_the_twelve_leads(self):
        """La comprobación de que la morfología llega a la señal, no solo a
        la plantilla."""
        flat = simulate(PatientSpec(), seconds=10.0)[1]
        elevated = simulate(PatientSpec(st_shift_mv=0.4), seconds=10.0)[1]
        lead_ii = LEAD_ORDER.index("II")
        assert elevated[lead_ii].max() > flat[lead_ii].max()


class TestConduction:
    def test_a_healthy_patient_conducts_one_to_one(self):
        spec = PatientSpec()
        events, signal = simulate(spec, seconds=60.0)
        result = measure(events, signal, SAMPLE_RATE_HZ)
        assert av_relationship(
            events, result.atrial_rate_hz, result.ventricular_rate_hz
        ) == "1:1"

    @pytest.mark.parametrize("ratio", [2, 3, 4])
    def test_a_fixed_ratio_drops_the_beats_it_says(self, ratio):
        spec = PatientSpec(
            atrial_rate_bpm=300.0,
            av_conduction=AvConduction.RATIO,
            conduction_ratio=ratio,
            pr_ms=140.0,
        )
        result = measured(spec, seconds=60.0)
        assert result.ventricular_rate_hz * 60 == pytest.approx(
            300.0 / ratio, rel=0.05
        )

    @pytest.mark.parametrize("cycle", [3, 4, 5, 6])
    def test_wenckebach_reads_as_conduction_and_not_as_dissociation(self, cycle):
        """La regresión que motivó el criterio de periodicidad.

        Un Wenckebach dispersa el PR —hasta 150 ms entre el primero y el
        último del ciclo— y el criterio anterior, que solo miraba la
        dispersión, llamaba «disociación» a un ritmo perfectamente conducido
        en cuanto el ciclo pasaba de cuatro.
        """
        spec = PatientSpec(
            av_conduction=AvConduction.WENCKEBACH, wenckebach_cycle=cycle
        )
        events, signal = simulate(spec, seconds=60.0)
        result = measure(events, signal, SAMPLE_RATE_HZ)
        relationship = av_relationship(
            events, result.atrial_rate_hz, result.ventricular_rate_hz
        )
        assert relationship == f"{cycle}:{cycle - 1}"
        assert not math.isnan(result.pr_mean_s)

    def test_a_wenckebach_cycle_longer_than_the_reading_allows_is_refused(self):
        # Un ciclo que el propio panel no sabría leer no debe poder existir.
        with pytest.raises(ValueError, match="wenckebach_cycle"):
            PatientSpec(
                av_conduction=AvConduction.WENCKEBACH, wenckebach_cycle=9
            )

    def test_a_complete_block_dissociates_and_beats_by_escape(self):
        spec = PatientSpec(
            atrial_rate_bpm=78.0,
            av_conduction=AvConduction.COMPLETE_BLOCK,
            escape_rate_bpm=36.0,
        )
        events, signal = simulate(spec, seconds=60.0)
        result = measure(
            events, signal, SAMPLE_RATE_HZ, pr_is_measurable=spec.pr_is_measurable
        )
        assert result.atrial_rate_hz * 60 == pytest.approx(78.0, rel=0.06)
        assert result.ventricular_rate_hz * 60 == pytest.approx(36.0, rel=0.06)
        assert (
            av_relationship(events, result.atrial_rate_hz, result.ventricular_rate_hz)
            == DISSOCIATED
        )
        assert math.isnan(result.pr_mean_s)

    def test_without_atria_the_ventricle_beats_alone(self):
        spec = PatientSpec(atrial_rate_bpm=0.0, escape_rate_bpm=32.0)
        events, signal = simulate(spec, seconds=60.0)
        result = measure(events, signal, SAMPLE_RATE_HZ, pr_is_measurable=False)
        assert not any(e.kind is EventKind.ATRIAL for e in events)
        assert result.ventricular_rate_hz * 60 == pytest.approx(32.0, rel=0.06)

    def test_a_conducted_rhythm_gets_no_escape_beats(self):
        """Dos marcapasos compitiendo darían latidos que nadie ha pedido."""
        spec = PatientSpec(atrial_rate_bpm=70.0, escape_rate_bpm=40.0)
        result = measured(spec, seconds=60.0)
        assert result.ventricular_rate_hz * 60 == pytest.approx(70.0, rel=0.06)


class TestAnticipatedRate:
    """`ventricular_rate_bpm` es lo que la interfaz enseña mientras se mueven
    los controles, antes de que exista un solo latido. Si no coincidiera con
    lo que luego late, el editor mentiría."""

    @pytest.mark.parametrize(
        "spec",
        [
            PatientSpec(),
            PatientSpec(atrial_rate_bpm=120.0),
            PatientSpec(
                atrial_rate_bpm=300.0,
                av_conduction=AvConduction.RATIO,
                conduction_ratio=2,
                pr_ms=140.0,
            ),
            PatientSpec(av_conduction=AvConduction.WENCKEBACH, wenckebach_cycle=4),
            PatientSpec(
                av_conduction=AvConduction.COMPLETE_BLOCK, escape_rate_bpm=45.0
            ),
            PatientSpec(atrial_rate_bpm=0.0, escape_rate_bpm=28.0),
        ],
    )
    def test_the_announced_rate_is_the_one_that_beats(self, spec):
        result = measured(spec, seconds=60.0)
        assert result.ventricular_rate_hz * 60 == pytest.approx(
            spec.ventricular_rate_bpm, rel=0.06
        )


class TestMechanics:
    def test_a_patient_without_beats_is_an_asystole(self):
        """Sin aurícula y sin escape no hay latidos, y un paciente sin
        latidos no tiene tensión: el perfil lo declara para que la capa que
        publica constantes no tenga que adivinarlo."""
        spec = PatientSpec(atrial_rate_bpm=0.0, escape_rate_bpm=0.0)
        assert spec.ventricular_rate_bpm == 0.0
        assert spec.mechanical_profile.ventricular_mode is ContractionMode.ABSENT

    def test_an_escape_rhythm_has_ventricles_but_no_atrial_kick(self):
        spec = PatientSpec(atrial_rate_bpm=0.0, escape_rate_bpm=35.0)
        profile = spec.mechanical_profile
        assert profile.ventricular_mode is ContractionMode.SYNCHRONOUS
        assert profile.atrial_mode is ContractionMode.ABSENT

    def test_a_conducted_patient_pumps_normally(self):
        assert PatientSpec().mechanical_profile.ventricular_mode is (
            ContractionMode.SYNCHRONOUS
        )


class TestTemplateIdentity:
    """El identificador ES la especificación: no hay registro que mantener."""

    def test_the_same_numbers_produce_the_same_identifier(self):
        first = PatientSpec(qrs_ms=110.0, qt_ms=430.0).ventricular_template_id
        second = PatientSpec(qrs_ms=110.0, qt_ms=430.0).ventricular_template_id
        assert first == second

    def test_the_identifier_survives_a_round_trip_through_text(self):
        """Un golden guarda ese texto y tiene que seguir significando lo
        mismo dentro de un año, en otro proceso."""
        spec = PatientSpec(qrs_ms=150.0, qt_ms=500.0, st_shift_mv=-0.3)
        template = get_template(spec.ventricular_template_id)
        assert qrs_duration_s(template) * 1000 == pytest.approx(150.0, abs=0.5)
        assert qt_duration_s(template) * 1000 == pytest.approx(500.0, abs=0.5)

    def test_an_unreadable_identifier_says_so(self):
        with pytest.raises(KeyError):
            get_template("custom:z;nada=1")


class TestClinicalBounds:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"pr_ms": 40.0},
            {"pr_ms": 900.0},
            {"qrs_ms": 20.0},
            {"qrs_ms": 400.0},
            {"qt_ms": 100.0},
            {"qt_ms": 1200.0},
            {"atrial_rate_bpm": 900.0},
            {"atrial_rate_bpm": -10.0},
            {"st_shift_mv": 5.0},
            {"conduction_ratio": 1},
        ],
    )
    def test_a_patient_outside_the_clinical_range_is_refused(self, kwargs):
        """Un paciente inventado puede estar todo lo enfermo que haga falta,
        pero sigue siendo un paciente."""
        with pytest.raises(ValueError):
            PatientSpec(**kwargs)
