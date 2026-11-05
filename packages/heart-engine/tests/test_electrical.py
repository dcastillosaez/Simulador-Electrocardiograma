"""La secuencia eléctrica, contra los ritmos reales del catálogo.

No se fabrican eventos a mano salvo donde hace falta aislar una regla: lo que
se comprueba es lo que va a recibir el cliente cuando el usuario elija un
ritmo, generado por las mismas fuentes que dibujan el trazado.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from ecg_engine.catalog import RHYTHM_IDS, get_rhythm
from ecg_engine.measurements import measure
from ecg_engine.patient import AvConduction, PatientSpec, build_patient_source
from ecg_engine.types import CardiacEvent, EventKind, ImpulseOrigin
from heart_engine import derive_electrical_impulses, load_activation_timing

TOLERANCE_S = 0.002
"""Los tiempos viajan redondeados a milisegundos; dos de holgura cubren el
redondeo de los dos extremos de un tramo."""

SAMPLE_RATE_HZ = 500


def source_for(rhythm_id: str, seed: int = 1):
    definition = get_rhythm(rhythm_id)
    return definition, definition.build_source(np.random.default_rng(seed))


def impulses_for(rhythm_id: str, t0: float = 0.0, t1: float = 10.0):
    definition, source = source_for(rhythm_id)
    if not hasattr(source, "events"):
        return definition, source, [], []
    events = source.events(t0, t1)
    impulses = derive_electrical_impulses(
        events,
        definition.mechanical_profile,
        atrial_origin=definition.atrial_origin,
        pairs_by_index=source.pairs_by_index,
        dissociated=source.is_dissociated,
    )
    return definition, source, events, impulses


def segments(impulse) -> dict[str, tuple[float, float]]:
    return {s.structure: (s.t_start_s, s.t_end_s) for s in impulse.segments}


def test_el_fichero_de_tiempos_declara_version_y_revision_pendiente():
    timing = load_activation_timing()
    assert timing.version >= 1
    assert timing.clinical_review == "pendiente"


@pytest.mark.parametrize(
    "rhythm_id", [r for r in RHYTHM_IDS if r not in ("ventricular_fibrillation",)]
)
def test_los_tramos_ventriculares_coinciden_con_las_ondas_medidas(rhythm_id):
    """El tramo del miocardio dura lo que mide `measure` como QRS, y del
    inicio del miocardio al final de la recuperación va el QT medido."""
    definition, source, events, impulses = impulses_for(rhythm_id)
    signal = source.render(0.0, 10 * SAMPLE_RATE_HZ, SAMPLE_RATE_HZ)
    measured = measure(events, signal, SAMPLE_RATE_HZ, definition.pr_is_measurable)

    ventricular = [i for i in impulses if "ventricular_myocardium" in segments(i)]
    assert ventricular, f"{rhythm_id}: ningún impulso llega al ventrículo"
    for impulse in ventricular:
        seg = segments(impulse)
        qrs_on, qrs_end = seg["ventricular_myocardium"]
        _, t_end = seg["ventricular_recovery"]
        if not math.isnan(measured.qrs_duration_s):
            assert qrs_end - qrs_on == pytest.approx(measured.qrs_duration_s, abs=TOLERANCE_S)
            assert t_end - qrs_on == pytest.approx(measured.qt_s, abs=TOLERANCE_S)
        if "his_bundle" in seg:
            # His-Purkinje termina exactamente donde empieza el QRS.
            assert seg["purkinje"][1] == pytest.approx(qrs_on, abs=1e-9)
            assert seg["bundle_branches"][1] == pytest.approx(qrs_on, abs=1e-9)
            assert seg["his_bundle"][1] == pytest.approx(seg["purkinje"][0], abs=1e-9)
        if "av_node" in seg and "his_bundle" in seg:
            assert seg["av_node"][1] == pytest.approx(seg["his_bundle"][0], abs=1e-9)


def test_un_paciente_con_qrs_de_140_ms_activa_el_miocardio_140_ms():
    spec = PatientSpec(qrs_ms=140.0)
    source = build_patient_source(spec, np.random.default_rng(1))
    impulses = derive_electrical_impulses(
        source.events(0.0, 5.0),
        spec.mechanical_profile,
        atrial_origin=spec.atrial_origin,
        pairs_by_index=source.pairs_by_index,
        dissociated=source.is_dissociated,
    )
    for impulse in impulses:
        start, end = segments(impulse)["ventricular_myocardium"]
        assert end - start == pytest.approx(0.140, abs=TOLERANCE_S)


def test_el_sinusal_recorre_toda_la_secuencia_en_orden():
    _, _, _, impulses = impulses_for("sinus_normal")
    order = [
        "sa_node",
        "right_atrium",
        "left_atrium",
        "av_node",
        "his_bundle",
        "bundle_branches",
        "purkinje",
        "ventricular_myocardium",
        "ventricular_recovery",
    ]
    timing = load_activation_timing()
    for impulse in impulses:
        assert impulse.origin is ImpulseOrigin.SINUS
        assert impulse.outcome == "conducted"
        seg = segments(impulse)
        assert list(seg) == order
        p_on, p_end = seg["right_atrium"]
        assert seg["sa_node"] == (p_on, p_on)
        assert seg["left_atrium"][0] == pytest.approx(p_on + timing.left_atrial_delay_s)
        assert seg["av_node"][0] == pytest.approx(p_end)
        his_on, his_end = seg["his_bundle"]
        qrs_on = seg["ventricular_myocardium"][0]
        assert qrs_on - his_on == pytest.approx(timing.hv_interval_s)
        assert qrs_on - his_end == pytest.approx(timing.left_bundle_to_ventricle_s)
        for start, end in seg.values():
            assert end >= start


def test_el_primer_grado_solo_alarga_el_nodo_av():
    _, _, _, normal = impulses_for("sinus_normal")
    _, _, _, first = impulses_for("av_block_first")
    duration = lambda imp, s: segments(imp)[s][1] - segments(imp)[s][0]  # noqa: E731
    assert duration(first[0], "av_node") > duration(normal[0], "av_node") + 0.05
    for structure in ("his_bundle", "bundle_branches", "purkinje"):
        assert duration(first[0], structure) == pytest.approx(duration(normal[0], structure))
    assert all(i.outcome == "conducted" for i in first)


def test_mobitz_i_alarga_el_av_y_el_caido_se_queda_en_el_nodo():
    _, _, _, impulses = impulses_for("av_block_second_mobitz_i")
    blocked = [i for i in impulses if i.outcome == "blocked"]
    assert blocked
    for impulse in blocked:
        seg = segments(impulse)
        assert "his_bundle" not in seg and "ventricular_myocardium" not in seg
        assert seg["av_node"][0] == seg["av_node"][1]
    # Dentro de un ciclo, el tramo AV crece latido a latido hasta la caída.
    conducted = [i for i in impulses if i.outcome == "conducted"]
    by_cycle: dict[int, list[float]] = {}
    for impulse in conducted:
        start, end = segments(impulse)["av_node"]
        by_cycle.setdefault(impulse.impulse // 4, []).append(end - start)
    grew = [values for values in by_cycle.values() if len(values) >= 2]
    assert grew
    for values in grew:
        assert values == sorted(values) and values[-1] > values[0]


@pytest.mark.parametrize("rhythm_id", ["av_block_third", "ventricular_tachycardia"])
def test_en_una_disociacion_ningun_impulso_cruza_el_nodo_av(rhythm_id):
    _, _, _, impulses = impulses_for(rhythm_id)
    atrial = [i for i in impulses if i.origin is not ImpulseOrigin.VENTRICULAR]
    ventricular = [i for i in impulses if i.origin is ImpulseOrigin.VENTRICULAR]
    assert atrial and ventricular
    for impulse in atrial:
        assert impulse.outcome == "blocked"
        assert "his_bundle" not in segments(impulse)
    for impulse in ventricular:
        seg = segments(impulse)
        assert "his_bundle" not in seg and "av_node" not in seg
        assert "ventricular_myocardium" in seg


def test_la_tsv_no_enciende_el_nodo_sinusal():
    _, _, _, impulses = impulses_for("svt")
    assert impulses
    for impulse in impulses:
        assert impulse.origin is ImpulseOrigin.SUPRAVENTRICULAR
        assert "sa_node" not in segments(impulse)


def test_la_fa_solo_tiene_impulsos_ventriculares_que_cruzan_el_nodo():
    _, _, events, impulses = impulses_for("atrial_fibrillation")
    assert any(e.kind is EventKind.ATRIAL for e in events)
    assert impulses
    for impulse in impulses:
        seg = segments(impulse)
        assert impulse.origin is ImpulseOrigin.SUPRAVENTRICULAR
        assert "right_atrium" not in seg  # la aurícula la describe heart_state
        assert "av_node" not in seg  # no hay una onda f concreta que conduzca
        assert "his_bundle" in seg


def test_el_flutter_conduce_por_el_nodo_desde_la_onda_que_pasa():
    _, _, _, impulses = impulses_for("atrial_flutter")
    assert impulses
    for impulse in impulses:
        seg = segments(impulse)
        assert impulse.origin is ImpulseOrigin.SUPRAVENTRICULAR
        assert "right_atrium" not in seg
        assert "av_node" in seg and "his_bundle" in seg


def test_la_fibrilacion_ventricular_no_tiene_impulsos():
    definition, source = source_for("ventricular_fibrillation")
    assert not hasattr(source, "events")


@pytest.mark.parametrize("rhythm_id", ["sinus_normal", "av_block_second_mobitz_i", "atrial_fibrillation", "av_block_third"])
def test_generar_de_una_vez_o_a_trozos_da_los_mismos_impulsos(rhythm_id):
    """10 s de una vez y en trozos de 100 ms. La API publica por ventanas, y
    el cliente tiene que recibir exactamente los mismos impulsos."""
    definition = get_rhythm(rhythm_id)

    def run(step: float):
        source = definition.build_source(np.random.default_rng(3))
        out = []
        t = 0.0
        while t < 10.0 - 1e-9:
            end = min(10.0, t + step)
            out.extend(
                derive_electrical_impulses(
                    source.events(t, end),
                    definition.mechanical_profile,
                    atrial_origin=definition.atrial_origin,
                    pairs_by_index=source.pairs_by_index,
                    dissociated=source.is_dissociated,
                )
            )
            t = end
        return sorted(
            (i.origin.value, i.impulse, tuple((s.structure, round(s.t_start_s, 6), round(s.t_end_s, 6)) for s in i.segments))
            for i in out
        )

    assert run(10.0) == run(0.1)


def test_un_pr_muy_corto_comprime_his_purkinje_sin_adelantar_el_nodo_av(caplog):
    spec = PatientSpec(pr_ms=80.0)
    source = build_patient_source(spec, np.random.default_rng(1))
    impulses = derive_electrical_impulses(
        source.events(0.0, 3.0),
        spec.mechanical_profile,
        atrial_origin=spec.atrial_origin,
        pairs_by_index=source.pairs_by_index,
    )
    for impulse in impulses:
        seg = segments(impulse)
        assert seg["av_node"][0] == pytest.approx(seg["right_atrium"][1])
        assert seg["av_node"][1] >= seg["av_node"][0]
        assert seg["his_bundle"][0] >= seg["right_atrium"][1] - 1e-9


def test_un_paciente_sin_aurícula_late_solo_desde_el_ventriculo():
    spec = PatientSpec(atrial_rate_bpm=0.0, escape_rate_bpm=40.0)
    source = build_patient_source(spec, np.random.default_rng(1))
    impulses = derive_electrical_impulses(
        source.events(0.0, 5.0),
        spec.mechanical_profile,
        atrial_origin=spec.atrial_origin,
        pairs_by_index=source.pairs_by_index,
        dissociated=source.is_dissociated,
    )
    assert impulses
    assert all(i.origin is ImpulseOrigin.VENTRICULAR for i in impulses)


def test_un_paciente_supraventricular_no_enciende_el_nodo_sinusal():
    spec = PatientSpec(atrial_origin=ImpulseOrigin.SUPRAVENTRICULAR)
    source = build_patient_source(spec, np.random.default_rng(1))
    impulses = derive_electrical_impulses(
        source.events(0.0, 3.0),
        spec.mechanical_profile,
        atrial_origin=spec.atrial_origin,
        pairs_by_index=source.pairs_by_index,
    )
    assert impulses and all("sa_node" not in segments(i) for i in impulses)


def test_el_payload_redondea_a_milisegundos():
    _, _, _, impulses = impulses_for("sinus_normal")
    payload = impulses[0].as_payload()
    assert set(payload) == {"impulse", "origin", "outcome", "segments"}
    for segment in payload["segments"]:
        assert segment["t_start_s"] == round(segment["t_start_s"], 3)
