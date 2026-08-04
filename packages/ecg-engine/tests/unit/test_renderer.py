import numpy as np
import pytest

from ecg_engine.leads import NORMAL_AXIS_PROJECTION
from ecg_engine.overlays import ST_ELEVATION_INFERIOR
from ecg_engine.renderer import (
    DEFAULT_PROJECTION_SET,
    RENDER_MARGIN_S,
    render_events,
    time_grid,
)
from ecg_engine.types import (
    LEAD_ORDER,
    N_LEADS,
    CardiacEvent,
    EventKind,
    VariabilityParams,
)


def qrs_at(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.VENTRICULAR, t_s=t_s, template_id="normal_qrst", index=index
    )


def p_at(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.ATRIAL, t_s=t_s, template_id="sinus_p", index=index
    )


@pytest.fixture
def grid() -> np.ndarray:
    return time_grid(0, 1000, 500)  # 2 s


def test_time_grid_spacing_matches_the_sample_rate():
    t = time_grid(0, 500, 500)
    assert t.size == 500
    assert t[0] == pytest.approx(0.0)
    assert np.diff(t) == pytest.approx(np.full(499, 1 / 500))


def test_time_grid_starts_at_the_time_implied_by_the_start_index():
    t = time_grid(18750, 10, 500)
    assert t[0] == pytest.approx(37.5)


def test_time_grid_splices_bit_for_bit_across_chunk_boundaries():
    """La rejilla se construye desde el índice de muestra: una generación
    completa y un trozo que arranca en la misma muestra deben coincidir bit a
    bit, sin el error de redondeo que introducía sumar `t0_s` ya redondeado."""
    whole = time_grid(0, 2500, 500)
    chunk = time_grid(2000, 500, 500)
    assert np.array_equal(whole[2000:], chunk)


def test_render_margin_covers_a_full_t_wave():
    """La T de un latido anterior sigue contribuyendo dentro de la ventana."""
    assert RENDER_MARGIN_S >= 0.5


def test_empty_event_list_renders_a_flat_isoelectric_line(grid):
    signal = render_events([], grid, DEFAULT_PROJECTION_SET)
    assert signal.shape == (N_LEADS, grid.size)
    assert np.allclose(signal, 0.0)


def test_a_single_qrs_peaks_at_its_event_time(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    lead_ii = signal[LEAD_ORDER.index("II")]
    assert grid[int(np.argmax(lead_ii))] == pytest.approx(1.0, abs=0.005)


def test_r_amplitude_in_lead_ii_is_about_one_millivolt(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    assert signal[LEAD_ORDER.index("II")].max() == pytest.approx(0.001, rel=0.15)


def test_avr_is_negative_for_a_normal_qrs(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    assert signal[LEAD_ORDER.index("aVR")].min() < 0.0


def test_atrial_and_ventricular_events_use_different_projections(grid):
    p_only = render_events([p_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    qrs_only = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    v1 = LEAD_ORDER.index("V1")
    assert p_only[v1].max() > 0.0    # P positiva en V1
    assert qrs_only[v1].min() < 0.0  # QRS negativo en V1


def test_events_superpose_additively(grid):
    separate = render_events([qrs_at(0.5)], grid, DEFAULT_PROJECTION_SET) + render_events(
        [qrs_at(1.5, index=1)], grid, DEFAULT_PROJECTION_SET
    )
    together = render_events(
        [qrs_at(0.5), qrs_at(1.5, index=1)], grid, DEFAULT_PROJECTION_SET
    )
    assert np.allclose(separate, together)


def test_overlay_only_touches_its_declared_leads(grid):
    plain = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    elevated = render_events(
        [qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET, overlays=(ST_ELEVATION_INFERIOR,)
    )
    for lead in ("II", "III", "aVF"):
        assert not np.allclose(plain[LEAD_ORDER.index(lead)],
                               elevated[LEAD_ORDER.index(lead)])
    for lead in ("I", "aVL", "V1", "V2", "V6"):
        assert np.allclose(plain[LEAD_ORDER.index(lead)],
                           elevated[LEAD_ORDER.index(lead)])


def test_overlay_raises_the_st_segment_above_baseline(grid):
    elevated = render_events(
        [qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET, overlays=(ST_ELEVATION_INFERIOR,)
    )
    st_sample = int((1.0 + 0.09) * 500)
    assert elevated[LEAD_ORDER.index("III"), st_sample] > 0.00015


def test_overlay_does_not_apply_to_atrial_events(grid):
    """Un overlay de ST no puede modificar una onda P: es la regla que
    impide que la isquemia altere la aurícula por accidente."""
    plain = render_events([p_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    with_overlay = render_events(
        [p_at(1.0)], grid, DEFAULT_PROJECTION_SET, overlays=(ST_ELEVATION_INFERIOR,)
    )
    assert np.allclose(plain, with_overlay)


def test_variability_modulates_amplitude_without_moving_the_peak(grid):
    params = VariabilityParams(amplitude_fraction=0.20, respiration_hz=0.25)
    plain = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    modulated = render_events(
        [qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET, variability=params
    )
    lead_ii = LEAD_ORDER.index("II")
    assert int(np.argmax(modulated[lead_ii])) == pytest.approx(
        int(np.argmax(plain[lead_ii])), abs=2
    )
    assert modulated[lead_ii].max() != pytest.approx(plain[lead_ii].max())


def test_output_is_always_float64_and_twelve_leads(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTION_SET)
    assert signal.dtype == np.float64
    assert signal.shape[0] == N_LEADS


from ecg_engine.leads import DEFAULT_PROJECTION_SET, LeadProjectionSet, projection_from_mapping


def test_ventricular_waves_use_their_own_projection(grid):
    # Anulando la proyección de ST y T pero no la del QRS, la onda T (que cae
    # ~0,25 s tras la R) desaparece: prueba de que el corte por onda funciona.
    zero = projection_from_mapping({lead: 0.0 for lead in LEAD_ORDER})
    qrs_only = LeadProjectionSet(
        p=DEFAULT_PROJECTION_SET.p,
        qrs=DEFAULT_PROJECTION_SET.qrs,
        st=zero,
        t=zero,
    )
    signal = render_events([qrs_at(1.0)], grid, qrs_only)
    lead_ii = signal[LEAD_ORDER.index("II")]
    t_region = lead_ii[grid > 1.15]
    assert np.abs(t_region).max() < 1e-4
