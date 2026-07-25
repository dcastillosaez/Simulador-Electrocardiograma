import numpy as np
import pytest

from ecg_engine.rhythm import EventTrain, RegularTrain
from ecg_engine.types import EventKind, VariabilityParams


def make_train(rate_hz: float = 70 / 60, seed: int = 20260725) -> EventTrain:
    return EventTrain(
        kind=EventKind.ATRIAL,
        template_id="sinus_p",
        rate_hz=rate_hz,
        variability=VariabilityParams(),
        rng=np.random.default_rng(seed),
    )


def test_train_emits_events_of_its_own_kind_and_template():
    events = make_train().events(0.0, 10.0)
    assert all(e.kind is EventKind.ATRIAL for e in events)
    assert all(e.template_id == "sinus_p" for e in events)


def test_effective_rate_matches_the_configured_rate_within_one_percent():
    """70 lpm durante 120 s: unos 140 eventos."""
    events = make_train(rate_hz=70 / 60).events(0.0, 120.0)
    effective_hz = len(events) / 120.0
    assert effective_hz == pytest.approx(70 / 60, rel=0.01)


def test_events_are_strictly_increasing_in_time():
    times = [e.t_s for e in make_train().events(0.0, 60.0)]
    assert all(b > a for a, b in zip(times, times[1:]))


def test_indices_are_consecutive_from_the_origin():
    events = make_train().events(0.0, 30.0)
    assert [e.index for e in events] == list(range(len(events)))


def test_a_window_far_from_the_origin_keeps_absolute_indices():
    train = make_train()
    late = train.events(50.0, 55.0)
    assert late[0].index > 50
    assert all(50.0 <= e.t_s <= 55.0 for e in late)


def test_chunked_generation_equals_whole_generation():
    """Requisito duro: el resultado no puede depender de dónde caigan las
    fronteras de chunk. Sin esto no hay golden signals estables."""
    whole = make_train().events(0.0, 30.0)

    chunked_train = make_train()
    chunked = []
    for start in range(0, 30):
        chunked.extend(chunked_train.events(float(start), float(start + 1)))

    assert [e.t_s for e in whole] == pytest.approx([e.t_s for e in chunked])
    assert [e.index for e in whole] == [e.index for e in chunked]


def test_window_boundaries_are_half_open_so_events_are_not_duplicated():
    train = make_train()
    first = train.events(0.0, 10.0)
    second = train.events(10.0, 20.0)
    assert not ({e.index for e in first} & {e.index for e in second})


def test_two_trains_with_the_same_seed_produce_identical_timelines():
    assert [e.t_s for e in make_train(seed=11).events(0.0, 20.0)] == pytest.approx(
        [e.t_s for e in make_train(seed=11).events(0.0, 20.0)]
    )


def test_different_seeds_produce_different_jitter():
    first = [e.t_s for e in make_train(seed=1).events(0.0, 20.0)]
    second = [e.t_s for e in make_train(seed=2).events(0.0, 20.0)]
    assert first != pytest.approx(second)


def test_regular_train_ignores_rate_changes_without_raising():
    """La frecuencia de un tren regular es estructural. El motor llama a
    `set_rate_hz` en todos los ritmos, así que esto no puede explotar."""
    train = RegularTrain(
        kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=300 / 60
    )
    before = train.events(0.0, 5.0)
    train.set_rate_hz(60 / 60)
    assert train.events(0.0, 5.0) == before


def test_regular_train_has_no_variability_at_all():
    """El flutter a 300/min es un metrónomo: sin RSA ni jitter."""
    train = RegularTrain(
        kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=300 / 60
    )
    times = np.array([e.t_s for e in train.events(0.0, 10.0)])
    rr = np.diff(times)
    assert np.allclose(rr, 0.2)


def test_regular_train_is_stateless_across_windows():
    train = RegularTrain(
        kind=EventKind.VENTRICULAR, template_id="escape_qrst", rate_hz=40 / 60
    )
    assert [e.index for e in train.events(30.0, 40.0)] == [20, 21, 22, 23, 24, 25, 26]


def test_set_rate_applies_to_future_events_only():
    """Cambiar la frecuencia en caliente no debe reescribir el pasado."""
    train = make_train(rate_hz=60 / 60)
    before = train.events(0.0, 10.0)
    train.set_rate_hz(120 / 60)
    after = train.events(10.0, 20.0)
    assert train.events(0.0, 10.0) == before
    assert len(after) > len(before)


def test_rate_must_be_positive():
    with pytest.raises(ValueError, match="rate_hz"):
        make_train(rate_hz=0.0)
