import numpy as np
import pytest

from ecg_engine.conduction import (
    CompleteBlock,
    FixedPR,
    FixedRatioBlock,
    IrregularConduction,
    WenckebachPR,
)
from ecg_engine.types import CardiacEvent, EventKind


def atrial_train(count: int, interval_s: float = 0.857) -> list[CardiacEvent]:
    return [
        CardiacEvent(
            kind=EventKind.ATRIAL,
            t_s=i * interval_s,
            template_id="sinus_p",
            index=i,
        )
        for i in range(count)
    ]


def window_of(atrial: list[CardiacEvent]) -> tuple[float, float]:
    """Ventana que cubre un tren completo, para los tests que no la varían."""
    return (0.0, atrial[-1].t_s + 1e-6) if atrial else (0.0, 0.0)


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_fixed_pr_conducts_every_p(rng):
    atrial = atrial_train(10)
    ventricular = FixedPR(pr_s=0.16).conduct(atrial, rng, *window_of(atrial))
    assert len(ventricular) == 10
    assert all(e.kind is EventKind.VENTRICULAR for e in ventricular)


def test_fixed_pr_offsets_each_qrs_by_the_pr_interval(rng):
    atrial = atrial_train(5)
    ventricular = FixedPR(pr_s=0.16).conduct(atrial, rng, *window_of(atrial))
    for p, qrs in zip(atrial, ventricular):
        assert qrs.t_s == pytest.approx(p.t_s + 0.16)


def test_first_degree_block_is_just_a_long_fixed_pr(rng):
    """El BAV de primer grado no es una política aparte: es FixedPR largo."""
    atrial = atrial_train(3)
    ventricular = FixedPR(pr_s=0.24).conduct(atrial, rng, *window_of(atrial))
    assert ventricular[0].t_s == pytest.approx(0.24)


def test_pure_policies_ignore_the_window(rng):
    """Las políticas puras derivan todo del índice de la P. La ventana solo
    existe para la fibrilación auricular; pasarles una distinta no puede
    cambiar su salida."""
    atrial = atrial_train(6)
    wide = FixedPR(pr_s=0.16).conduct(atrial, rng, 0.0, 1000.0)
    narrow = FixedPR(pr_s=0.16).conduct(atrial, rng, 2.0, 2.5)
    assert [e.t_s for e in wide] == pytest.approx([e.t_s for e in narrow])


def test_wenckebach_lengthens_pr_until_a_beat_drops(rng):
    """Mobitz I: el PR crece latido a latido y el cuarto no conduce."""
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(8)
    ventricular = policy.conduct(atrial, rng, *window_of(atrial))

    assert len(ventricular) == 6  # 8 P, 2 caídas

    pr_intervals = []
    conducted_indices = {e.index for e in ventricular}
    for qrs in ventricular:
        p = atrial[qrs.index]
        pr_intervals.append(qrs.t_s - p.t_s)

    assert pr_intervals[:3] == pytest.approx([0.16, 0.20, 0.24])
    assert 3 not in conducted_indices  # el cuarto de cada ciclo cae
    assert 7 not in conducted_indices


def test_wenckebach_resets_pr_after_the_dropped_beat(rng):
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(8)
    ventricular = policy.conduct(atrial, rng, *window_of(atrial))
    fifth = next(e for e in ventricular if e.index == 4)
    assert fifth.t_s - atrial[4].t_s == pytest.approx(0.16)


def test_wenckebach_is_independent_of_chunk_boundaries(rng):
    """Renderizar en dos trozos debe dar el mismo resultado que en uno."""
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(12)
    whole = policy.conduct(atrial, rng, *window_of(atrial))
    split = policy.conduct(
        atrial[:5], rng, *window_of(atrial[:5])
    ) + policy.conduct(atrial[5:], rng, *window_of(atrial[5:]))
    assert [e.t_s for e in whole] == pytest.approx([e.t_s for e in split])


def test_fixed_ratio_block_conducts_one_in_n(rng):
    """Flutter 2:1 — conduce una de cada dos ondas auriculares."""
    atrial = atrial_train(10)
    ventricular = FixedRatioBlock(ratio=2, pr_s=0.14).conduct(
        atrial, rng, *window_of(atrial)
    )
    assert len(ventricular) == 5
    assert [e.index for e in ventricular] == [0, 2, 4, 6, 8]


def test_fixed_ratio_block_supports_four_to_one(rng):
    atrial = atrial_train(12)
    ventricular = FixedRatioBlock(ratio=4, pr_s=0.14).conduct(
        atrial, rng, *window_of(atrial)
    )
    assert [e.index for e in ventricular] == [0, 4, 8]


def test_fixed_ratio_block_rejects_a_ratio_below_two(rng):
    with pytest.raises(ValueError, match="ratio"):
        FixedRatioBlock(ratio=1, pr_s=0.14)


def test_wenckebach_rejects_a_cycle_length_below_two(rng):
    with pytest.raises(ValueError, match="cycle_length"):
        WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=1)


def test_complete_block_conducts_nothing(rng):
    """BAV de tercer grado: ninguna P alcanza el ventrículo.
    Los QRS los aporta una fuente de escape independiente."""
    atrial = atrial_train(20)
    assert CompleteBlock().conduct(atrial, rng, *window_of(atrial)) == []


def test_irregular_conduction_produces_irregular_rr(rng):
    """FA: el RR debe ser genuinamente irregular, no solo ruidoso."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    ventricular = policy.conduct([], rng, 0.0, 120.0)
    rr = np.diff([e.t_s for e in ventricular])
    assert rr.std() > 0.08
    assert rr.min() > 0.0


def test_irregular_conduction_does_not_need_atrial_events_at_all(rng):
    """La ventana manda. En la FA la aurícula no marca el paso del
    ventrículo, así que la política debe producir latidos aunque no le
    llegue ni una sola onda f: es justo lo que ocurre en un trozo corto."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    assert policy.conduct([], rng, 0.0, 10.0)


def test_irregular_conduction_is_deterministic_for_a_given_seed():
    first = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        [], np.random.default_rng(7), 0.0, 60.0
    )
    second = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        [], np.random.default_rng(7), 0.0, 60.0
    )
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_irregular_conduction_survives_chunks_shorter_than_its_beats(rng):
    """El caso que de verdad importa, y el que un tren auricular denso
    esconde: trozos de 100 ms, más cortos que el RR y que el intervalo entre
    ondas f. Ni un latido puede perderse por el camino."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    chunked: list[float] = []
    t = 0.0
    while t < 30.0:
        chunked.extend(e.t_s for e in policy.conduct([], rng, t, t + 0.1))
        t += 0.1

    whole = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        [], np.random.default_rng(20260725), 0.0, 30.0
    )
    assert [e.t_s for e in whole] == pytest.approx(chunked)


def test_irregular_conduction_repeats_the_same_beats_for_a_repeated_window(rng):
    """Renderizar dos veces la misma ventana debe dar los mismos latidos."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    first = policy.conduct([], rng, 0.0, 20.0)
    second = policy.conduct([], rng, 0.0, 20.0)
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_irregular_conduction_indices_are_absolute_not_per_window(rng):
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    policy.conduct([], rng, 0.0, 30.0)
    late = policy.conduct([], rng, 30.0, 60.0)
    assert late[0].index > 0


def test_irregular_conduction_rate_change_affects_only_future_beats(rng):
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    before = policy.conduct([], rng, 0.0, 30.0)
    policy.set_rate_hz(150 / 60)
    after = policy.conduct([], rng, 30.0, 60.0)
    assert policy.conduct([], rng, 0.0, 30.0) == before
    assert len(after) > len(before)


def test_conducted_events_carry_the_configured_template(rng):
    atrial = atrial_train(3)
    ventricular = FixedPR(pr_s=0.16, template_id="wide_qrst").conduct(
        atrial, rng, *window_of(atrial)
    )
    assert all(e.template_id == "wide_qrst" for e in ventricular)
