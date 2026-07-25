import numpy as np
import pytest

from ecg_engine.catalog import RHYTHM_IDS, get_rhythm, list_rhythms
from ecg_engine.catalog.definitions import ParameterRange, RhythmCategory
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
    assert set(RHYTHM_IDS) == EXPECTED_IDS
    assert len(RHYTHM_IDS) == 12


def test_registry_keys_match_definition_ids():
    assert all(d.rhythm_id in EXPECTED_IDS for d in list_rhythms())


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
        pytest.skip("frecuencia estructural, declarada como fija")

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
def test_blocks_are_the_only_rhythms_where_command_and_pulse_differ(rhythm_id):
    """En todo lo que conduce 1:1, mando y pulso son el mismo número. Si
    empiezan a divergir en otro sitio, o el catálogo está mal o el ritmo no
    conduce como creemos."""
    definition = get_rhythm(rhythm_id)
    command_hz = definition.default_parameters["heart_rate_hz"]
    diverges = definition.ventricular_rate_hz != pytest.approx(command_hz)
    if rhythm_id in {"av_block_second_mobitz_i", "av_block_third"}:
        assert diverges
    else:
        assert not diverges


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
