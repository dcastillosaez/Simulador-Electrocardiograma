"""Utilidades compartidas entre el generador de golden files y sus tests.

Que ambos usen exactamente el mismo código de simulación no es opcional: si
divergen, los golden dejan de comprobar lo que creemos que comprueban.
"""

from __future__ import annotations

import pathlib

import numpy as np

from ecg_engine import EcgEngine, EngineParams, NoiseParams, get_rhythm, measure

GOLDEN_SEED: int = 20260725
GOLDEN_DURATION_S: float = 10.0
GOLDEN_SAMPLE_RATE_HZ: int = 500

NOISY_PARAMS: NoiseParams = NoiseParams(
    emg_v=2e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=8e-5
)


def golden_dir() -> pathlib.Path:
    return pathlib.Path(__file__).parent / "data"


def simulate(rhythm_id: str, noisy: bool) -> dict:
    """Ejecuta la simulación canónica de un ritmo y devuelve sus tres niveles."""
    engine = EcgEngine(
        rhythm_id=rhythm_id, seed=GOLDEN_SEED, sample_rate_hz=GOLDEN_SAMPLE_RATE_HZ
    )
    if noisy:
        engine.update_params(
            EngineParams(
                heart_rate_hz=engine.params.heart_rate_hz, noise=NOISY_PARAMS
            )
        )
    n_samples = int(GOLDEN_DURATION_S * GOLDEN_SAMPLE_RATE_HZ)
    signal = engine.generate(n_samples)

    source = engine.source
    events = (
        list(source.events(0.0, GOLDEN_DURATION_S))
        if hasattr(source, "events")
        else []
    )

    return {
        "signal": signal,
        "events": [
            (e.kind.value, round(e.t_s, 6), e.template_id, e.index) for e in events
        ],
        "measurements": measure(
            events,
            signal,
            GOLDEN_SAMPLE_RATE_HZ,
            get_rhythm(rhythm_id).pr_is_measurable,
        ).as_dict(),
    }


def golden_paths(rhythm_id: str, noisy: bool) -> dict[str, pathlib.Path]:
    suite = "noisy" if noisy else "clean"
    base = golden_dir() / suite
    return {
        "signal": base / f"{rhythm_id}.samples.npy",
        "events": base / f"{rhythm_id}.events.json",
        "measurements": base / f"{rhythm_id}.measurements.json",
    }
