import dataclasses

import pytest

from ecg_engine.types import (
    DEFAULT_SAMPLE_RATE_HZ,
    LEAD_ORDER,
    BeatTemplate,
    CardiacEvent,
    EngineParams,
    EventKind,
    GaussianComponent,
    NoiseParams,
    WaveTarget,
)


def test_lead_order_is_canonical_and_frozen():
    assert LEAD_ORDER == (
        "I", "II", "III", "aVR", "aVL", "aVF",
        "V1", "V2", "V3", "V4", "V5", "V6",
    )
    assert isinstance(LEAD_ORDER, tuple)


def test_default_sample_rate():
    assert DEFAULT_SAMPLE_RATE_HZ == 500


def test_cardiac_event_is_immutable():
    event = CardiacEvent(
        kind=EventKind.ATRIAL, t_s=1.25, template_id="sinus_p", index=7
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        event.t_s = 2.0


def test_cardiac_event_carries_its_ordinal_index():
    """El índice hace que las políticas de conducción sean deterministas
    sin guardar estado entre chunks de render."""
    event = CardiacEvent(
        kind=EventKind.VENTRICULAR, t_s=3.0, template_id="normal_qrst", index=42
    )
    assert event.index == 42


def test_wave_targets_are_the_closed_set():
    assert {t.value for t in WaveTarget} == {"P", "PR", "QRS", "ST", "T"}


def test_beat_template_groups_components_by_target():
    template = BeatTemplate(
        template_id="sinus_p",
        components=(
            GaussianComponent(
                target=WaveTarget.P, amplitude_v=0.00012, center_s=0.0, width_s=0.011
            ),
        ),
    )
    assert template.components_for(WaveTarget.P) == template.components
    assert template.components_for(WaveTarget.QRS) == ()


def test_engine_params_defaults_are_physiological():
    params = EngineParams()
    assert params.heart_rate_hz == pytest.approx(70 / 60)
    assert params.noise == NoiseParams()
    assert params.noise.emg_v == 0.0
