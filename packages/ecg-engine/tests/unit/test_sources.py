import numpy as np
import pytest

from ecg_engine.conduction import CompleteBlock, FixedPR, IrregularConduction
from ecg_engine.rhythm import EventTrain, RegularTrain
from ecg_engine.sources import BeatBasedSource, VentricularFibrillationSource
from ecg_engine.types import (
    LEAD_ORDER,
    N_LEADS,
    EventKind,
    VariabilityParams,
)


def sinus_source(seed: int = 20260725) -> BeatBasedSource:
    return BeatBasedSource(
        atrial=EventTrain(
            kind=EventKind.ATRIAL,
            template_id="sinus_p",
            rate_hz=70 / 60,
            variability=VariabilityParams(),
            rng=np.random.default_rng(seed),
        ),
        conduction=FixedPR(pr_s=0.16),
    )


def complete_block_source() -> BeatBasedSource:
    return BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="sinus_p", rate_hz=75 / 60
        ),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR, template_id="escape_qrst", rate_hz=40 / 60
        ),
    )


def test_source_emits_both_atrial_and_ventricular_events():
    events = sinus_source().events(0.0, 10.0)
    kinds = {e.kind for e in events}
    assert kinds == {EventKind.ATRIAL, EventKind.VENTRICULAR}


def test_events_come_back_sorted_in_time():
    times = [e.t_s for e in sinus_source().events(0.0, 20.0)]
    assert times == sorted(times)


def test_every_p_is_followed_by_its_qrs_in_sinus_rhythm():
    events = sinus_source().events(0.0, 20.0)
    atrial = [e for e in events if e.kind is EventKind.ATRIAL]
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    assert abs(len(atrial) - len(ventricular)) <= 1


def test_complete_block_produces_independent_atrial_and_ventricular_rates():
    """BAV de tercer grado: aurícula a 75, ventrículo a 40, sin relación."""
    events = complete_block_source().events(0.0, 60.0)
    atrial = [e for e in events if e.kind is EventKind.ATRIAL]
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    assert len(atrial) / 60.0 == pytest.approx(75 / 60, rel=0.05)
    assert len(ventricular) / 60.0 == pytest.approx(40 / 60, rel=0.05)


def test_complete_block_pr_intervals_are_not_constant():
    """Si el PR fuera constante habría conducción, y en el BAV completo no
    la hay. Es la comprobación que distingue un bloqueo real de uno falso."""
    events = complete_block_source().events(0.0, 60.0)
    atrial = np.array([e.t_s for e in events if e.kind is EventKind.ATRIAL])
    ventricular = [e.t_s for e in events if e.kind is EventKind.VENTRICULAR]
    intervals = [
        qrs - atrial[atrial <= qrs][-1] for qrs in ventricular if (atrial <= qrs).any()
    ]
    assert np.std(intervals) > 0.1


def test_render_returns_twelve_leads_of_the_requested_length():
    signal = sinus_source().render(0.0, 500, 500)
    assert signal.shape == (N_LEADS, 500)
    assert signal.dtype == np.float64


def test_render_is_continuous_across_chunk_boundaries():
    """Sin el margen de render aparecería un escalón en cada frontera."""
    source = sinus_source()
    whole = source.render(0.0, 1000, 500)
    first = source.render(0.0, 500, 500)
    second = source.render(1.0, 500, 500)
    assert np.allclose(whole[:, :500], first)
    assert np.allclose(whole[:, 500:], second, atol=1e-12)


def test_render_includes_contributions_from_beats_before_the_window():
    """Una T de un latido anterior debe seguir presente al inicio de la
    ventana; si no, el margen no se está aplicando."""
    source = sinus_source()
    late = source.render(9.0, 250, 500)
    assert np.abs(late).max() > 0.0


def test_set_rate_changes_the_ventricular_rate():
    source = sinus_source()
    slow = source.events(0.0, 30.0)
    source.set_rate_hz(140 / 60)
    fast = source.events(30.0, 60.0)
    slow_count = len([e for e in slow if e.kind is EventKind.VENTRICULAR])
    fast_count = len([e for e in fast if e.kind is EventKind.VENTRICULAR])
    assert fast_count > 1.5 * slow_count


def test_two_sources_with_the_same_seed_render_identically():
    assert np.array_equal(
        sinus_source(seed=99).render(0.0, 2000, 500),
        sinus_source(seed=99).render(0.0, 2000, 500),
    )


def test_ventricular_fibrillation_has_no_discrete_events():
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(1),
    )
    assert not hasattr(source, "events")


def test_ventricular_fibrillation_implements_the_common_render_interface():
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(1),
    )
    signal = source.render(0.0, 2500, 500)
    assert signal.shape == (N_LEADS, 2500)


def test_ventricular_fibrillation_is_continuous_across_chunks():
    """La normalización de la FV es una constante fijada al construir. Si
    alguien la midiera dentro de `render`, cada trozo tendría su propio
    factor de escala y el trazo saltaría en cada frontera. Ningún otro test
    lo vería: la forma no cambia, el pico espectral tampoco, y la línea de
    base se mide sobre una sola llamada."""
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(3),
    )
    whole = source.render(0.0, 1000, 500)
    first = source.render(0.0, 500, 500)
    second = source.render(1.0, 500, 500)
    assert np.allclose(whole[:, :500], first)
    assert np.allclose(whole[:, 500:], second)


def test_set_rate_reaches_the_conduction_policy():
    """En la fibrilación auricular la frecuencia la gobierna el nodo AV, no
    la aurícula: la aurícula va a su aire a más de 400 por minuto. Si
    `set_rate_hz` no llegara hasta la política de conducción, mover el
    control de frecuencia en una FA no haría absolutamente nada."""
    source = BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=420 / 60
        ),
        conduction=IrregularConduction(mean_rr_s=0.85, rr_spread_s=0.15),
        rng=np.random.default_rng(11),
    )
    slow = len(
        [e for e in source.events(0.0, 60.0) if e.kind is EventKind.VENTRICULAR]
    )
    source.set_rate_hz(150 / 60)
    fast = len(
        [e for e in source.events(60.0, 120.0) if e.kind is EventKind.VENTRICULAR]
    )
    assert fast > slow


def test_ventricular_fibrillation_energy_sits_in_its_dominant_band():
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(1),
    )
    trace = source.render(0.0, 5000, 500)[LEAD_ORDER.index("II")]
    spectrum = np.abs(np.fft.rfft(trace))
    freqs = np.fft.rfftfreq(trace.size, d=1 / 500.0)
    peak_hz = freqs[int(np.argmax(spectrum))]
    assert 3.0 <= peak_hz <= 10.0


def test_coarse_fibrillation_has_larger_excursions_than_fine():
    coarse = VentricularFibrillationSource(
        coarseness=1.0, amplitude_v=0.0004, dominant_hz=6.0,
        rng=np.random.default_rng(4),
    ).render(0.0, 5000, 500)
    fine = VentricularFibrillationSource(
        coarseness=0.2, amplitude_v=0.0004, dominant_hz=6.0,
        rng=np.random.default_rng(4),
    ).render(0.0, 5000, 500)
    assert coarse.std() > fine.std()


def test_fibrillation_has_no_isoelectric_baseline():
    """En la FV no hay línea de base: la señal nunca descansa."""
    trace = VentricularFibrillationSource(
        coarseness=0.7, amplitude_v=0.0004, dominant_hz=6.0,
        rng=np.random.default_rng(2),
    ).render(0.0, 5000, 500)[LEAD_ORDER.index("II")]
    near_zero = np.mean(np.abs(trace) < 0.00002)
    assert near_zero < 0.15
