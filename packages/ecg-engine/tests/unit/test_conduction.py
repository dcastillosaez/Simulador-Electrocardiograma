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


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_fixed_pr_conducts_every_p(rng):
    atrial = atrial_train(10)
    ventricular = FixedPR(pr_s=0.16).conduct(atrial, rng)
    assert len(ventricular) == 10
    assert all(e.kind is EventKind.VENTRICULAR for e in ventricular)


def test_fixed_pr_offsets_each_qrs_by_the_pr_interval(rng):
    atrial = atrial_train(5)
    ventricular = FixedPR(pr_s=0.16).conduct(atrial, rng)
    for p, qrs in zip(atrial, ventricular):
        assert qrs.t_s == pytest.approx(p.t_s + 0.16)


def test_first_degree_block_is_just_a_long_fixed_pr(rng):
    """El BAV de primer grado no es una política aparte: es FixedPR largo."""
    ventricular = FixedPR(pr_s=0.24).conduct(atrial_train(3), rng)
    assert ventricular[0].t_s == pytest.approx(0.24)


def test_wenckebach_lengthens_pr_until_a_beat_drops(rng):
    """Mobitz I: el PR crece latido a latido y el cuarto no conduce."""
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(8)
    ventricular = policy.conduct(atrial, rng)

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
    ventricular = policy.conduct(atrial, rng)
    fifth = next(e for e in ventricular if e.index == 4)
    assert fifth.t_s - atrial[4].t_s == pytest.approx(0.16)


def test_wenckebach_is_independent_of_chunk_boundaries(rng):
    """Renderizar en dos trozos debe dar el mismo resultado que en uno."""
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(12)
    whole = policy.conduct(atrial, rng)
    split = policy.conduct(atrial[:5], rng) + policy.conduct(atrial[5:], rng)
    assert [e.t_s for e in whole] == pytest.approx([e.t_s for e in split])


def test_fixed_ratio_block_conducts_one_in_n(rng):
    """Flutter 2:1 — conduce una de cada dos ondas auriculares."""
    ventricular = FixedRatioBlock(ratio=2, pr_s=0.14).conduct(atrial_train(10), rng)
    assert len(ventricular) == 5
    assert [e.index for e in ventricular] == [0, 2, 4, 6, 8]


def test_fixed_ratio_block_supports_four_to_one(rng):
    ventricular = FixedRatioBlock(ratio=4, pr_s=0.14).conduct(atrial_train(12), rng)
    assert [e.index for e in ventricular] == [0, 4, 8]


def test_fixed_ratio_block_rejects_a_ratio_below_two(rng):
    with pytest.raises(ValueError, match="ratio"):
        FixedRatioBlock(ratio=1, pr_s=0.14)


def test_complete_block_conducts_nothing(rng):
    """BAV de tercer grado: ninguna P alcanza el ventrículo.
    Los QRS los aporta una fuente de escape independiente."""
    assert CompleteBlock().conduct(atrial_train(20), rng) == []


def test_irregular_conduction_produces_irregular_rr(rng):
    """FA: el RR debe ser genuinamente irregular, no solo ruidoso."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    ventricular = policy.conduct(atrial_train(400, interval_s=0.006), rng)
    rr = np.diff([e.t_s for e in ventricular])
    assert rr.std() > 0.08
    assert rr.min() > 0.0


def test_irregular_conduction_is_deterministic_for_a_given_seed():
    atrial = atrial_train(200, interval_s=0.006)
    first = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        atrial, np.random.default_rng(7)
    )
    second = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        atrial, np.random.default_rng(7)
    )
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_irregular_conduction_is_independent_of_chunk_boundaries(rng):
    """Gemelo del test de Wenckebach, y el motivo de que esta política tenga
    caché. Sin ella, cada chunk sortearía intervalos nuevos y la FA daría una
    señal distinta según dónde cayeran las fronteras."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    atrial = atrial_train(2000, interval_s=0.006)  # 12 s de actividad auricular

    chunked: list[float] = []
    for start in range(0, 2000, 250):
        window = atrial[start : start + 250]
        chunked.extend(e.t_s for e in policy.conduct(window, rng))

    whole = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        atrial, np.random.default_rng(20260725)
    )
    assert [e.t_s for e in whole] == pytest.approx(sorted(set(chunked)))


def test_irregular_conduction_repeats_the_same_beats_for_a_repeated_window(rng):
    """Renderizar dos veces la misma ventana debe dar los mismos latidos."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    atrial = atrial_train(1000, interval_s=0.006)
    first = policy.conduct(atrial, rng)
    second = policy.conduct(atrial, rng)
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_irregular_conduction_indices_are_absolute_not_per_window(rng):
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    atrial = atrial_train(3000, interval_s=0.006)
    policy.conduct(atrial[:1500], rng)
    late = policy.conduct(atrial[1500:], rng)
    assert late[0].index > 0


def test_conducted_events_carry_the_configured_template(rng):
    ventricular = FixedPR(pr_s=0.16, template_id="wide_qrst").conduct(
        atrial_train(3), rng
    )
    assert all(e.template_id == "wide_qrst" for e in ventricular)
