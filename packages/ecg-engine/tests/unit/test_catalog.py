import math

import numpy as np
import pytest

from ecg_engine import EcgEngine, EngineParams
from ecg_engine.catalog import RHYTHM_IDS, get_rhythm, list_rhythms
from ecg_engine.catalog.definitions import (
    CUSTOM_PATIENT_ID,
    ParameterRange,
    RhythmCategory,
)
from ecg_engine.measurements import measure
from ecg_engine.types import N_LEADS, EventKind

EXPECTED_IDS = {
    "sinus_normal",
    "sinus_tachycardia",
    "sinus_bradycardia",
    "atrial_fibrillation",
    "atrial_flutter",
    "svt",
    "ventricular_tachycardia",
    "ventricular_fibrillation",
    "av_block_first",
    "av_block_second_mobitz_i",
    "av_block_third",
    "stemi_inferior",
}


def test_catalog_contains_exactly_the_twelve_mvp_rhythms():
    """Los doce hallazgos clínicos siguen siendo doce.

    El paciente personalizado se cuenta aparte a propósito. No es un ritmo:
    es un hueco que rellena el usuario, sin descripción clínica auditable ni
    referencia que lo respalde, y confundirlo con el catálogo revisado sería
    exactamente el error que este test existe para impedir.
    """
    assert set(RHYTHM_IDS) - {CUSTOM_PATIENT_ID} == EXPECTED_IDS
    assert len(EXPECTED_IDS) == 12


def test_the_custom_patient_is_offered_alongside_the_catalogue():
    assert CUSTOM_PATIENT_ID in RHYTHM_IDS
    assert get_rhythm(CUSTOM_PATIENT_ID).category is RhythmCategory.CUSTOM


def test_registry_keys_match_definition_ids():
    known = EXPECTED_IDS | {CUSTOM_PATIENT_ID}
    assert all(d.rhythm_id in known for d in list_rhythms())


def test_unknown_rhythm_raises_with_a_helpful_message():
    with pytest.raises(KeyError, match="taquicardia_rara"):
        get_rhythm("taquicardia_rara")


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_declares_its_full_contract(rhythm_id):
    definition = get_rhythm(rhythm_id)
    assert definition.display_name
    assert isinstance(definition.category, RhythmCategory)
    assert definition.clinical_description
    assert definition.references, f"{rhythm_id} debe citar al menos una fuente"
    assert "heart_rate_hz" in definition.editable_parameters


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_renders_twelve_leads(rhythm_id):
    source = get_rhythm(rhythm_id).build_source(np.random.default_rng(20260725))
    signal = source.render(0.0, 2500, 500)
    assert signal.shape == (N_LEADS, 2500)
    assert np.isfinite(signal).all()


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_produces_a_non_flat_trace(rhythm_id):
    source = get_rhythm(rhythm_id).build_source(np.random.default_rng(1))
    signal = source.render(0.0, 2500, 500)
    assert np.abs(signal).max() > 0.0001


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_is_deterministic_for_a_given_seed(rhythm_id):
    first = get_rhythm(rhythm_id).build_source(np.random.default_rng(8))
    second = get_rhythm(rhythm_id).build_source(np.random.default_rng(8))
    assert np.array_equal(first.render(0.0, 1500, 500), second.render(0.0, 1500, 500))


def test_default_rates_are_clinically_correct():
    """Cada ritmo debe nacer en su rango clínico, no en uno genérico."""
    assert get_rhythm("sinus_normal").default_parameters["heart_rate_hz"] == (
        pytest.approx(70 / 60)
    )
    assert get_rhythm("sinus_bradycardia").default_parameters["heart_rate_hz"] < (
        60 / 60
    )
    assert get_rhythm("sinus_tachycardia").default_parameters["heart_rate_hz"] > (
        100 / 60
    )
    assert get_rhythm("svt").default_parameters["heart_rate_hz"] > 150 / 60


def test_editable_rate_ranges_are_bounded_by_physiology():
    """Nadie debe poder poner una bradicardia a 200 lpm desde la interfaz."""
    brady = get_rhythm("sinus_bradycardia").editable_parameters["heart_rate_hz"]
    assert brady.maximum <= 60 / 60
    tachy = get_rhythm("sinus_tachycardia").editable_parameters["heart_rate_hz"]
    assert tachy.minimum >= 100 / 60


def test_parameter_range_clamps_out_of_range_values():
    r = ParameterRange(minimum=1.0, maximum=2.0, default=1.5)
    assert r.clamp(0.0) == 1.0
    assert r.clamp(3.0) == 2.0
    assert r.clamp(1.7) == 1.7


def test_parameter_range_rejects_an_out_of_bounds_default():
    with pytest.raises(ValueError, match="default"):
        ParameterRange(minimum=1.0, maximum=2.0, default=5.0)


def test_only_stemi_declares_the_st_elevation_overlay():
    """El IAM no es un ritmo nuevo: es sinusal más un overlay."""
    assert get_rhythm("stemi_inferior").allowed_overlays == ("st_elevation_inferior",)
    others = [d for d in list_rhythms() if d.rhythm_id != "stemi_inferior"]
    assert all(d.allowed_overlays == () for d in others)


def test_ventricular_fibrillation_exposes_no_rate_control():
    """La FV no tiene frecuencia cardíaca; el catálogo no debe fingir que sí."""
    definition = get_rhythm("ventricular_fibrillation")
    assert definition.category is RhythmCategory.VENTRICULAR
    rate_range = definition.editable_parameters["heart_rate_hz"]
    assert rate_range.minimum == rate_range.maximum


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_editable_rate_actually_changes_the_ventricular_rate(rhythm_id):
    """Coherencia entre lo que el catálogo promete y lo que el motor hace.

    Si un rango es editable, mover la frecuencia tiene que notarse. Si no se
    nota, el rango debe declararse fijo. Un deslizante que no hace nada es
    peor que un control deshabilitado.
    """
    definition = get_rhythm(rhythm_id)
    rate_range = definition.editable_parameters["heart_rate_hz"]
    source = definition.build_source(np.random.default_rng(5))

    if rate_range.minimum == rate_range.maximum:
        # Frecuencia no gobernable por el mando genérico. Si el ritmo tiene
        # mandos propios, son ellos los que deben moverla: eso lo comprueba
        # `TestRhythmParameters`, no este test.
        pytest.skip("frecuencia estructural o derivada de los mandos del ritmo")

    def ventricular_count() -> int:
        events = source.events(0.0, 60.0)
        return len([e for e in events if e.kind is EventKind.VENTRICULAR])

    source.set_rate_hz(rate_range.minimum)
    slow = ventricular_count()
    source.set_rate_hz(rate_range.maximum)
    fast = len(
        [e for e in source.events(60.0, 120.0) if e.kind is EventKind.VENTRICULAR]
    )
    assert fast > slow


def test_third_degree_block_produces_dissociated_trains():
    source = get_rhythm("av_block_third").build_source(np.random.default_rng(3))
    events = source.events(0.0, 60.0)
    atrial = len([e for e in events if e.kind is EventKind.ATRIAL])
    ventricular = len([e for e in events if e.kind is EventKind.VENTRICULAR])
    assert atrial > ventricular * 1.5


def test_atrial_fibrillation_has_irregular_rr():
    source = get_rhythm("atrial_fibrillation").build_source(np.random.default_rng(3))
    events = source.events(0.0, 120.0)
    ventricular = [e.t_s for e in events if e.kind is EventKind.VENTRICULAR]
    rr = np.diff(ventricular)
    assert rr.std() > 0.08


def test_flutter_conducts_a_fraction_of_its_atrial_waves():
    source = get_rhythm("atrial_flutter").build_source(np.random.default_rng(3))
    events = source.events(0.0, 60.0)
    atrial = len([e for e in events if e.kind is EventKind.ATRIAL])
    ventricular = len([e for e in events if e.kind is EventKind.VENTRICULAR])
    assert atrial / ventricular == pytest.approx(2.0, rel=0.15)


@pytest.mark.parametrize(
    "rhythm_id", sorted(EXPECTED_IDS - {"ventricular_fibrillation"})
)
def test_declared_pulse_matches_the_signal(rhythm_id):
    """`ventricular_rate_hz` es lo que una interfaz mostrará como frecuencia
    cardíaca, y la frecuencia cardíaca de un paciente es la de sus
    ventrículos. En el bloqueo AV completo eso son los 40 lpm del escape, no
    los 75 de unas aurículas que no conducen; en un Mobitz I son los 56 que
    quedan tras caer una P de cada cuatro."""
    definition = get_rhythm(rhythm_id)
    source = definition.build_source(np.random.default_rng(20260725))
    events = source.events(0.0, 120.0)
    ventricular = len([e for e in events if e.kind is EventKind.VENTRICULAR])
    assert ventricular / 120.0 == pytest.approx(
        definition.ventricular_rate_hz, rel=0.08
    )


def test_fibrillation_declares_no_measurable_pulse():
    """La fibrilación ventricular no tiene pulso: no hay contracción eficaz."""
    assert get_rhythm("ventricular_fibrillation").ventricular_rate_hz == 0.0


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_only_wenckebach_keeps_a_command_that_is_not_the_pulse(rhythm_id):
    """`heart_rate_hz` es el pulso ventricular en todo el catálogo menos uno.

    El Mobitz I es la excepción que queda: su mando es la frecuencia sinusal
    —que es lo que un fármaco mueve— y el pulso sale de ahí tras caer una P
    de cada cuatro. En el bloqueo completo ya no hay excepción: desde que
    tiene mandos propios, su sinusal se gobierna con `atrial_rate_hz` y
    `heart_rate_hz` vale lo que vale el escape, que es el pulso del paciente.
    """
    definition = get_rhythm(rhythm_id)
    command_hz = definition.default_parameters["heart_rate_hz"]
    diverges = definition.ventricular_rate_hz != pytest.approx(command_hz)
    if rhythm_id == "av_block_second_mobitz_i":
        assert diverges
    else:
        assert not diverges


@pytest.mark.parametrize(
    "rhythm_id",
    ["atrial_fibrillation", "atrial_flutter", "ventricular_tachycardia",
     "ventricular_fibrillation", "av_block_third"],
)
def test_rhythms_without_a_pr_declare_it(rhythm_id):
    """En estos cinco ritmos no existe intervalo PR. En la FA no hay onda P
    que medir, en el flutter la relación F-QRS no es lo que nadie llama PR,
    y en la TV y el bloqueo completo las aurículas van disociadas."""
    assert not get_rhythm(rhythm_id).pr_is_measurable


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_declared_pr_matches_what_the_measurement_reports(rhythm_id):
    """Coherencia entre lo que el catálogo declara y lo que sale medido. Un
    ritmo que declara no tener PR no puede publicar un número, y uno que
    declara tenerlo no puede publicar NaN."""
    definition = get_rhythm(rhythm_id)
    source = definition.build_source(np.random.default_rng(20260725))
    events = source.events(0.0, 30.0) if hasattr(source, "events") else []
    result = measure(
        events, source.render(0.0, 15000, 500), 500, definition.pr_is_measurable
    )
    assert math.isnan(result.pr_mean_s) != definition.pr_is_measurable


def test_ventricular_tachycardia_is_genuinely_dissociated():
    """El hallazgo que distingue una TV de una supraventricular con
    aberrancia. Con ambos trenes a la misma frecuencia la P caía sobre el
    pico de la R, le sumaba amplitud y daba un PR de 0 ms: sincronía
    perfecta donde la descripción promete disociación."""
    source = get_rhythm("ventricular_tachycardia").build_source(
        np.random.default_rng(20260725)
    )
    events = source.events(0.0, 30.0)
    atrial = [e.t_s for e in events if e.kind is EventKind.ATRIAL]
    ventricular = [e.t_s for e in events if e.kind is EventKind.VENTRICULAR]

    assert len(ventricular) > len(atrial) * 2  # el ventrículo va mucho más rápido

    # Ninguna P puede caer sistemáticamente sobre un QRS.
    closest = [min(abs(v - a) for v in ventricular) for a in atrial]
    assert max(closest) > 0.05


def test_fibrillation_waves_are_irregular_unlike_flutter():
    """Lo que separa una FA de un flutter en el papel no es solo el RR: es la
    línea de base. El flutter dibuja dientes de sierra a intervalo constante;
    la FA, una ondulación que llega a destiempo. Con un tren regular las dos
    salían idénticas salvo por la frecuencia."""
    def atrial_intervals(rhythm_id):
        source = get_rhythm(rhythm_id).build_source(np.random.default_rng(7))
        times = [
            e.t_s for e in source.events(0.0, 20.0) if e.kind is EventKind.ATRIAL
        ]
        return np.diff(times)

    flutter = atrial_intervals("atrial_flutter")
    fibrillation = atrial_intervals("atrial_fibrillation")

    assert flutter.std() < 1e-9                      # metrónomo
    assert fibrillation.std() > 0.2 * fibrillation.mean()   # genuinamente irregular


def test_fibrillation_waves_are_smaller_than_flutter_waves():
    """Las ondas f de la FA son de bajo voltaje; las F del flutter, amplias y
    puntiagudas. Compartir plantilla las hacía indistinguibles."""
    from ecg_engine.beat import get_template

    f_wave = get_template("af_f").components[0]
    flutter_wave = get_template("flutter_f").components[0]
    assert abs(f_wave.amplitude_v) < abs(flutter_wave.amplitude_v) / 2


def test_every_rhythm_exposes_the_axis_ranges():
    for definition in list_rhythms():
        editable = definition.editable_parameters
        for name in (
            "orientation_deg",
            "p_offset_deg",
            "qrs_offset_deg",
            "st_offset_deg",
            "t_offset_deg",
        ):
            assert name in editable, f"{definition.rhythm_id} sin {name}"


def test_axis_ranges_match_the_design_limits():
    editable = get_rhythm("sinus_normal").editable_parameters
    assert (editable["orientation_deg"].minimum, editable["orientation_deg"].maximum) == (-180.0, 180.0)
    assert (editable["qrs_offset_deg"].minimum, editable["qrs_offset_deg"].maximum) == (-90.0, 90.0)
    assert (editable["p_offset_deg"].minimum, editable["p_offset_deg"].maximum) == (-45.0, 45.0)
    assert editable["orientation_deg"].default == 50.0


def test_no_rhythm_specific_branching_in_the_engine():
    """Principio arquitectónico 3: cero casos especiales por ritmo.

    Este test es una red de seguridad barata contra la tentación de meter
    un `if rhythm_id == ...` cuando algún ritmo se resista.
    """
    import pathlib

    import ecg_engine

    root = pathlib.Path(ecg_engine.__file__).parent
    offenders = []
    for path in root.rglob("*.py"):
        if path.parent.name == "catalog":
            continue
        source = path.read_text(encoding="utf-8")
        for rhythm_id in RHYTHM_IDS:
            if f'"{rhythm_id}"' in source or f"'{rhythm_id}'" in source:
                offenders.append(f"{path.name}: {rhythm_id}")
    assert offenders == []


class TestRhythmParameters:
    """Los mandos propios de un ritmo, para lo que no cabe en una frecuencia.

    Antes de esto, el flutter, la taquicardia ventricular y el bloqueo
    completo declaraban su frecuencia como fija y la interfaz enseñaba «150
    lpm (fija)». Era cierto en el programa —sus trenes ignoraban el mando— y
    falso en la clínica: un flutter conduce 2:1, 3:1 o 4:1, una TV va de 100 a
    250 y un escape de 20 a 45.
    """

    def _measured(self, rhythm_id: str, rhythm: dict, seconds: float = 60.0):
        engine = EcgEngine(
            rhythm_id=rhythm_id, seed=20260725, params=EngineParams(rhythm=rhythm)
        )
        engine.generate(int(seconds * 500))
        events = engine.source.events(0.0, seconds)
        atrial = len([e for e in events if e.kind is EventKind.ATRIAL]) / seconds
        ventricular = (
            len([e for e in events if e.kind is EventKind.VENTRICULAR]) / seconds
        )
        return atrial * 60, ventricular * 60, engine.params.heart_rate_hz * 60

    def test_only_three_rhythms_declare_their_own_controls(self):
        with_controls = {
            d.rhythm_id for d in list_rhythms() if d.rhythm_parameters
        }
        assert with_controls == {
            "atrial_flutter",
            "ventricular_tachycardia",
            "av_block_third",
        }

    @pytest.mark.parametrize("ratio", [2, 3, 4])
    def test_the_flutter_conducts_the_ratio_it_is_given(self, ratio):
        atrial, ventricular, _ = self._measured(
            "atrial_flutter",
            {"atrial_rate_hz": 300 / 60, "conduction_ratio": ratio},
        )
        assert atrial == pytest.approx(300, rel=0.05)
        assert ventricular == pytest.approx(300 / ratio, rel=0.06)

    def test_the_flutter_atrium_can_be_moved_within_its_range(self):
        slow, _, _ = self._measured("atrial_flutter", {"atrial_rate_hz": 250 / 60})
        fast, _, _ = self._measured("atrial_flutter", {"atrial_rate_hz": 350 / 60})
        assert slow == pytest.approx(250, rel=0.05)
        assert fast == pytest.approx(350, rel=0.05)

    def test_the_pulse_of_a_flutter_is_the_quotient_of_its_two_controls(self):
        """Lo que la interfaz enseña como frecuencia cardíaca no es ninguno de
        los dos mandos: es su cociente. Un 4:1 sobre 320 son 80 lpm."""
        _, ventricular, command = self._measured(
            "atrial_flutter",
            {"atrial_rate_hz": 320 / 60, "conduction_ratio": 4},
        )
        assert command == pytest.approx(80.0, rel=0.01)
        assert ventricular == pytest.approx(command, rel=0.06)

    @pytest.mark.parametrize("rate", [100, 180, 250])
    def test_the_ventricular_focus_beats_at_what_it_is_told(self, rate):
        _, ventricular, command = self._measured(
            "ventricular_tachycardia", {"ventricular_rate_hz": rate / 60}
        )
        assert ventricular == pytest.approx(rate, rel=0.06)
        assert command == pytest.approx(rate, rel=0.01)

    def test_a_complete_block_moves_its_two_pacemakers_apart(self):
        atrial, ventricular, command = self._measured(
            "av_block_third",
            {"atrial_rate_hz": 90 / 60, "escape_rate_hz": 28 / 60},
        )
        assert atrial == pytest.approx(90, rel=0.06)
        assert ventricular == pytest.approx(28, rel=0.06)
        # El pulso del paciente es el escape, no la sinusal.
        assert command == pytest.approx(28, rel=0.01)

    def test_moving_the_sinus_node_does_not_touch_the_escape(self):
        """Es lo que significa «disociado»: dos relojes que no se hablan."""
        _, slow_escape, _ = self._measured(
            "av_block_third", {"atrial_rate_hz": 60 / 60, "escape_rate_hz": 40 / 60}
        )
        _, fast_escape, _ = self._measured(
            "av_block_third", {"atrial_rate_hz": 100 / 60, "escape_rate_hz": 40 / 60}
        )
        assert slow_escape == pytest.approx(fast_escape, rel=0.06)

    def test_values_outside_the_clinical_range_are_clipped(self):
        atrial, ventricular, _ = self._measured(
            "atrial_flutter",
            {"atrial_rate_hz": 900 / 60, "conduction_ratio": 9},
        )
        assert atrial == pytest.approx(350, rel=0.05)  # el techo del flutter
        assert ventricular == pytest.approx(350 / 4, rel=0.08)  # el 4:1 máximo

    def test_a_control_that_does_not_exist_in_this_rhythm_is_ignored(self):
        """Un `conduction_ratio` en un ritmo sinusal no significa nada.
        Guardarlo lo dejaría en la fila de la sesión como si hubiera hecho
        algo, y un replay lo leería como si lo hubiera hecho."""
        engine = EcgEngine(
            rhythm_id="sinus_normal",
            seed=1,
            params=EngineParams(rhythm={"conduction_ratio": 3}),
        )
        assert dict(engine.params.rhythm) == {}

    def test_changing_a_control_rebuilds_the_source_in_place(self):
        """El reloj no se toca: el trazado sigue avanzando donde iba."""
        engine = EcgEngine(rhythm_id="atrial_flutter", seed=4)
        engine.generate(2500)
        before_s = engine.t_s
        engine.update_params(
            EngineParams(rhythm={"atrial_rate_hz": 300 / 60, "conduction_ratio": 4})
        )
        assert engine.t_s == pytest.approx(before_s)
        assert engine.params.heart_rate_hz * 60 == pytest.approx(75.0, rel=0.01)
