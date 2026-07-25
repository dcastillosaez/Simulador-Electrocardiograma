# Plan A — Motor fisiológico `ecg-engine`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el paquete Python `ecg-engine`, capaz de generar los doce ritmos del MVP en las doce derivaciones estándar, de forma determinista y verificada por golden signals.

**Architecture:** Dos trenes de eventos independientes —auricular y ventricular— enlazados por una capa explícita de políticas de conducción. Un scheduler produce eventos cardíacos discretos; un renderer deliberadamente tonto los convierte en muestras. Las patologías morfológicas son overlays sobre la señal base, y los ritmos son entradas de catálogo, nunca ramas de código.

**Tech Stack:** Python 3.12, numpy, pytest, pytest-benchmark, uv para gestión de dependencias.

**Spec:** [`docs/superpowers/specs/2026-07-25-ecg-simulator-fase1-design.md`](../specs/2026-07-25-ecg-simulator-fase1-design.md)

## Global Constraints

Estas reglas aplican a **todas** las tareas de este plan. Los requisitos de cada tarea las incluyen implícitamente.

1. **Unidades SI exclusivamente.** Segundos, voltios, hercios. Ningún milisegundo, milivoltio ni milímetro dentro de `ecg-engine`. Los nombres de variable llevan sufijo de unidad: `_s`, `_v`, `_hz`.
2. **Toda decisión fisiológica ocurre antes del renderer.** `renderer.py` no decide nada: ni cuándo late el corazón, ni si una P conduce, ni cuánto varía el RR.
3. **Toda aleatoriedad pasa por el RNG de sesión** (`numpy.random.Generator`, PCG64). Prohibido `random` global y `np.random.*` sin generador explícito.
4. **Cero casos especiales por ritmo.** Ni un solo `if rhythm_id == "..."` en el motor. Un ritmo es una entrada de catálogo.
5. **Los overlays modifican morfología, nunca ritmo.** No crean, eliminan ni reordenan eventos.
6. **`ecg-engine` no importa nada de `apps/`.** Se ejecuta bajo pytest sin levantar servidor.
7. **Orden fijo de la cadena de señal:** señal base → overlays → variabilidad → ruido aditivo → modulación multiplicativa → clipping.
8. **Orden canónico de derivaciones**, invariable: `I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6`.
9. **Frecuencia de muestreo por defecto:** 500 Hz.
10. **Todas las señales devueltas tienen forma `(12, n_samples)`, dtype `float64`**, en voltios. La conversión a float32 ocurre en la capa de red, fuera de este paquete.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `packages/ecg-engine/pyproject.toml` | Metadatos y dependencias del paquete |
| `src/ecg_engine/__init__.py` | Exporta la API pública y `__version__` |
| `src/ecg_engine/types.py` | **Único** lugar de contratos de dominio |
| `src/ecg_engine/waveform.py` | Gaussianas vectorizadas |
| `src/ecg_engine/beat.py` | Plantillas de latido auricular y ventricular |
| `src/ecg_engine/leads.py` | Proyección a las doce derivaciones |
| `src/ecg_engine/conduction.py` | Políticas de conducción AV |
| `src/ecg_engine/rhythm.py` | Trenes de eventos y scheduler |
| `src/ecg_engine/variability.py` | Oscilador respiratorio y jitter |
| `src/ecg_engine/noise.py` | Artefactos de medición |
| `src/ecg_engine/overlays.py` | `MorphologyOverlay` y su validación |
| `src/ecg_engine/renderer.py` | Eventos → muestras. Nada más |
| `src/ecg_engine/sources.py` | `BeatBasedSource` y `VentricularFibrillationSource` |
| `src/ecg_engine/catalog/definitions.py` | Los doce `RhythmDefinition` |
| `src/ecg_engine/catalog/__init__.py` | `get_rhythm()`, `list_rhythms()` |
| `src/ecg_engine/measurements.py` | Medidas derivadas para golden measurements |
| `src/ecg_engine/engine.py` | Orquestador `EcgEngine` |

Tests espejo en `tests/unit/`, más `tests/golden/` y `tests/benchmarks/`.

---

### Task 1: Scaffolding del paquete

**Files:**
- Create: `packages/ecg-engine/pyproject.toml`
- Create: `packages/ecg-engine/src/ecg_engine/__init__.py`
- Create: `packages/ecg-engine/README.md`
- Test: `packages/ecg-engine/tests/unit/test_package.py`

**Interfaces:**
- Consumes: nada.
- Produces: paquete `ecg_engine` importable, con `ecg_engine.__version__` de tipo `str`.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_package.py`:

```python
import ecg_engine


def test_package_exposes_version():
    assert isinstance(ecg_engine.__version__, str)
    assert ecg_engine.__version__.count(".") == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_package.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/pyproject.toml`:

```toml
[project]
name = "ecg-engine"
version = "1.0.0"
description = "Motor fisiológico de generación de ECG"
requires-python = ">=3.12"
dependencies = ["numpy>=2.0"]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-benchmark>=4.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ecg_engine"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Crear `packages/ecg-engine/src/ecg_engine/__init__.py`:

```python
"""Motor fisiológico de generación de ECG.

Trabaja exclusivamente en unidades SI: segundos, voltios y hercios.
"""

__version__ = "1.0.0"
```

Crear `packages/ecg-engine/README.md`:

```markdown
# ecg-engine

Motor fisiológico de generación de ECG. Paquete Python puro, sin dependencias
de framework web. Trabaja exclusivamente en unidades SI.

## Desarrollo

    uv sync --extra dev
    uv run pytest
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv sync --extra dev && uv run pytest tests/unit/test_package.py -v`
Expected: PASS, 1 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/
git commit -m "Crear scaffolding del paquete ecg-engine"
```

---

### Task 2: Contratos de dominio en `types.py`

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/types.py`
- Test: `packages/ecg-engine/tests/unit/test_types.py`

**Interfaces:**
- Consumes: nada.
- Produces: `LEAD_ORDER: tuple[str, ...]` (12 elementos), `DEFAULT_SAMPLE_RATE_HZ: int = 500`, enums `EventKind` y `WaveTarget`, dataclasses `CardiacEvent`, `GaussianComponent`, `BeatTemplate`, `EngineParams`, `NoiseParams`, y protocolos `SignalSource` y `EventSource`.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_types.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_types.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.types'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/types.py`:

```python
"""Contratos de dominio del motor.

Este módulo es el **único** lugar donde se definen tipos compartidos.
Ningún otro módulo de `ecg_engine` debe declarar dataclasses o protocolos
que crucen fronteras entre módulos.

Unidades SI en todo el módulo: segundos, voltios, hercios.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol, Sequence, runtime_checkable

import numpy as np

LEAD_ORDER: tuple[str, ...] = (
    "I", "II", "III", "aVR", "aVL", "aVF",
    "V1", "V2", "V3", "V4", "V5", "V6",
)
"""Orden canónico de derivaciones. Invariable en todo el sistema."""

N_LEADS: int = len(LEAD_ORDER)

DEFAULT_SAMPLE_RATE_HZ: int = 500


class EventKind(str, Enum):
    """Origen anatómico de un evento cardíaco."""

    ATRIAL = "atrial"
    VENTRICULAR = "ventricular"


class WaveTarget(str, Enum):
    """Conjunto cerrado de componentes que un overlay puede modificar."""

    P = "P"
    PR = "PR"
    QRS = "QRS"
    ST = "ST"
    T = "T"


@dataclass(frozen=True, slots=True)
class CardiacEvent:
    """Un evento cardíaco discreto en la línea temporal.

    `t_s` es el instante de referencia del evento: el pico de la P para los
    auriculares, el pico de la R para los ventriculares.

    `index` es el ordinal del evento dentro de su tren, contado desde el
    origen de la simulación. Es lo que permite que las políticas de
    conducción sean deterministas sin guardar estado entre chunks: un
    Wenckebach calcula su PR a partir del índice, no de cuántas veces se
    le ha llamado.
    """

    kind: EventKind
    t_s: float
    template_id: str
    index: int


@dataclass(frozen=True, slots=True)
class GaussianComponent:
    """Una onda elemental. `center_s` es relativo al instante del evento."""

    target: WaveTarget
    amplitude_v: float
    center_s: float
    width_s: float


@dataclass(frozen=True, slots=True)
class BeatTemplate:
    """Morfología de un evento, como colección de gaussianas."""

    template_id: str
    components: tuple[GaussianComponent, ...]

    def components_for(self, target: WaveTarget) -> tuple[GaussianComponent, ...]:
        return tuple(c for c in self.components if c.target is target)


@dataclass(frozen=True, slots=True)
class NoiseParams:
    """Niveles de artefacto de medición. Todos en voltios, salvo indicación."""

    emg_v: float = 0.0
    mains_v: float = 0.0
    baseline_v: float = 0.0
    motion_v: float = 0.0
    clip_v: float | None = None


@dataclass(frozen=True, slots=True)
class VariabilityParams:
    """Variabilidad fisiológica normal: señal real del paciente."""

    respiration_hz: float = 0.25
    rsa_fraction: float = 0.04
    amplitude_fraction: float = 0.03
    rr_jitter_fraction: float = 0.015


@dataclass(frozen=True, slots=True)
class EngineParams:
    """Parámetros que el motor acepta en caliente."""

    heart_rate_hz: float = 70 / 60
    noise: NoiseParams = field(default_factory=NoiseParams)
    variability: VariabilityParams = field(default_factory=VariabilityParams)


@runtime_checkable
class EventSource(Protocol):
    """Fuente que produce eventos cardíacos discretos."""

    def events(self, t0_s: float, t1_s: float) -> Sequence[CardiacEvent]: ...


@runtime_checkable
class SignalSource(Protocol):
    """Interfaz pública de toda fuente de señal, con o sin latidos discretos."""

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_types.py -v`
Expected: PASS, 7 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/types.py packages/ecg-engine/tests/unit/test_types.py
git commit -m "Añadir contratos de dominio del motor"
```

---

### Task 3: Gaussianas en `waveform.py`

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/waveform.py`
- Test: `packages/ecg-engine/tests/unit/test_waveform.py`

**Interfaces:**
- Consumes: `GaussianComponent` de `types.py`.
- Produces:
  - `gaussian(t_s: np.ndarray, amplitude_v: float, center_s: float, width_s: float) -> np.ndarray`
  - `render_component(t_s: np.ndarray, component: GaussianComponent, offset_s: float) -> np.ndarray`
  - `fwhm_s(width_s: float) -> float`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_waveform.py`:

```python
import numpy as np
import pytest

from ecg_engine.types import GaussianComponent, WaveTarget
from ecg_engine.waveform import fwhm_s, gaussian, render_component


def test_gaussian_peaks_at_center_with_given_amplitude():
    t = np.linspace(-0.1, 0.1, 2001)
    y = gaussian(t, amplitude_v=0.001, center_s=0.0, width_s=0.01)
    assert y.max() == pytest.approx(0.001, rel=1e-6)
    assert t[int(np.argmax(y))] == pytest.approx(0.0, abs=1e-4)


def test_gaussian_fwhm_matches_analytic_value():
    width = 0.01
    t = np.linspace(-0.2, 0.2, 40001)
    y = gaussian(t, amplitude_v=1.0, center_s=0.0, width_s=width)
    above_half = t[y >= 0.5]
    measured = above_half.max() - above_half.min()
    assert measured == pytest.approx(fwhm_s(width), rel=1e-3)


def test_fwhm_is_2_sqrt_2_ln2_times_sigma():
    assert fwhm_s(1.0) == pytest.approx(2.3548200, rel=1e-6)


def test_negative_amplitude_produces_a_trough():
    t = np.linspace(-0.05, 0.05, 1001)
    y = gaussian(t, amplitude_v=-0.0002, center_s=0.0, width_s=0.008)
    assert y.min() == pytest.approx(-0.0002, rel=1e-6)


def test_render_component_shifts_by_event_offset():
    t = np.linspace(0.0, 2.0, 2001)
    component = GaussianComponent(
        target=WaveTarget.QRS, amplitude_v=0.001, center_s=0.0, width_s=0.01
    )
    y = render_component(t, component, offset_s=1.0)
    assert t[int(np.argmax(y))] == pytest.approx(1.0, abs=1e-3)


def test_gaussian_is_vectorised_and_preserves_shape():
    t = np.linspace(-1.0, 1.0, 137)
    y = gaussian(t, amplitude_v=1.0, center_s=0.0, width_s=0.1)
    assert y.shape == t.shape
    assert y.dtype == np.float64
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_waveform.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.waveform'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/waveform.py`:

```python
"""Ondas elementales del latido, como gaussianas paramétricas.

Cada onda —P, Q, R, S, T— es una gaussiana definida por amplitud, centro y
anchura. Las patologías morfológicas se obtienen moviendo esos parámetros.
"""

from __future__ import annotations

import numpy as np

from .types import GaussianComponent

_FWHM_FACTOR: float = 2.0 * np.sqrt(2.0 * np.log(2.0))


def gaussian(
    t_s: np.ndarray, amplitude_v: float, center_s: float, width_s: float
) -> np.ndarray:
    """Evalúa una gaussiana sobre el vector de tiempos `t_s`.

    `width_s` es la desviación típica, no la anchura a media altura.
    """
    if width_s <= 0.0:
        raise ValueError(f"width_s debe ser positivo, recibido {width_s}")
    z = (np.asarray(t_s, dtype=np.float64) - center_s) / width_s
    return amplitude_v * np.exp(-0.5 * z * z)


def render_component(
    t_s: np.ndarray, component: GaussianComponent, offset_s: float
) -> np.ndarray:
    """Evalúa una componente desplazada al instante de su evento."""
    return gaussian(
        t_s,
        amplitude_v=component.amplitude_v,
        center_s=offset_s + component.center_s,
        width_s=component.width_s,
    )


def fwhm_s(width_s: float) -> float:
    """Anchura a media altura de una gaussiana de desviación típica `width_s`."""
    return _FWHM_FACTOR * width_s
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_waveform.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/waveform.py packages/ecg-engine/tests/unit/test_waveform.py
git commit -m "Añadir gaussianas paramétricas del motor"
```

---

### Task 4: Plantillas de latido en `beat.py`

Las plantillas son morfología pura: no saben nada de ritmo ni de frecuencia. Un evento auricular renderiza una plantilla de P; uno ventricular renderiza QRS+ST+T. Que sean dos plantillas separadas es lo que hace posible el modelo de dos trenes.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/beat.py`
- Test: `packages/ecg-engine/tests/unit/test_beat.py`

**Interfaces:**
- Consumes: `BeatTemplate`, `GaussianComponent`, `WaveTarget` de `types.py`; `fwhm_s` de `waveform.py`.
- Produces:
  - `TEMPLATES: dict[str, BeatTemplate]` con las claves `"sinus_p"`, `"flutter_f"`, `"normal_qrst"`, `"wide_qrst"`, `"escape_qrst"`.
  - `get_template(template_id: str) -> BeatTemplate` — lanza `KeyError` con mensaje explícito si no existe.
  - `target_extent_s(template: BeatTemplate, target: WaveTarget) -> tuple[float, float]` — extensión (inicio, fin) del target a ±2σ, relativa al instante del evento.
  - `qrs_duration_s(template: BeatTemplate) -> float`
  - `qt_duration_s(template: BeatTemplate) -> float`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_beat.py`:

```python
import pytest

from ecg_engine.beat import (
    TEMPLATES,
    get_template,
    qrs_duration_s,
    qt_duration_s,
    target_extent_s,
)
from ecg_engine.types import WaveTarget


def test_registry_contains_the_five_mvp_templates():
    assert set(TEMPLATES) == {
        "sinus_p", "flutter_f", "normal_qrst", "wide_qrst", "escape_qrst",
    }


def test_get_template_raises_with_an_explicit_message():
    with pytest.raises(KeyError, match="no_existe"):
        get_template("no_existe")


def test_atrial_template_only_has_p_components():
    template = get_template("sinus_p")
    assert {c.target for c in template.components} == {WaveTarget.P}


def test_ventricular_template_has_qrs_st_and_t():
    template = get_template("normal_qrst")
    assert {c.target for c in template.components} == {
        WaveTarget.QRS, WaveTarget.ST, WaveTarget.T,
    }


def test_normal_qrs_duration_is_physiological():
    """QRS normal: entre 80 y 100 ms."""
    duration = qrs_duration_s(get_template("normal_qrst"))
    assert 0.080 <= duration <= 0.100


def test_wide_qrs_exceeds_120_ms():
    """Criterio clínico de QRS ancho."""
    assert qrs_duration_s(get_template("wide_qrst")) > 0.120


def test_normal_qt_is_physiological():
    """QT normal a frecuencia de reposo: entre 350 y 440 ms."""
    qt = qt_duration_s(get_template("normal_qrst"))
    assert 0.350 <= qt <= 0.440


def test_target_extent_covers_two_sigma_each_side():
    template = get_template("normal_qrst")
    start, end = target_extent_s(template, WaveTarget.QRS)
    assert start < 0.0 < end


def test_target_extent_of_absent_target_is_empty():
    assert target_extent_s(get_template("sinus_p"), WaveTarget.T) == (0.0, 0.0)


def test_r_wave_is_the_dominant_positive_deflection():
    components = get_template("normal_qrst").components
    amplitudes = [c.amplitude_v for c in components]
    assert max(amplitudes) == pytest.approx(0.0010, abs=1e-4)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_beat.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.beat'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/beat.py`:

```python
"""Plantillas morfológicas de latido.

Las plantillas son morfología pura: no saben nada de frecuencia ni de ritmo.
Hay dos familias, y esa separación es lo que sostiene el modelo de dos trenes:

- Auriculares (`sinus_p`, `flutter_f`): solo componentes P.
- Ventriculares (`normal_qrst`, `wide_qrst`, `escape_qrst`): QRS, ST y T.

Todos los `center_s` son relativos al instante de referencia del evento: el
pico de la P en las auriculares, el pico de la R en las ventriculares.

Amplitudes en voltios. Un ECG normal tiene una R de en torno a 1 mV en II,
es decir 0,001 V.
"""

from __future__ import annotations

from .types import BeatTemplate, GaussianComponent, WaveTarget

_SIGMA_EXTENT: float = 2.0
"""Cuántas desviaciones típicas a cada lado se consideran parte de la onda."""


def _p(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.P, amplitude_v=amplitude_v, center_s=center_s, width_s=width_s
    )


def _qrs(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.QRS,
        amplitude_v=amplitude_v,
        center_s=center_s,
        width_s=width_s,
    )


def _st(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.ST,
        amplitude_v=amplitude_v,
        center_s=center_s,
        width_s=width_s,
    )


def _t(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.T, amplitude_v=amplitude_v, center_s=center_s, width_s=width_s
    )


TEMPLATES: dict[str, BeatTemplate] = {
    # --- Auriculares -------------------------------------------------------
    "sinus_p": BeatTemplate(
        template_id="sinus_p",
        components=(_p(0.00012, 0.0, 0.011),),
    ),
    # Onda F de flutter: más amplia y puntiaguda, sin línea isoeléctrica
    # entre ondas cuando el tren va a 300/min.
    "flutter_f": BeatTemplate(
        template_id="flutter_f",
        components=(_p(0.00020, 0.0, 0.018),),
    ),
    # --- Ventriculares -----------------------------------------------------
    "normal_qrst": BeatTemplate(
        template_id="normal_qrst",
        components=(
            _qrs(-0.00005, -0.019, 0.0043),   # Q
            _qrs(0.00100, 0.000, 0.0080),     # R
            _qrs(-0.00015, 0.021, 0.0055),    # S
            _st(0.00000, 0.090, 0.0300),      # segmento ST, isoeléctrico
            _t(0.00025, 0.230, 0.0430),       # T
        ),
    ),
    # QRS ancho de origen ventricular: R ensanchada y T de polaridad opuesta.
    "wide_qrst": BeatTemplate(
        template_id="wide_qrst",
        components=(
            _qrs(0.00110, 0.000, 0.0290),
            _st(0.00000, 0.110, 0.0350),
            _t(-0.00030, 0.280, 0.0520),
        ),
    ),
    # Escape ventricular del bloqueo completo: ancho y de menor voltaje.
    "escape_qrst": BeatTemplate(
        template_id="escape_qrst",
        components=(
            _qrs(0.00080, 0.000, 0.0260),
            _st(0.00000, 0.120, 0.0350),
            _t(-0.00022, 0.300, 0.0550),
        ),
    ),
}


def get_template(template_id: str) -> BeatTemplate:
    try:
        return TEMPLATES[template_id]
    except KeyError as exc:
        known = ", ".join(sorted(TEMPLATES))
        raise KeyError(
            f"plantilla desconocida: {template_id!r}. Conocidas: {known}"
        ) from exc


def target_extent_s(
    template: BeatTemplate, target: WaveTarget
) -> tuple[float, float]:
    """Extensión temporal de un target, a ±2σ, relativa al evento."""
    components = template.components_for(target)
    if not components:
        return (0.0, 0.0)
    start = min(c.center_s - _SIGMA_EXTENT * c.width_s for c in components)
    end = max(c.center_s + _SIGMA_EXTENT * c.width_s for c in components)
    return (start, end)


def qrs_duration_s(template: BeatTemplate) -> float:
    start, end = target_extent_s(template, WaveTarget.QRS)
    return end - start


def qt_duration_s(template: BeatTemplate) -> float:
    """Del inicio del QRS al final de la T."""
    qrs_start, _ = target_extent_s(template, WaveTarget.QRS)
    _, t_end = target_extent_s(template, WaveTarget.T)
    return t_end - qrs_start
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_beat.py -v`
Expected: PASS, 10 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/beat.py packages/ecg-engine/tests/unit/test_beat.py
git commit -m "Añadir plantillas morfológicas de latido"
```

---

### Task 5: Proyección a derivaciones en `leads.py`

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/leads.py`
- Test: `packages/ecg-engine/tests/unit/test_leads.py`

**Interfaces:**
- Consumes: `LEAD_ORDER`, `N_LEADS` de `types.py`.
- Produces:
  - `LeadProjection` — dataclass congelada con `coefficients: tuple[float, ...]` de 12 elementos y método `as_column() -> np.ndarray` de forma `(12, 1)`.
  - `NORMAL_AXIS_PROJECTION: LeadProjection` — eje cardíaco normal.
  - `ATRIAL_PROJECTION: LeadProjection` — la P proyecta distinto que el QRS.
  - `projection_from_mapping(mapping: dict[str, float]) -> LeadProjection`
  - `project(trace_v: np.ndarray, projection: LeadProjection) -> np.ndarray` — de `(n,)` a `(12, n)`.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_leads.py`:

```python
import numpy as np
import pytest

from ecg_engine.leads import (
    ATRIAL_PROJECTION,
    NORMAL_AXIS_PROJECTION,
    LeadProjection,
    project,
    projection_from_mapping,
)
from ecg_engine.types import LEAD_ORDER, N_LEADS


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.leads'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/leads.py`:

```python
"""Proyección de una traza canónica a las doce derivaciones.

El MVP no modela el dipolo cardíaco en 3D. Usa una tabla de coeficientes por
derivación, que es suficiente para docencia y deja abierta la migración a un
modelo vectorial en fase 4 sin tocar la API pública.

Los coeficientes respetan dos restricciones clínicas que los tests verifican:
la ley de Einthoven (I + III = II) y la progresión de la onda R de V1 a V5.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from .types import LEAD_ORDER, N_LEADS


@dataclass(frozen=True, slots=True)
class LeadProjection:
    """Coeficiente de proyección por derivación, en orden canónico."""

    coefficients: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.coefficients) != N_LEADS:
            raise ValueError(
                f"se esperaban {N_LEADS} coeficientes, "
                f"recibidos {len(self.coefficients)}"
            )

    def as_column(self) -> np.ndarray:
        """Vector columna `(12, 1)`, listo para multiplicar por una traza."""
        return np.asarray(self.coefficients, dtype=np.float64).reshape(N_LEADS, 1)


def projection_from_mapping(mapping: Mapping[str, float]) -> LeadProjection:
    """Construye una proyección desde un diccionario derivación → coeficiente.

    Exige exactamente las doce derivaciones canónicas: ni una de más, ni una
    de menos. Un typo en el nombre de una derivación es un error, no un
    coeficiente por defecto silencioso.
    """
    unknown = sorted(set(mapping) - set(LEAD_ORDER))
    if unknown:
        raise ValueError(f"derivaciones desconocidas: {', '.join(unknown)}")
    missing = sorted(set(LEAD_ORDER) - set(mapping))
    if missing:
        raise ValueError(f"faltan derivaciones: {', '.join(missing)}")
    return LeadProjection(coefficients=tuple(float(mapping[l]) for l in LEAD_ORDER))


# Eje cardíaco normal, en torno a +60°. II es la derivación dominante y aVR
# es negativa, como en cualquier ECG bien registrado.
NORMAL_AXIS_PROJECTION: LeadProjection = projection_from_mapping(
    {
        "I": 0.50,
        "II": 1.00,
        "III": 0.50,
        "aVR": -0.75,
        "aVL": 0.00,
        "aVF": 0.75,
        "V1": -0.30,
        "V2": 0.10,
        "V3": 0.60,
        "V4": 1.10,
        "V5": 1.20,
        "V6": 0.90,
    }
)

# La despolarización auricular sigue un eje distinto y tiene menos voltaje en
# precordiales derechas. Por eso la P no se proyecta como el QRS.
ATRIAL_PROJECTION: LeadProjection = projection_from_mapping(
    {
        "I": 0.60,
        "II": 1.00,
        "III": 0.40,
        "aVR": -0.80,
        "aVL": 0.10,
        "aVF": 0.70,
        "V1": 0.40,
        "V2": 0.50,
        "V3": 0.45,
        "V4": 0.40,
        "V5": 0.35,
        "V6": 0.30,
    }
)


def project(trace_v: np.ndarray, projection: LeadProjection) -> np.ndarray:
    """Expande una traza `(n,)` a `(12, n)` aplicando los coeficientes."""
    trace = np.asarray(trace_v, dtype=np.float64)
    if trace.ndim != 1:
        raise ValueError(f"se esperaba una traza 1-D, recibida {trace.ndim}-D")
    return projection.as_column() * trace[np.newaxis, :]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -v`
Expected: PASS, 12 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/leads.py packages/ecg-engine/tests/unit/test_leads.py
git commit -m "Añadir proyección a las doce derivaciones"
```

---

### Task 6: Políticas de conducción en `conduction.py`

Aquí vive toda la lógica de bloqueos. El tren auricular no sabe nada de esto: emite ondas P y punto. Estas políticas deciden cuáles conducen y con qué PR.

Cada política es **determinista a partir del índice del evento**, no de cuántas veces se la haya llamado. Eso es lo que permite renderizar por chunks sin que el resultado dependa de dónde caigan las fronteras.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/conduction.py`
- Test: `packages/ecg-engine/tests/unit/test_conduction.py`

**Interfaces:**
- Consumes: `CardiacEvent`, `EventKind` de `types.py`.
- Produces:
  - `ConductionPolicy` — Protocol con `conduct(atrial: Sequence[CardiacEvent], rng: np.random.Generator) -> list[CardiacEvent]`.
  - `FixedPR(pr_s: float, template_id: str = "normal_qrst")`
  - `WenckebachPR(pr_base_s: float, pr_increment_s: float, cycle_length: int, template_id: str = "normal_qrst")`
  - `FixedRatioBlock(ratio: int, pr_s: float, template_id: str = "normal_qrst")`
  - `CompleteBlock()` — no conduce nada; el escape lo aporta otra fuente.
  - `IrregularConduction(mean_rr_s: float, rr_spread_s: float, template_id: str = "normal_qrst")`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_conduction.py`:

```python
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
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    atrial = atrial_train(200, interval_s=0.006)
    first = policy.conduct(atrial, np.random.default_rng(7))
    second = policy.conduct(atrial, np.random.default_rng(7))
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_conducted_events_carry_the_configured_template(rng):
    ventricular = FixedPR(pr_s=0.16, template_id="wide_qrst").conduct(
        atrial_train(3), rng
    )
    assert all(e.template_id == "wide_qrst" for e in ventricular)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_conduction.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.conduction'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/conduction.py`:

```python
"""Políticas de conducción auriculoventricular.

El tren auricular emite ondas P y no sabe nada de bloqueos. Estas políticas
consumen esos eventos y deciden cuáles conducen y con qué PR.

Toda política es determinista **a partir del índice del evento**, nunca del
número de llamadas recibidas. Ese detalle es lo que permite renderizar la
señal por chunks sin que el resultado dependa de dónde caigan las fronteras.

Añadir Mobitz II o preexcitación consiste en escribir una política nueva
aquí, sin tocar los trenes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence, runtime_checkable

import numpy as np

from .types import CardiacEvent, EventKind


@runtime_checkable
class ConductionPolicy(Protocol):
    """Convierte eventos auriculares en eventos ventriculares."""

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]: ...


def _ventricular(source: CardiacEvent, pr_s: float, template_id: str) -> CardiacEvent:
    """Crea el QRS que resulta de conducir una P, conservando su índice."""
    return CardiacEvent(
        kind=EventKind.VENTRICULAR,
        t_s=source.t_s + pr_s,
        template_id=template_id,
        index=source.index,
    )


@dataclass(frozen=True, slots=True)
class FixedPR:
    """Conducción 1:1 con PR constante.

    Cubre el ritmo sinusal, las taquicardias y bradicardias sinusales, la
    TSV y —con un `pr_s` largo— el bloqueo AV de primer grado. El bloqueo de
    primer grado no merece una política propia: es exactamente esto.
    """

    pr_s: float
    template_id: str = "normal_qrst"

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        return [_ventricular(p, self.pr_s, self.template_id) for p in atrial]


@dataclass(frozen=True, slots=True)
class WenckebachPR:
    """Mobitz I: el PR se alarga hasta que un latido no conduce.

    Dentro de cada ciclo de `cycle_length` ondas P, la posición `i` conduce
    con `pr_base_s + i * pr_increment_s`, salvo la última, que se bloquea.
    Tras la caída, el PR vuelve al valor base.
    """

    pr_base_s: float
    pr_increment_s: float
    cycle_length: int
    template_id: str = "normal_qrst"

    def __post_init__(self) -> None:
        if self.cycle_length < 2:
            raise ValueError(
                f"cycle_length debe ser al menos 2, recibido {self.cycle_length}"
            )

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        conducted: list[CardiacEvent] = []
        for p in atrial:
            position = p.index % self.cycle_length
            if position == self.cycle_length - 1:
                continue  # latido caído
            pr_s = self.pr_base_s + position * self.pr_increment_s
            conducted.append(_ventricular(p, pr_s, self.template_id))
        return conducted


@dataclass(frozen=True, slots=True)
class FixedRatioBlock:
    """Conducción n:1 con PR constante.

    Es la política del flutter auricular (2:1, 4:1) y serviría igual para un
    Mobitz II, que no entra en el MVP.
    """

    ratio: int
    pr_s: float
    template_id: str = "normal_qrst"

    def __post_init__(self) -> None:
        if self.ratio < 2:
            raise ValueError(f"ratio debe ser al menos 2, recibido {self.ratio}")

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        return [
            _ventricular(p, self.pr_s, self.template_id)
            for p in atrial
            if p.index % self.ratio == 0
        ]


@dataclass(frozen=True, slots=True)
class CompleteBlock:
    """BAV de tercer grado: ninguna P alcanza el ventrículo.

    Los QRS no desaparecen: los aporta una fuente de escape ventricular
    independiente, configurada en el catálogo. Aquí simplemente no se
    conduce nada, que es justo lo que ocurre en el nodo AV.
    """

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        return []


@dataclass(frozen=True, slots=True)
class IrregularConduction:
    """Conducción irregular de la fibrilación auricular.

    La actividad auricular en la FA es caótica y de alta frecuencia. El nodo
    AV deja pasar impulsos de forma impredecible, y el resultado es un RR
    genuinamente irregular, no un RR regular con ruido encima.

    La implementación recorre la ventana temporal cubierta por los eventos
    auriculares y coloca QRS separados por intervalos extraídos de una
    distribución normal truncada. Es determinista para un `rng` dado.
    """

    mean_rr_s: float
    rr_spread_s: float
    template_id: str = "normal_qrst"
    _min_rr_s: float = 0.24

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        if not atrial:
            return []
        start_s = atrial[0].t_s
        end_s = atrial[-1].t_s
        conducted: list[CardiacEvent] = []
        t_s = start_s
        index = 0
        while t_s <= end_s:
            conducted.append(
                CardiacEvent(
                    kind=EventKind.VENTRICULAR,
                    t_s=t_s,
                    template_id=self.template_id,
                    index=index,
                )
            )
            step_s = float(rng.normal(self.mean_rr_s, self.rr_spread_s))
            t_s += max(step_s, self._min_rr_s)
            index += 1
        return conducted
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_conduction.py -v`
Expected: PASS, 13 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/conduction.py packages/ecg-engine/tests/unit/test_conduction.py
git commit -m "Añadir políticas de conducción auriculoventricular"
```

---

### Task 7: Variabilidad fisiológica en `variability.py`

Esto es **señal real del paciente**, no ruido: estaría presente aunque el electrodo fuera perfecto. Un único oscilador respiratorio alimenta a la vez la arritmia sinusal respiratoria y la variación de amplitud latido a latido. Que compartan oscilador es lo que hace que el trazo respire de forma coherente en lugar de temblar al azar en tres direcciones.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/variability.py`
- Test: `packages/ecg-engine/tests/unit/test_variability.py`

**Interfaces:**
- Consumes: `VariabilityParams` de `types.py`.
- Produces:
  - `respiratory_phase(t_s: np.ndarray | float, respiration_hz: float) -> np.ndarray` — seno en `[-1, 1]`.
  - `amplitude_scale(t_s: np.ndarray, params: VariabilityParams) -> np.ndarray` — factor multiplicativo en torno a 1.
  - `next_rr_s(base_rr_s: float, t_s: float, params: VariabilityParams, rng: np.random.Generator) -> float`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_variability.py`:

```python
import numpy as np
import pytest

from ecg_engine.types import VariabilityParams
from ecg_engine.variability import amplitude_scale, next_rr_s, respiratory_phase


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_respiratory_phase_stays_within_unit_range():
    t = np.linspace(0.0, 60.0, 30001)
    phase = respiratory_phase(t, respiration_hz=0.25)
    assert phase.min() >= -1.0
    assert phase.max() <= 1.0


def test_respiratory_phase_completes_one_cycle_per_period():
    """A 0,25 Hz el ciclo dura 4 s: la fase vuelve a 0 en t=4."""
    assert respiratory_phase(0.0, 0.25) == pytest.approx(0.0, abs=1e-12)
    assert respiratory_phase(4.0, 0.25) == pytest.approx(0.0, abs=1e-9)
    assert respiratory_phase(1.0, 0.25) == pytest.approx(1.0, abs=1e-9)


def test_amplitude_scale_oscillates_around_one():
    t = np.linspace(0.0, 40.0, 20001)
    scale = amplitude_scale(t, VariabilityParams(amplitude_fraction=0.03))
    assert scale.mean() == pytest.approx(1.0, abs=1e-3)
    assert scale.max() == pytest.approx(1.03, abs=1e-3)
    assert scale.min() == pytest.approx(0.97, abs=1e-3)


def test_amplitude_scale_is_flat_when_variability_is_disabled():
    t = np.linspace(0.0, 10.0, 101)
    scale = amplitude_scale(t, VariabilityParams(amplitude_fraction=0.0))
    assert np.allclose(scale, 1.0)


def test_rr_modulation_follows_the_same_respiratory_oscillator(rng):
    """La arritmia sinusal respiratoria y la amplitud comparten oscilador:
    en el pico inspiratorio el RR se acorta y la amplitud sube."""
    params = VariabilityParams(
        respiration_hz=0.25, rsa_fraction=0.04, rr_jitter_fraction=0.0
    )
    peak_rr = next_rr_s(1.0, t_s=1.0, params=params, rng=rng)
    trough_rr = next_rr_s(1.0, t_s=3.0, params=params, rng=rng)
    assert peak_rr < trough_rr
    assert peak_rr == pytest.approx(0.96, abs=1e-6)
    assert trough_rr == pytest.approx(1.04, abs=1e-6)


def test_rr_jitter_is_small_and_random(rng):
    params = VariabilityParams(rsa_fraction=0.0, rr_jitter_fraction=0.015)
    values = [next_rr_s(1.0, t_s=0.0, params=params, rng=rng) for _ in range(500)]
    assert np.std(values) == pytest.approx(0.015, abs=0.004)
    assert np.mean(values) == pytest.approx(1.0, abs=0.003)


def test_rr_never_goes_non_positive(rng):
    """Un jitter absurdo no debe poder producir un RR negativo."""
    params = VariabilityParams(rsa_fraction=0.0, rr_jitter_fraction=5.0)
    values = [next_rr_s(0.8, t_s=0.0, params=params, rng=rng) for _ in range(1000)]
    assert min(values) > 0.0


def test_rr_is_deterministic_for_a_given_seed():
    params = VariabilityParams()
    first = [
        next_rr_s(0.85, t_s=i * 0.85, params=params, rng=np.random.default_rng(3))
        for i in range(5)
    ]
    second = [
        next_rr_s(0.85, t_s=i * 0.85, params=params, rng=np.random.default_rng(3))
        for i in range(5)
    ]
    assert first == pytest.approx(second)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_variability.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.variability'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/variability.py`:

```python
"""Variabilidad fisiológica normal.

Esto **no es ruido**. Es señal real del paciente: estaría presente aunque el
electrodo fuera perfecto. La frontera importa, y los tests la respetan: los
de fisiología corren con el ruido a cero, los de ruido sobre señal conocida.

Un único oscilador respiratorio alimenta a la vez la arritmia sinusal
respiratoria y la variación de amplitud latido a latido. Compartir oscilador
no es un atajo: es lo que ocurre de verdad, y hace que el trazo respire de
forma coherente en lugar de temblar al azar.

La deriva de línea base también se alimenta de este oscilador, pero vive en
`noise.py` porque es un artefacto de medición —impedancia cambiante por el
movimiento del tórax— aunque su origen sea fisiológico.
"""

from __future__ import annotations

import numpy as np

from .types import VariabilityParams


def respiratory_phase(
    t_s: np.ndarray | float, respiration_hz: float
) -> np.ndarray:
    """Fase del ciclo respiratorio, normalizada a `[-1, 1]`.

    El máximo corresponde al pico inspiratorio, donde el RR se acorta.
    """
    return np.sin(2.0 * np.pi * respiration_hz * np.asarray(t_s, dtype=np.float64))


def amplitude_scale(t_s: np.ndarray, params: VariabilityParams) -> np.ndarray:
    """Factor multiplicativo de amplitud, oscilando en torno a 1."""
    phase = respiratory_phase(t_s, params.respiration_hz)
    return 1.0 + params.amplitude_fraction * phase


def next_rr_s(
    base_rr_s: float,
    t_s: float,
    params: VariabilityParams,
    rng: np.random.Generator,
) -> float:
    """Intervalo RR siguiente, con arritmia sinusal respiratoria y jitter.

    En el pico inspiratorio el RR se **acorta**, de ahí el signo negativo:
    es el reflejo de Bainbridge, y es la razón de que el pulso de una persona
    joven y sana no sea un metrónomo.
    """
    phase = float(respiratory_phase(t_s, params.respiration_hz))
    rsa_factor = 1.0 - params.rsa_fraction * phase
    jitter = float(rng.normal(0.0, params.rr_jitter_fraction))
    rr_s = base_rr_s * rsa_factor * (1.0 + jitter)
    return max(rr_s, 0.05 * base_rr_s)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_variability.py -v`
Expected: PASS, 8 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/variability.py packages/ecg-engine/tests/unit/test_variability.py
git commit -m "Añadir variabilidad fisiológica con oscilador respiratorio compartido"
```

---

### Task 8: Trenes de eventos en `rhythm.py`

Un tren emite eventos a su propia frecuencia y **no sabe nada de conducción**. El tren auricular emite ondas P; el de escape ventricular emite QRS cuando el nodo AV no conduce.

El jitter del RR se extrae del RNG de forma secuencial, así que la línea temporal se genera hacia adelante desde el origen y se cachea. Esa caché es lo que garantiza que renderizar por chunks dé exactamente el mismo resultado que renderizar de una vez.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/rhythm.py`
- Test: `packages/ecg-engine/tests/unit/test_rhythm.py`

**Interfaces:**
- Consumes: `CardiacEvent`, `EventKind`, `VariabilityParams` de `types.py`; `next_rr_s` de `variability.py`.
- Produces:
  - `EventTrain(kind: EventKind, template_id: str, rate_hz: float, variability: VariabilityParams, rng: np.random.Generator)` — con métodos `events(t0_s, t1_s) -> list[CardiacEvent]` y `set_rate_hz(rate_hz: float) -> None`.
  - `RegularTrain(...)` — variante sin variabilidad, para flutter y taquicardias de reentrada.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_rhythm.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_rhythm.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.rhythm'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/rhythm.py`:

```python
"""Trenes de eventos cardíacos.

Un tren emite eventos a su propia frecuencia y no sabe nada de conducción.
El tren auricular emite ondas P; el de escape ventricular emite QRS cuando
el nodo AV no conduce nada.

Dos implementaciones:

- `EventTrain` incorpora variabilidad fisiológica, así que su jitter consume
  el RNG de forma secuencial. La línea temporal se genera hacia adelante
  desde el origen y se cachea; esa caché es lo que garantiza que renderizar
  por chunks dé el mismo resultado que renderizar de una vez.
- `RegularTrain` es un metrónomo puro, sin estado ni RNG. Sirve para el
  flutter a 300/min y para los escapes, donde la variabilidad no aporta
  realismo sino confusión.

Las ventanas son semiabiertas `[t0, t1)`, de modo que chunks consecutivos
nunca duplican un evento.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .types import CardiacEvent, EventKind, VariabilityParams
from .variability import next_rr_s


class EventTrain:
    """Tren con variabilidad fisiológica y línea temporal cacheada."""

    def __init__(
        self,
        kind: EventKind,
        template_id: str,
        rate_hz: float,
        variability: VariabilityParams,
        rng: np.random.Generator,
    ) -> None:
        if rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {rate_hz}")
        self.kind = kind
        self.template_id = template_id
        self._rate_hz = rate_hz
        self._variability = variability
        self._rng = rng
        self._times_s: list[float] = [0.0]

    def set_rate_hz(self, rate_hz: float) -> None:
        """Cambia la frecuencia. Solo afecta a los eventos aún no generados."""
        if rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {rate_hz}")
        self._rate_hz = rate_hz

    def _extend_until(self, t_s: float) -> None:
        while self._times_s[-1] < t_s:
            last_s = self._times_s[-1]
            rr_s = next_rr_s(
                base_rr_s=1.0 / self._rate_hz,
                t_s=last_s,
                params=self._variability,
                rng=self._rng,
            )
            self._times_s.append(last_s + rr_s)

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        self._extend_until(t1_s)
        return [
            CardiacEvent(
                kind=self.kind,
                t_s=t_s,
                template_id=self.template_id,
                index=index,
            )
            for index, t_s in enumerate(self._times_s)
            if t0_s <= t_s < t1_s
        ]


@dataclass(frozen=True, slots=True)
class RegularTrain:
    """Tren perfectamente regular: sin variabilidad, sin estado, sin RNG."""

    kind: EventKind
    template_id: str
    rate_hz: float

    def __post_init__(self) -> None:
        if self.rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {self.rate_hz}")

    def set_rate_hz(self, rate_hz: float) -> None:
        raise TypeError(
            "RegularTrain es inmutable; construye uno nuevo para cambiar la "
            "frecuencia"
        )

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        interval_s = 1.0 / self.rate_hz
        first = max(0, math.ceil(t0_s / interval_s))
        last = math.ceil(t1_s / interval_s)
        return [
            CardiacEvent(
                kind=self.kind,
                t_s=index * interval_s,
                template_id=self.template_id,
                index=index,
            )
            for index in range(first, last)
            if t0_s <= index * interval_s < t1_s
        ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_rhythm.py -v`
Expected: PASS, 13 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/rhythm.py packages/ecg-engine/tests/unit/test_rhythm.py
git commit -m "Añadir trenes de eventos auricular y ventricular"
```

---
