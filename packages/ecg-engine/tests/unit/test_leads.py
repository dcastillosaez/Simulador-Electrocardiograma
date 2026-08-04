import numpy as np
import pytest

from ecg_engine.leads import (
    ATRIAL_PRECORDIAL,
    ATRIAL_PROJECTION,
    DEFAULT_PROJECTION_SET,
    LeadProjectionSet,
    NORMAL_AXIS_PROJECTION,
    QRS_PRECORDIAL,
    AxisZone,
    LeadProjection,
    _P_MAGNITUDE,
    _QRS_MAGNITUDE,
    project,
    projection_for_axis,
    projection_from_mapping,
    projection_set_for_axis,
    zone_for,
)
from ecg_engine.types import AxisParams, LEAD_ORDER, N_LEADS


def test_projection_has_one_coefficient_per_lead():
    assert len(NORMAL_AXIS_PROJECTION.coefficients) == N_LEADS


def test_projection_rejects_wrong_length():
    with pytest.raises(ValueError, match="12"):
        LeadProjection(coefficients=(1.0, 2.0))


def test_avr_is_negative_under_a_normal_axis():
    """Con eje normal, aVR siempre es negativa. Si sale positiva,
    los electrodos están mal puestos o el modelo está mal."""
    index = LEAD_ORDER.index("aVR")
    assert NORMAL_AXIS_PROJECTION.coefficients[index] < 0.0


def test_lead_ii_is_the_dominant_positive_limb_lead():
    coefficients = NORMAL_AXIS_PROJECTION.coefficients
    limb = {lead: coefficients[LEAD_ORDER.index(lead)] for lead in ("I", "II", "III")}
    assert limb["II"] == max(limb.values())


def test_einthoven_law_holds_for_the_limb_leads():
    """I + III = II. Es una identidad geométrica, no una aproximación."""
    c = NORMAL_AXIS_PROJECTION.coefficients
    i, ii, iii = (c[LEAD_ORDER.index(x)] for x in ("I", "II", "III"))
    assert i + iii == pytest.approx(ii, abs=1e-9)


def test_precordial_progression_is_monotonic_from_v1_to_v5():
    """Progresión de la onda R: V1 negativa, creciendo hasta V5."""
    c = NORMAL_AXIS_PROJECTION.coefficients
    precordial = [c[LEAD_ORDER.index(f"V{n}")] for n in range(1, 6)]
    assert precordial[0] < 0.0
    assert all(a < b for a, b in zip(precordial, precordial[1:]))


def test_atrial_projection_differs_from_ventricular():
    assert ATRIAL_PROJECTION.coefficients != NORMAL_AXIS_PROJECTION.coefficients


def test_projection_from_mapping_orders_by_canonical_lead_order():
    mapping = {lead: float(i) for i, lead in enumerate(LEAD_ORDER)}
    projection = projection_from_mapping(mapping)
    assert projection.coefficients == tuple(float(i) for i in range(N_LEADS))


def test_projection_from_mapping_rejects_unknown_lead():
    mapping = {lead: 1.0 for lead in LEAD_ORDER} | {"V7": 1.0}
    with pytest.raises(ValueError, match="V7"):
        projection_from_mapping(mapping)


def test_projection_from_mapping_rejects_missing_lead():
    mapping = {lead: 1.0 for lead in LEAD_ORDER if lead != "V6"}
    with pytest.raises(ValueError, match="V6"):
        projection_from_mapping(mapping)


def test_project_expands_one_trace_into_twelve_leads():
    trace = np.array([0.0, 1.0, 0.0, -1.0])
    projected = project(trace, NORMAL_AXIS_PROJECTION)
    assert projected.shape == (N_LEADS, 4)
    assert projected.dtype == np.float64


def test_project_scales_each_lead_by_its_coefficient():
    trace = np.ones(3)
    projected = project(trace, NORMAL_AXIS_PROJECTION)
    for index, coefficient in enumerate(NORMAL_AXIS_PROJECTION.coefficients):
        assert projected[index] == pytest.approx(np.full(3, coefficient))


@pytest.mark.parametrize(
    "projection", [NORMAL_AXIS_PROJECTION, ATRIAL_PROJECTION], ids=["qrs", "p"]
)
def test_no_lead_is_perfectly_isoelectric(projection):
    """Una derivación exactamente plana no existe en ningún paciente, y en un
    trazado de doce salta a la vista. Ocurría con aVL cuando el eje se ponía
    a 60° exactos: I y III valían lo mismo y (I − III)/2 daba cero."""
    assert all(abs(c) > 0.01 for c in projection.coefficients)


def test_augmented_leads_follow_their_definitions():
    """aVR, aVL y aVF no son coeficientes libres: se derivan de las tres
    derivaciones de miembros. Si alguien retoca I, II o III sin recalcularlas,
    el trazado deja de ser geométricamente posible."""
    c = NORMAL_AXIS_PROJECTION.coefficients
    i, ii, iii, avr, avl, avf = (
        c[LEAD_ORDER.index(x)] for x in ("I", "II", "III", "aVR", "aVL", "aVF")
    )
    assert avr == pytest.approx(-(i + ii) / 2, abs=1e-9)
    assert avl == pytest.approx((i - iii) / 2, abs=1e-9)
    assert avf == pytest.approx((ii + iii) / 2, abs=1e-9)


def test_projection_for_axis_reproduces_the_normal_qrs_table():
    # La tabla histórica está redondeada a tres decimales y aVR/aVL/aVF se
    # escribieron desde esos valores ya redondeados: media unidad del último
    # decimal es la mejor reproducción posible, no 1e-9.
    computed = projection_for_axis(50.0, _QRS_MAGNITUDE, QRS_PRECORDIAL)
    np.testing.assert_allclose(
        computed.coefficients, NORMAL_AXIS_PROJECTION.coefficients, atol=5e-4
    )


def test_projection_for_axis_reproduces_the_atrial_table():
    # Esa tabla solo tiene dos decimales: tolerancia 5e-3.
    computed = projection_for_axis(53.4, _P_MAGNITUDE, ATRIAL_PRECORDIAL)
    np.testing.assert_allclose(
        computed.coefficients, ATRIAL_PROJECTION.coefficients, atol=5e-3
    )


def _limb(projection, lead):
    return projection.coefficients[LEAD_ORDER.index(lead)]


def test_einthoven_is_a_theorem_over_the_whole_range():
    # I + III = II para cualquier ángulo: identidad trigonométrica, no tres
    # casos sueltos.
    for deg in range(-180, 181):
        p = projection_for_axis(float(deg), _QRS_MAGNITUDE, QRS_PRECORDIAL)
        assert _limb(p, "I") + _limb(p, "III") == pytest.approx(_limb(p, "II"))


def test_avr_is_negative_across_the_normal_range():
    for deg in range(-30, 91):
        p = projection_for_axis(float(deg), _QRS_MAGNITUDE, QRS_PRECORDIAL)
        assert _limb(p, "aVR") < 0.0


def test_left_axis_deviation_signature():
    p = projection_for_axis(-30.0, _QRS_MAGNITUDE, QRS_PRECORDIAL)
    assert _limb(p, "I") > 0.0
    assert _limb(p, "aVF") < 0.0


def test_right_axis_deviation_signature():
    p = projection_for_axis(120.0, _QRS_MAGNITUDE, QRS_PRECORDIAL)
    assert _limb(p, "I") < 0.0
    assert _limb(p, "aVF") > 0.0


def test_zone_boundaries_are_testable_one_by_one():
    assert zone_for(-30.0) is AxisZone.NORMAL
    assert zone_for(-31.0) is AxisZone.LEFT
    assert zone_for(90.0) is AxisZone.NORMAL
    assert zone_for(91.0) is AxisZone.RIGHT
    assert zone_for(-90.0) is AxisZone.LEFT
    assert zone_for(-91.0) is AxisZone.EXTREME
    assert zone_for(180.0) is AxisZone.RIGHT


def test_zone_for_normalizes_before_classifying():
    # +270° es el mismo eje que −90°: un QRS con orientación +180 y offset +90.
    assert zone_for(270.0) is zone_for(-90.0)


def test_zones_cover_the_whole_circle_without_gaps():
    for deg in range(-180, 181):
        assert isinstance(zone_for(float(deg)), AxisZone)


def test_default_projection_set_matches_the_historical_tables():
    np.testing.assert_allclose(
        DEFAULT_PROJECTION_SET.qrs.coefficients,
        NORMAL_AXIS_PROJECTION.coefficients,
        atol=5e-4,
    )
    np.testing.assert_allclose(
        DEFAULT_PROJECTION_SET.p.coefficients,
        ATRIAL_PROJECTION.coefficients,
        atol=5e-3,
    )


def test_st_and_t_share_the_qrs_projection_at_zero_offset():
    s = projection_set_for_axis(AxisParams())
    assert s.st.coefficients == s.qrs.coefficients
    assert s.t.coefficients == s.qrs.coefficients


def test_a_qrs_offset_moves_only_the_qrs_projection():
    # Dos ejes desviados que solo difieren en el desfase del QRS: la T no se
    # mueve. Se parte de una orientación distinta de la de referencia para que
    # ambos conjuntos se calculen por trigonometría y la comparación no cruce
    # la costura tabla-literal / cálculo.
    base = projection_set_for_axis(AxisParams(orientation_deg=40.0))
    moved = projection_set_for_axis(AxisParams(orientation_deg=40.0, qrs_offset_deg=30.0))
    assert moved.qrs.coefficients != base.qrs.coefficients  # el QRS rotó
    assert moved.t.coefficients == base.t.coefficients       # la T no


def test_reference_axis_uses_the_literal_validated_tables():
    # La orientación de referencia devuelve las tablas históricas literales,
    # bit a bit, para no romper los golden signals.
    s = projection_set_for_axis(AxisParams())
    assert s.qrs.coefficients == NORMAL_AXIS_PROJECTION.coefficients
    assert s.p.coefficients == ATRIAL_PROJECTION.coefficients
