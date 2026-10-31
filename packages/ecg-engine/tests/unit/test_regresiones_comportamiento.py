"""Fallos de comportamiento que los tests existentes no veían.

Cada uno pasaba sin error: el motor generaba señal plausible, y el fallo solo
se veía comparando lo generado con lo que el ritmo promete.
"""

import math

import numpy as np
import pytest

from ecg_engine import AvConduction, EcgEngine, EngineParams, PatientSpec, get_rhythm
from ecg_engine.measurements import DISSOCIATED, av_relationship, measure
from ecg_engine.patient import build_patient_source
from ecg_engine.types import N_LEADS, CardiacEvent, EventKind


def _count(engine: EcgEngine, kind: EventKind, duration_s: float) -> int:
    return sum(e.kind is kind for e in engine.source.events(0.0, duration_s))


def _chunked_vs_whole(rhythm_id: str, params: EngineParams | None) -> float:
    whole = EcgEngine(rhythm_id, seed=1, params=params).generate(4000)
    chunked_engine = EcgEngine(rhythm_id, seed=1, params=params)
    chunked = np.concatenate([chunked_engine.generate(50) for _ in range(80)], axis=1)
    return float(np.abs(whole - chunked).max())


def test_mandar_la_respuesta_ventricular_no_frena_las_ondas_f():
    """El mando de una FA es del nodo AV: las ondas f siguen a 420 por minuto."""
    engine = EcgEngine("atrial_fibrillation", seed=1)
    engine.generate(5000)
    f_waves_per_min = _count(engine, EventKind.ATRIAL, 10.0) * 6
    assert f_waves_per_min == pytest.approx(420, rel=0.15)


@pytest.mark.parametrize("bpm", [50, 80, 120, 180])
def test_la_respuesta_ventricular_de_una_fa_es_la_mandada(bpm):
    engine = EcgEngine(
        "atrial_fibrillation", seed=1, params=EngineParams(heart_rate_hz=bpm / 60)
    )
    engine.generate(500 * 120)
    beats = [
        e.t_s
        for e in engine.source.events(0.0, 120.0)
        if e.kind is EventKind.VENTRICULAR
    ]
    assert 60.0 / float(np.diff(beats).mean()) == pytest.approx(bpm, rel=0.03)


@pytest.mark.parametrize(
    ("rhythm_id", "params"),
    [
        ("av_block_first", None),
        ("av_block_second_mobitz_i", None),
        ("custom_patient", EngineParams(patient=PatientSpec(pr_ms=400, qt_ms=600))),
        ("custom_patient", EngineParams(patient=PatientSpec(pr_ms=600, qt_ms=700))),
        (
            "custom_patient",
            EngineParams(
                patient=PatientSpec(
                    atrial_rate_bpm=60,
                    av_conduction=AvConduction.WENCKEBACH,
                    wenckebach_cycle=6,
                    wenckebach_increment_ms=100,
                    pr_ms=300,
                    qt_ms=600,
                )
            ),
        ),
        (
            "custom_patient",
            EngineParams(
                patient=PatientSpec(
                    atrial_rate_bpm=0, escape_rate_bpm=30, qt_ms=700, qrs_ms=140
                )
            ),
        ),
    ],
)
def test_un_pr_largo_no_corta_la_t_en_la_frontera_de_trozo(rhythm_id, params):
    """El streaming pide 100 ms cada vez: tiene que dar lo mismo que de golpe."""
    assert _chunked_vs_whole(rhythm_id, params) < 1e-9


def test_un_latido_en_una_ventana_corta_no_es_una_frecuencia():
    event = CardiacEvent(
        kind=EventKind.VENTRICULAR, t_s=0.05, template_id="normal_qrst", index=0
    )
    result = measure([event], np.zeros((N_LEADS, 50)), 500)
    assert math.isnan(result.ventricular_rate_hz)


def test_quien_conoce_la_conduccion_decide_la_disociacion():
    """Dos relojes regulares a 75 y 150 repiten la distancia P-QRS cada dos
    latidos: mirando solo los eventos, parecen una conducción periódica."""
    atrial = [
        CardiacEvent(EventKind.ATRIAL, t_s=i * 0.8, template_id="sinus_p", index=i)
        for i in range(12)
    ]
    ventricular = [
        CardiacEvent(
            EventKind.VENTRICULAR, t_s=0.13 + i * 0.4, template_id="wide_qrst", index=i
        )
        for i in range(24)
    ]
    events = atrial + ventricular
    assert av_relationship(events, 1.25, 2.5) == "1:2"
    assert av_relationship(events, 1.25, 2.5, dissociated=True) == DISSOCIATED


def test_la_fuente_sabe_si_esta_disociada():
    complete = PatientSpec(av_conduction=AvConduction.COMPLETE_BLOCK)
    rng = np.random.default_rng(0)
    assert build_patient_source(complete, rng).is_dissociated
    assert not build_patient_source(PatientSpec(), rng).is_dissociated


@pytest.mark.parametrize(
    ("spec", "fragment"),
    [
        (PatientSpec(st_shift_mv=0.05), "st=0.05"),
        (PatientSpec(t_amplitude_scale=0.25), "t=0.25"),
    ],
)
def test_la_plantilla_conserva_la_amplitud_pedida(spec, fragment):
    assert fragment in spec.ventricular_template_id


def test_la_plantilla_conserva_la_amplitud_de_la_p():
    assert PatientSpec(p_amplitude_scale=0.25).atrial_template_id.endswith("p=0.25")


def test_el_grado_de_bloqueo_es_entero():
    """La fuente solo deja pasar una de cada n: el pulso publicado tiene que
    salir de ese mismo número."""
    engine = EcgEngine(
        "atrial_flutter", seed=1, params=EngineParams(rhythm={"conduction_ratio": 2.4})
    )
    engine.generate(5000)
    assert engine.params.rhythm["conduction_ratio"] == 2.0
    assert get_rhythm("atrial_flutter").rhythm_parameters["conduction_ratio"].integer
    assert engine.params.heart_rate_hz * 60 == pytest.approx(150)
