"""Curvas concentración-tiempo."""

from __future__ import annotations

import pytest

from pharmacology_engine.kinetics import ConcentrationCurve, default_half_life_s


@pytest.fixture
def curve() -> ConcentrationCurve:
    return ConcentrationCurve(
        onset_s=10.0, peak_s=60.0, duration_s=600.0, half_life_s=120.0
    )


def test_sin_efecto_antes_del_inicio(curve: ConcentrationCurve) -> None:
    assert curve.at(0.0) == 0.0
    assert curve.at(9.99) == 0.0


def test_pico_exacto_en_el_pico(curve: ConcentrationCurve) -> None:
    assert curve.at(60.0) == pytest.approx(1.0)


def test_cero_exacto_al_agotarse(curve: ConcentrationCurve) -> None:
    """La renormalización existe para esto: sin ella el decaimiento
    exponencial dejaría un residuo y el fármaco nunca saldría de la lista."""
    assert curve.at(600.0) == 0.0
    assert curve.at(1_000.0) == 0.0


def test_subida_monotona(curve: ConcentrationCurve) -> None:
    values = [curve.at(t) for t in range(10, 61)]
    assert all(b >= a for a, b in zip(values, values[1:]))


def test_bajada_monotona(curve: ConcentrationCurve) -> None:
    values = [curve.at(float(t)) for t in range(60, 600, 5)]
    assert all(b <= a for a, b in zip(values, values[1:]))


def test_continuidad_en_el_pico(curve: ConcentrationCurve) -> None:
    assert curve.at(59.9) == pytest.approx(curve.at(60.1), abs=0.01)


def test_continuidad_al_final(curve: ConcentrationCurve) -> None:
    """Un salto aquí sería un escalón visible en el trazado."""
    assert curve.at(599.9) == pytest.approx(0.0, abs=0.01)


def test_semivida_gobierna_el_decaimiento(curve: ConcentrationCurve) -> None:
    """Una semivida por delante del pico deja aproximadamente la mitad."""
    assert curve.at(60.0 + 120.0) == pytest.approx(0.5, abs=0.05)


def test_activo_incluye_la_latencia(curve: ConcentrationCurve) -> None:
    """Recién administrado y aún sin efecto, pero el usuario debe verlo."""
    assert curve.is_active(0.0)
    assert curve.at(0.0) == 0.0
    assert not curve.is_active(600.0)


def test_remaining_no_es_negativo(curve: ConcentrationCurve) -> None:
    assert curve.remaining_s(900.0) == 0.0
    assert curve.remaining_s(100.0) == pytest.approx(500.0)


def test_tiempos_incoherentes_fallan() -> None:
    with pytest.raises(ValueError, match="onset"):
        ConcentrationCurve(onset_s=100.0, peak_s=50.0, duration_s=600.0, half_life_s=10.0)


def test_semivida_no_positiva_falla() -> None:
    with pytest.raises(ValueError, match="half_life"):
        ConcentrationCurve(onset_s=0.0, peak_s=1.0, duration_s=10.0, half_life_s=0.0)


def test_pico_igual_a_inicio_es_escalon() -> None:
    instant = ConcentrationCurve(
        onset_s=5.0, peak_s=5.0, duration_s=30.0, half_life_s=6.0
    )
    assert instant.at(4.9) == 0.0
    assert instant.at(5.0) == pytest.approx(1.0)


def test_semivida_por_defecto_deja_residuo_despreciable() -> None:
    """Un quinto de la ventana: al cortar queda 2⁻⁵ ≈ 3 %, así que la
    renormalización apenas deforma la curva.

    Dos semividas tras el pico, el decaimiento crudo vale 0.25; tras
    renormalizar, 0.226. Esa diferencia de dos puntos es toda la deformación
    que introduce la renormalización, y es el número que este test fija.
    """
    half_life = default_half_life_s(600.0, 100.0)
    assert half_life == pytest.approx(100.0)
    derived = ConcentrationCurve(
        onset_s=0.0, peak_s=100.0, duration_s=600.0, half_life_s=half_life
    )
    assert derived.at(300.0) == pytest.approx(0.226, abs=0.005)
