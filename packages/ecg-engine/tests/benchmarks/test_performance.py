"""Objetivos de rendimiento del motor.

El objetivo del diseño es generar 10 s de ECG de doce derivaciones en menos
de 50 ms. Con chunks de 100 ms en producción, eso deja un margen holgado
frente al tiempo real.
"""

from __future__ import annotations

import time

import numpy as np
import pytest

from ecg_engine import EcgEngine, list_rhythms

TEN_SECONDS_SAMPLES = 5000
TARGET_S = 0.050
REALTIME_CHUNK_SAMPLES = 50  # 100 ms a 500 Hz
REALTIME_BUDGET_S = 0.010


def elapsed_s(fn) -> float:
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def test_ten_seconds_of_ecg_generate_under_fifty_milliseconds():
    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    duration_s = elapsed_s(lambda: engine.generate(TEN_SECONDS_SAMPLES))
    assert duration_s < TARGET_S, f"{duration_s * 1000:.1f} ms, objetivo 50 ms"


@pytest.mark.parametrize("rhythm_id", [d.rhythm_id for d in list_rhythms()])
def test_no_rhythm_is_pathologically_slow(rhythm_id):
    """Ningún ritmo debe salirse del presupuesto por más del cuádruple."""
    engine = EcgEngine(rhythm_id=rhythm_id, seed=20260725)
    duration_s = elapsed_s(lambda: engine.generate(TEN_SECONDS_SAMPLES))
    assert duration_s < TARGET_S * 4, (
        f"{rhythm_id}: {duration_s * 1000:.1f} ms"
    )


def test_realtime_chunks_stay_well_inside_their_budget():
    """Un chunk de 100 ms debe generarse en mucho menos de 100 ms, o el
    streaming no aguanta el tiempo real."""
    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    engine.generate(REALTIME_CHUNK_SAMPLES)  # descarta el primer chunk
    worst_s = max(
        elapsed_s(lambda: engine.generate(REALTIME_CHUNK_SAMPLES))
        for _ in range(50)
    )
    assert worst_s < REALTIME_BUDGET_S, f"peor caso {worst_s * 1000:.1f} ms"


def test_generation_cost_does_not_grow_with_elapsed_simulation_time():
    """La caché de la línea temporal crece con la sesión. Este test detecta
    que esa caché degrade a comportamiento cuadrático en sesiones largas."""
    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    early = elapsed_s(lambda: engine.generate(REALTIME_CHUNK_SAMPLES))
    for _ in range(600):  # avanza un minuto de simulación
        engine.generate(REALTIME_CHUNK_SAMPLES)
    late = elapsed_s(lambda: engine.generate(REALTIME_CHUNK_SAMPLES))
    assert late < max(early * 10, 0.005)


def test_ten_minutes_of_simulation_produce_finite_values_throughout():
    """Criterio de aceptación 2: diez minutos sin deriva ni valores rotos."""
    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    for _ in range(6000):  # 600 s en chunks de 100 ms
        chunk = engine.generate(REALTIME_CHUNK_SAMPLES)
        assert np.isfinite(chunk).all()
    assert engine.t_s == pytest.approx(600.0)
