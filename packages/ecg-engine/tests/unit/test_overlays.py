import numpy as np
import pytest

from ecg_engine.overlays import (
    OVERLAYS,
    ST_ELEVATION_INFERIOR,
    MorphologyOverlay,
    OverlayRule,
    OverlayScopeError,
    get_overlay,
)
from ecg_engine.types import LEAD_ORDER, N_LEADS, WaveTarget


def test_overlay_rejects_a_rule_outside_its_declared_targets():
    """El corazón de la restricción: un overlay de ST no puede tocar la P."""
    with pytest.raises(OverlayScopeError, match="P"):
        MorphologyOverlay(
            overlay_id="mal_declarado",
            targets=frozenset({WaveTarget.ST}),
            leads=("II",),
            rules=(
                OverlayRule(
                    target=WaveTarget.P,
                    amplitude_v=0.0001,
                    center_s=0.0,
                    width_s=0.01,
                ),
            ),
        )


def test_overlay_accepts_rules_within_its_declared_targets():
    overlay = MorphologyOverlay(
        overlay_id="ok",
        targets=frozenset({WaveTarget.ST, WaveTarget.T}),
        leads=("II",),
        rules=(
            OverlayRule(WaveTarget.ST, 0.0002, 0.09, 0.03),
            OverlayRule(WaveTarget.T, -0.0001, 0.23, 0.04),
        ),
    )
    assert len(overlay.components()) == 2


def test_overlay_rejects_unknown_leads():
    with pytest.raises(ValueError, match="V9"):
        MorphologyOverlay(
            overlay_id="lead_malo",
            targets=frozenset({WaveTarget.ST}),
            leads=("V9",),
            rules=(OverlayRule(WaveTarget.ST, 0.0002, 0.09, 0.03),),
        )


def test_overlay_requires_at_least_one_lead():
    with pytest.raises(ValueError, match="derivación"):
        MorphologyOverlay(
            overlay_id="sin_leads",
            targets=frozenset({WaveTarget.ST}),
            leads=(),
            rules=(OverlayRule(WaveTarget.ST, 0.0002, 0.09, 0.03),),
        )


def test_lead_mask_is_one_for_affected_leads_and_zero_elsewhere():
    mask = ST_ELEVATION_INFERIOR.lead_mask()
    assert mask.shape == (N_LEADS, 1)
    for lead in ("II", "III", "aVF"):
        assert mask[LEAD_ORDER.index(lead), 0] == 1.0
    for lead in ("I", "aVL", "V1", "V6"):
        assert mask[LEAD_ORDER.index(lead), 0] == 0.0


def test_inferior_infarct_elevates_st_in_the_inferior_leads():
    """IAM inferior: II, III y aVF. Es el patrón clínico, no una elección
    arbitraria."""
    assert set(ST_ELEVATION_INFERIOR.leads) == {"II", "III", "aVF"}
    assert ST_ELEVATION_INFERIOR.targets == frozenset({WaveTarget.ST})


def test_st_elevation_amplitude_is_clinically_significant():
    """Elevación de al menos 0,1 mV (1 mm), el umbral diagnóstico."""
    st_rule = ST_ELEVATION_INFERIOR.rules[0]
    assert st_rule.amplitude_v >= 0.0001


def test_components_carry_the_rule_targets():
    components = ST_ELEVATION_INFERIOR.components()
    assert all(c.target is WaveTarget.ST for c in components)


def test_registry_lookup_and_unknown_overlay_message():
    assert get_overlay("st_elevation_inferior") is ST_ELEVATION_INFERIOR
    with pytest.raises(KeyError, match="no_existe"):
        get_overlay("no_existe")


def test_registry_keys_match_overlay_ids():
    assert all(key == overlay.overlay_id for key, overlay in OVERLAYS.items())
