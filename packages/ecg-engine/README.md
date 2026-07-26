# ecg-engine

Motor fisiológico de generación de ECG. Paquete Python puro, sin dependencias
de framework web. Trabaja exclusivamente en unidades SI: segundos, voltios y
hercios.

## Uso

```python
from ecg_engine import EcgEngine

engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
signal = engine.generate(500)   # (12, 500) en voltios
```

## Desarrollo

    uv sync --extra dev
    uv run pytest                        # toda la suite
    uv run pytest tests/unit             # solo unitarios
    uv run pytest tests/golden           # regresión de señal
    uv run pytest tests/benchmarks       # rendimiento

## Golden signals

Tres niveles —eventos, muestras y medidas— en dos suites, limpia y con ruido.
Regenerarlos **solo** ante un cambio intencional y documentado del motor:

    uv run python tests/golden/generate_golden.py

## Arquitectura

Dos trenes de eventos independientes, auricular y ventricular, enlazados por
políticas de conducción explícitas. Los ritmos son entradas de catálogo, no
ramas de código. Ver `docs/superpowers/specs/2026-07-25-ecg-simulator-fase1-design.md`.
