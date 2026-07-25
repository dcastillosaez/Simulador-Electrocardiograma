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

### Task 9: Overlays morfológicos en `overlays.py`

Un overlay declara **explícitamente su alcance** y el motor lo hace cumplir. Sin esa restricción, un overlay de isquemia acabaría alterando de rebote la onda P y el bug sería casi imposible de localizar: el trazo seguiría pareciendo plausible.

Los overlays aportan componentes **aditivas** limitadas a las derivaciones que declaran. Nunca crean, eliminan ni reordenan eventos: eso es ritmo, no morfología.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/overlays.py`
- Test: `packages/ecg-engine/tests/unit/test_overlays.py`

**Interfaces:**
- Consumes: `GaussianComponent`, `WaveTarget`, `LEAD_ORDER`, `N_LEADS` de `types.py`.
- Produces:
  - `OverlayScopeError(ValueError)`
  - `OverlayRule(target: WaveTarget, amplitude_v: float, center_s: float, width_s: float)`
  - `MorphologyOverlay(overlay_id: str, targets: frozenset[WaveTarget], leads: tuple[str, ...], rules: tuple[OverlayRule, ...])` con `components() -> tuple[GaussianComponent, ...]` y `lead_mask() -> np.ndarray` de forma `(12, 1)`.
  - `ST_ELEVATION_INFERIOR: MorphologyOverlay`
  - `OVERLAYS: dict[str, MorphologyOverlay]` y `get_overlay(overlay_id: str) -> MorphologyOverlay`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_overlays.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_overlays.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.overlays'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/overlays.py`:

```python
"""Overlays morfológicos.

Un overlay modifica **morfología**, nunca ritmo: no crea, elimina ni reordena
eventos cardíacos. Si algo necesita cambiar cuándo late el corazón, eso es
una política de conducción o una fuente de ritmo.

Cada overlay declara explícitamente su alcance —qué componentes toca y en qué
derivaciones— y el motor lo hace cumplir. Un overlay que intente modificar
algo fuera de sus `targets` declarados es un error de construcción, no un
aviso: sin esa barrera, un overlay de isquemia acabaría alterando de rebote
la onda P y ese bug sería endiabladamente difícil de localizar, porque el
trazo seguiría pareciendo plausible.

El IAM con elevación del ST no es un ritmo: es sinusal normal más este
overlay. Ese patrón es el que servirá en fase 2 para pericarditis,
hiperpotasemia e hipopotasemia.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .types import LEAD_ORDER, N_LEADS, GaussianComponent, WaveTarget


class OverlayScopeError(ValueError):
    """Un overlay intentó modificar algo fuera de sus targets declarados."""


@dataclass(frozen=True, slots=True)
class OverlayRule:
    """Contribución aditiva a un componente del latido."""

    target: WaveTarget
    amplitude_v: float
    center_s: float
    width_s: float


@dataclass(frozen=True, slots=True)
class MorphologyOverlay:
    """Modificación morfológica de alcance declarado y verificado."""

    overlay_id: str
    targets: frozenset[WaveTarget]
    leads: tuple[str, ...]
    rules: tuple[OverlayRule, ...]

    def __post_init__(self) -> None:
        if not self.leads:
            raise ValueError(
                f"el overlay {self.overlay_id!r} debe declarar al menos una "
                "derivación"
            )
        unknown = sorted(set(self.leads) - set(LEAD_ORDER))
        if unknown:
            raise ValueError(
                f"el overlay {self.overlay_id!r} declara derivaciones "
                f"desconocidas: {', '.join(unknown)}"
            )
        out_of_scope = sorted(
            {r.target.value for r in self.rules if r.target not in self.targets}
        )
        if out_of_scope:
            declared = ", ".join(sorted(t.value for t in self.targets))
            raise OverlayScopeError(
                f"el overlay {self.overlay_id!r} declara targets [{declared}] "
                f"pero tiene reglas sobre [{', '.join(out_of_scope)}]"
            )

    def components(self) -> tuple[GaussianComponent, ...]:
        return tuple(
            GaussianComponent(
                target=rule.target,
                amplitude_v=rule.amplitude_v,
                center_s=rule.center_s,
                width_s=rule.width_s,
            )
            for rule in self.rules
        )

    def lead_mask(self) -> np.ndarray:
        """Máscara `(12, 1)` con 1,0 en las derivaciones afectadas."""
        mask = np.zeros((N_LEADS, 1), dtype=np.float64)
        for lead in self.leads:
            mask[LEAD_ORDER.index(lead), 0] = 1.0
        return mask


# IAM inferior: elevación del ST en II, III y aVF. 0,2 mV son 2 mm a la
# calibración estándar, muy por encima del umbral diagnóstico de 1 mm.
ST_ELEVATION_INFERIOR: MorphologyOverlay = MorphologyOverlay(
    overlay_id="st_elevation_inferior",
    targets=frozenset({WaveTarget.ST}),
    leads=("II", "III", "aVF"),
    rules=(
        OverlayRule(
            target=WaveTarget.ST, amplitude_v=0.00020, center_s=0.090, width_s=0.045
        ),
    ),
)

OVERLAYS: dict[str, MorphologyOverlay] = {
    ST_ELEVATION_INFERIOR.overlay_id: ST_ELEVATION_INFERIOR,
}


def get_overlay(overlay_id: str) -> MorphologyOverlay:
    try:
        return OVERLAYS[overlay_id]
    except KeyError as exc:
        known = ", ".join(sorted(OVERLAYS)) or "(ninguno)"
        raise KeyError(
            f"overlay desconocido: {overlay_id!r}. Conocidos: {known}"
        ) from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_overlays.py -v`
Expected: PASS, 10 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/overlays.py packages/ecg-engine/tests/unit/test_overlays.py
git commit -m "Añadir overlays morfológicos con alcance declarado"
```

---

### Task 10: Artefactos de medición en `noise.py`

Ruido es lo que introduce **la medición**, no el paciente. Nunca debe alterar los intervalos reales del evento subyacente, y los tests lo verifican midiendo sobre señal base conocida.

La deriva de línea base vive aquí, no en `variability.py`, aunque se alimente del mismo oscilador respiratorio: es un artefacto de impedancia por movimiento del tórax, y clasificarla como fisiología llevaría a mezclar cosas distintas en los tests.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/noise.py`
- Test: `packages/ecg-engine/tests/unit/test_noise.py`

**Interfaces:**
- Consumes: `NoiseParams`, `VariabilityParams`, `N_LEADS` de `types.py`; `respiratory_phase` de `variability.py`.
- Produces:
  - `MAINS_HZ: float = 50.0`
  - `emg_noise(t_s, level_v, rng) -> np.ndarray` de forma `(12, n)`
  - `mains_noise(t_s, level_v) -> np.ndarray` de forma `(12, n)`
  - `baseline_wander(t_s, level_v, respiration_hz) -> np.ndarray` de forma `(12, n)`
  - `motion_artifact(t_s, level_v, rng) -> tuple[np.ndarray, np.ndarray]` — contribución aditiva y factor multiplicativo.
  - `apply_clipping(signal_v, clip_v) -> np.ndarray`
  - `apply_noise(signal_v, t_s, noise, variability, rng) -> np.ndarray` — aplica la cadena en orden fijo.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_noise.py`:

```python
import numpy as np
import pytest

from ecg_engine.noise import (
    MAINS_HZ,
    apply_clipping,
    apply_noise,
    baseline_wander,
    emg_noise,
    mains_noise,
    motion_artifact,
)
from ecg_engine.types import N_LEADS, NoiseParams, VariabilityParams


@pytest.fixture
def t_s() -> np.ndarray:
    return np.arange(5000) / 500.0  # 10 s a 500 Hz


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_mains_frequency_is_european():
    assert MAINS_HZ == 50.0


def test_all_noise_generators_return_twelve_lead_arrays(t_s, rng):
    assert emg_noise(t_s, 1e-5, rng).shape == (N_LEADS, t_s.size)
    assert mains_noise(t_s, 1e-5).shape == (N_LEADS, t_s.size)
    assert baseline_wander(t_s, 1e-4, 0.25).shape == (N_LEADS, t_s.size)


def test_emg_noise_is_independent_across_leads(t_s, rng):
    """Ruido muscular: cada electrodo capta el suyo."""
    noise = emg_noise(t_s, 1e-5, rng)
    correlation = np.corrcoef(noise[0], noise[1])[0, 1]
    assert abs(correlation) < 0.15


def test_emg_noise_scales_with_its_level(t_s, rng):
    quiet = emg_noise(t_s, 1e-6, np.random.default_rng(1))
    loud = emg_noise(t_s, 1e-4, np.random.default_rng(1))
    assert loud.std() == pytest.approx(100 * quiet.std(), rel=0.05)


def test_mains_noise_is_common_to_every_lead(t_s):
    """La interferencia de red entra por igual en todas las derivaciones."""
    noise = mains_noise(t_s, 1e-5)
    assert np.allclose(noise[0], noise[7])


def test_mains_noise_sits_at_fifty_hertz(t_s):
    noise = mains_noise(t_s, 1e-5)[0]
    spectrum = np.abs(np.fft.rfft(noise))
    freqs = np.fft.rfftfreq(noise.size, d=1 / 500.0)
    assert freqs[int(np.argmax(spectrum))] == pytest.approx(50.0, abs=0.5)


def test_baseline_wander_follows_the_respiratory_frequency(t_s):
    wander = baseline_wander(t_s, 1e-4, respiration_hz=0.25)[0]
    spectrum = np.abs(np.fft.rfft(wander))
    freqs = np.fft.rfftfreq(wander.size, d=1 / 500.0)
    assert freqs[int(np.argmax(spectrum))] == pytest.approx(0.25, abs=0.05)


def test_baseline_wander_differs_between_leads(t_s):
    """Comparte oscilador, pero su amplitud escala distinto por derivación."""
    wander = baseline_wander(t_s, 1e-4, 0.25)
    assert not np.allclose(wander[0], wander[6])


def test_motion_artifact_returns_additive_and_multiplicative_parts(t_s, rng):
    additive, multiplicative = motion_artifact(t_s, 1e-4, rng)
    assert additive.shape == (N_LEADS, t_s.size)
    assert multiplicative.shape == (N_LEADS, t_s.size)
    assert multiplicative.mean() == pytest.approx(1.0, abs=0.05)


def test_motion_artifact_comes_in_bursts_not_continuously(t_s, rng):
    """El artefacto de movimiento es esporádico: la mayor parte del registro
    está limpia."""
    additive, _ = motion_artifact(t_s, 1e-4, rng)
    quiet_fraction = np.mean(np.abs(additive[0]) < 1e-6)
    assert quiet_fraction > 0.5


def test_clipping_bounds_the_signal_symmetrically():
    signal = np.array([[-0.005, 0.0, 0.005]])
    clipped = apply_clipping(signal, clip_v=0.002)
    assert clipped.min() == pytest.approx(-0.002)
    assert clipped.max() == pytest.approx(0.002)


def test_clipping_is_a_no_op_when_disabled():
    signal = np.array([[-0.005, 0.0, 0.005]])
    assert np.array_equal(apply_clipping(signal, clip_v=None), signal)


def test_noise_free_params_leave_the_signal_untouched(t_s, rng):
    """Requisito para los tests de fisiología: con ruido a cero, la señal
    que entra es exactamente la que sale."""
    signal = np.ones((N_LEADS, t_s.size)) * 0.001
    result = apply_noise(signal, t_s, NoiseParams(), VariabilityParams(), rng)
    assert np.array_equal(result, signal)


def test_apply_noise_preserves_shape_and_dtype(t_s, rng):
    signal = np.zeros((N_LEADS, t_s.size))
    params = NoiseParams(emg_v=1e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=1e-4)
    result = apply_noise(signal, t_s, params, VariabilityParams(), rng)
    assert result.shape == signal.shape
    assert result.dtype == np.float64


def test_apply_noise_is_deterministic_for_a_given_seed(t_s):
    signal = np.zeros((N_LEADS, t_s.size))
    params = NoiseParams(emg_v=1e-5, mains_v=1e-5, baseline_v=1e-4, motion_v=1e-4)
    first = apply_noise(
        signal, t_s, params, VariabilityParams(), np.random.default_rng(5)
    )
    second = apply_noise(
        signal, t_s, params, VariabilityParams(), np.random.default_rng(5)
    )
    assert np.array_equal(first, second)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_noise.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.noise'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/noise.py`:

```python
"""Artefactos de medición.

Ruido es lo que introduce la medición, no el paciente. Nunca debe alterar los
intervalos reales del evento subyacente: si un filtro de ruido desplaza un QT,
está mal implementado.

La deriva de línea base vive aquí y no en `variability.py`, aunque se alimente
del mismo oscilador respiratorio. Es un artefacto de impedancia causado por el
movimiento del tórax: su origen es fisiológico, pero lo que registra el
aparato es un defecto de medición. Clasificarla como fisiología llevaría a
mezclar en los tests dos cosas que deben verificarse por separado.

Orden fijo de la cadena, que `apply_noise` respeta:
ruido aditivo → modulación multiplicativa → clipping.
"""

from __future__ import annotations

import numpy as np

from .types import N_LEADS, NoiseParams, VariabilityParams
from .variability import respiratory_phase

MAINS_HZ: float = 50.0
"""Frecuencia de la red eléctrica en Europa."""

_EMG_LOW_HZ: float = 20.0
_EMG_HIGH_HZ: float = 150.0
_MOTION_BURST_HZ: float = 0.08
_MOTION_BURST_DURATION_S: float = 0.6

# La deriva de línea base no entra igual en todas las derivaciones: depende de
# la posición del electrodo respecto al movimiento del tórax.
_BASELINE_LEAD_GAIN: np.ndarray = np.array(
    [0.8, 1.0, 0.9, 0.6, 0.5, 0.9, 1.2, 1.3, 1.1, 0.9, 0.8, 0.7]
).reshape(N_LEADS, 1)


def emg_noise(
    t_s: np.ndarray, level_v: float, rng: np.random.Generator
) -> np.ndarray:
    """Ruido muscular: aditivo, independiente en cada derivación.

    Se genera como ruido blanco filtrado a la banda 20-150 Hz mediante una
    máscara en el dominio de la frecuencia.
    """
    n = t_s.size
    if level_v == 0.0 or n == 0:
        return np.zeros((N_LEADS, n), dtype=np.float64)

    sample_rate_hz = 1.0 / float(np.mean(np.diff(t_s))) if n > 1 else 500.0
    white = rng.standard_normal((N_LEADS, n))
    spectrum = np.fft.rfft(white, axis=1)
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate_hz)
    band = (freqs >= _EMG_LOW_HZ) & (freqs <= _EMG_HIGH_HZ)
    spectrum[:, ~band] = 0.0
    filtered = np.fft.irfft(spectrum, n=n, axis=1)

    scale = np.std(filtered, axis=1, keepdims=True)
    scale[scale == 0.0] = 1.0
    return level_v * filtered / scale


def mains_noise(t_s: np.ndarray, level_v: float) -> np.ndarray:
    """Interferencia de red: aditiva, idéntica en todas las derivaciones."""
    trace = level_v * np.sin(2.0 * np.pi * MAINS_HZ * t_s)
    return np.tile(trace, (N_LEADS, 1))


def baseline_wander(
    t_s: np.ndarray, level_v: float, respiration_hz: float
) -> np.ndarray:
    """Deriva de línea base: aditiva, escalada por derivación."""
    trace = level_v * respiratory_phase(t_s, respiration_hz)
    return _BASELINE_LEAD_GAIN * np.tile(trace, (N_LEADS, 1))


def motion_artifact(
    t_s: np.ndarray, level_v: float, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """Artefacto de movimiento: ráfagas esporádicas, aditivas y multiplicativas.

    Devuelve `(aditivo, multiplicativo)`. El multiplicativo modula la amplitud
    del trazo durante la ráfaga, que es lo que ocurre cuando el contacto del
    electrodo empeora momentáneamente.
    """
    n = t_s.size
    additive = np.zeros((N_LEADS, n), dtype=np.float64)
    multiplicative = np.ones((N_LEADS, n), dtype=np.float64)
    if level_v == 0.0 or n == 0:
        return additive, multiplicative

    duration_s = float(t_s[-1] - t_s[0]) if n > 1 else 0.0
    sample_rate_hz = (n - 1) / duration_s if duration_s > 0 else 500.0
    burst_samples = max(1, int(_MOTION_BURST_DURATION_S * sample_rate_hz))
    n_bursts = rng.poisson(_MOTION_BURST_HZ * max(duration_s, 0.0))

    for _ in range(int(n_bursts)):
        lead = int(rng.integers(0, N_LEADS))
        start = int(rng.integers(0, max(1, n - burst_samples)))
        end = min(n, start + burst_samples)
        window = np.hanning(end - start)
        additive[lead, start:end] += level_v * window * rng.normal(1.0, 0.3)
        multiplicative[lead, start:end] *= 1.0 - 0.25 * window

    return additive, multiplicative


def apply_clipping(signal_v: np.ndarray, clip_v: float | None) -> np.ndarray:
    """Saturación simétrica del amplificador. Último paso de la cadena."""
    if clip_v is None:
        return signal_v
    return np.clip(signal_v, -clip_v, clip_v)


def apply_noise(
    signal_v: np.ndarray,
    t_s: np.ndarray,
    noise: NoiseParams,
    variability: VariabilityParams,
    rng: np.random.Generator,
) -> np.ndarray:
    """Aplica la cadena completa de artefactos, en orden fijo."""
    result = signal_v
    if noise.emg_v:
        result = result + emg_noise(t_s, noise.emg_v, rng)
    if noise.mains_v:
        result = result + mains_noise(t_s, noise.mains_v)
    if noise.baseline_v:
        result = result + baseline_wander(
            t_s, noise.baseline_v, variability.respiration_hz
        )
    if noise.motion_v:
        additive, multiplicative = motion_artifact(t_s, noise.motion_v, rng)
        result = (result + additive) * multiplicative
    return apply_clipping(result, noise.clip_v)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_noise.py -v`
Expected: PASS, 15 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/noise.py packages/ecg-engine/tests/unit/test_noise.py
git commit -m "Añadir artefactos de medición"
```

---

### Task 11: El renderer tonto en `renderer.py`

Este módulo es deliberadamente estúpido. Recibe eventos, overlays y una rejilla temporal, y devuelve muestras. No decide nada fisiológico: ni cuándo late el corazón, ni si una P conduce, ni cuánto varía el RR.

El criterio para revisarlo: si alguna vez hay que preguntarle a `renderer.py` por qué el ECG hace algo, la lógica está en el sitio equivocado.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/renderer.py`
- Test: `packages/ecg-engine/tests/unit/test_renderer.py`

**Interfaces:**
- Consumes: `CardiacEvent`, `EventKind`, `N_LEADS`, `VariabilityParams` de `types.py`; `get_template` de `beat.py`; `render_component` de `waveform.py`; `LeadProjection`, `ATRIAL_PROJECTION`, `NORMAL_AXIS_PROJECTION` de `leads.py`; `MorphologyOverlay` de `overlays.py`; `amplitude_scale` de `variability.py`.
- Produces:
  - `RENDER_MARGIN_S: float = 0.6`
  - `DEFAULT_PROJECTIONS: dict[EventKind, LeadProjection]`
  - `time_grid(t0_s: float, n_samples: int, sample_rate_hz: int) -> np.ndarray`
  - `render_events(events, t_s, projections, overlays=(), variability=None) -> np.ndarray` de forma `(12, n)`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_renderer.py`:

```python
import numpy as np
import pytest

from ecg_engine.leads import NORMAL_AXIS_PROJECTION
from ecg_engine.overlays import ST_ELEVATION_INFERIOR
from ecg_engine.renderer import (
    DEFAULT_PROJECTIONS,
    RENDER_MARGIN_S,
    render_events,
    time_grid,
)
from ecg_engine.types import (
    LEAD_ORDER,
    N_LEADS,
    CardiacEvent,
    EventKind,
    VariabilityParams,
)


def qrs_at(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.VENTRICULAR, t_s=t_s, template_id="normal_qrst", index=index
    )


def p_at(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.ATRIAL, t_s=t_s, template_id="sinus_p", index=index
    )


@pytest.fixture
def grid() -> np.ndarray:
    return time_grid(0.0, 1000, 500)  # 2 s


def test_time_grid_spacing_matches_the_sample_rate():
    t = time_grid(0.0, 500, 500)
    assert t.size == 500
    assert t[0] == pytest.approx(0.0)
    assert np.diff(t) == pytest.approx(np.full(499, 1 / 500))


def test_time_grid_starts_at_the_requested_offset():
    t = time_grid(37.5, 10, 500)
    assert t[0] == pytest.approx(37.5)


def test_render_margin_covers_a_full_t_wave():
    """La T de un latido anterior sigue contribuyendo dentro de la ventana."""
    assert RENDER_MARGIN_S >= 0.5


def test_empty_event_list_renders_a_flat_isoelectric_line(grid):
    signal = render_events([], grid, DEFAULT_PROJECTIONS)
    assert signal.shape == (N_LEADS, grid.size)
    assert np.allclose(signal, 0.0)


def test_a_single_qrs_peaks_at_its_event_time(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    lead_ii = signal[LEAD_ORDER.index("II")]
    assert grid[int(np.argmax(lead_ii))] == pytest.approx(1.0, abs=0.005)


def test_r_amplitude_in_lead_ii_is_about_one_millivolt(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    assert signal[LEAD_ORDER.index("II")].max() == pytest.approx(0.001, rel=0.15)


def test_avr_is_negative_for_a_normal_qrs(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    assert signal[LEAD_ORDER.index("aVR")].min() < 0.0


def test_atrial_and_ventricular_events_use_different_projections(grid):
    p_only = render_events([p_at(1.0)], grid, DEFAULT_PROJECTIONS)
    qrs_only = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    v1 = LEAD_ORDER.index("V1")
    assert p_only[v1].max() > 0.0    # P positiva en V1
    assert qrs_only[v1].min() < 0.0  # QRS negativo en V1


def test_events_superpose_additively(grid):
    separate = render_events([qrs_at(0.5)], grid, DEFAULT_PROJECTIONS) + render_events(
        [qrs_at(1.5, index=1)], grid, DEFAULT_PROJECTIONS
    )
    together = render_events(
        [qrs_at(0.5), qrs_at(1.5, index=1)], grid, DEFAULT_PROJECTIONS
    )
    assert np.allclose(separate, together)


def test_overlay_only_touches_its_declared_leads(grid):
    plain = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    elevated = render_events(
        [qrs_at(1.0)], grid, DEFAULT_PROJECTIONS, overlays=(ST_ELEVATION_INFERIOR,)
    )
    for lead in ("II", "III", "aVF"):
        assert not np.allclose(plain[LEAD_ORDER.index(lead)],
                               elevated[LEAD_ORDER.index(lead)])
    for lead in ("I", "aVL", "V1", "V2", "V6"):
        assert np.allclose(plain[LEAD_ORDER.index(lead)],
                           elevated[LEAD_ORDER.index(lead)])


def test_overlay_raises_the_st_segment_above_baseline(grid):
    elevated = render_events(
        [qrs_at(1.0)], grid, DEFAULT_PROJECTIONS, overlays=(ST_ELEVATION_INFERIOR,)
    )
    st_sample = int((1.0 + 0.09) * 500)
    assert elevated[LEAD_ORDER.index("III"), st_sample] > 0.00015


def test_overlay_does_not_apply_to_atrial_events(grid):
    """Un overlay de ST no puede modificar una onda P: es la regla que
    impide que la isquemia altere la aurícula por accidente."""
    plain = render_events([p_at(1.0)], grid, DEFAULT_PROJECTIONS)
    with_overlay = render_events(
        [p_at(1.0)], grid, DEFAULT_PROJECTIONS, overlays=(ST_ELEVATION_INFERIOR,)
    )
    assert np.allclose(plain, with_overlay)


def test_variability_modulates_amplitude_without_moving_the_peak(grid):
    params = VariabilityParams(amplitude_fraction=0.20, respiration_hz=0.25)
    plain = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    modulated = render_events(
        [qrs_at(1.0)], grid, DEFAULT_PROJECTIONS, variability=params
    )
    lead_ii = LEAD_ORDER.index("II")
    assert int(np.argmax(modulated[lead_ii])) == pytest.approx(
        int(np.argmax(plain[lead_ii])), abs=2
    )
    assert modulated[lead_ii].max() != pytest.approx(plain[lead_ii].max())


def test_output_is_always_float64_and_twelve_leads(grid):
    signal = render_events([qrs_at(1.0)], grid, DEFAULT_PROJECTIONS)
    assert signal.dtype == np.float64
    assert signal.shape[0] == N_LEADS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_renderer.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.renderer'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/renderer.py`:

```python
"""Conversión de eventos a muestras.

Este módulo es deliberadamente tonto. Recibe eventos, overlays y una rejilla
temporal, y devuelve muestras. No decide nada fisiológico: ni cuándo late el
corazón, ni si una P conduce, ni cuánto varía el RR. Toda esa lógica vive
antes, en `rhythm.py`, `conduction.py`, `variability.py` y `overlays.py`.

Criterio de revisión: si hay que preguntarle a este módulo *por qué* el ECG
hace algo, la lógica está en el sitio equivocado.

Respeta el tramo de la cadena que le corresponde:
señal base → overlays → variabilidad. El ruido lo aplica el orquestador.
"""

from __future__ import annotations

from typing import Mapping, Sequence

import numpy as np

from .beat import get_template
from .leads import ATRIAL_PROJECTION, NORMAL_AXIS_PROJECTION, LeadProjection
from .overlays import MorphologyOverlay
from .types import (
    N_LEADS,
    CardiacEvent,
    EventKind,
    VariabilityParams,
)
from .variability import amplitude_scale
from .waveform import render_component

RENDER_MARGIN_S: float = 0.6
"""Margen temporal que el llamante debe añadir al pedir eventos.

Una onda T se extiende hasta medio segundo después del pico de su R, así que
un latido anterior a la ventana sigue contribuyendo dentro de ella. Quien
llama a `render_events` debe pasar los eventos de `[t0 - margen, t1 + margen)`,
o aparecerán discontinuidades en las fronteras de chunk.
"""

DEFAULT_PROJECTIONS: dict[EventKind, LeadProjection] = {
    EventKind.ATRIAL: ATRIAL_PROJECTION,
    EventKind.VENTRICULAR: NORMAL_AXIS_PROJECTION,
}


def time_grid(t0_s: float, n_samples: int, sample_rate_hz: int) -> np.ndarray:
    """Rejilla temporal absoluta de `n_samples` muestras desde `t0_s`."""
    return t0_s + np.arange(n_samples, dtype=np.float64) / float(sample_rate_hz)


def _trace_for_event(t_s: np.ndarray, event: CardiacEvent) -> np.ndarray:
    template = get_template(event.template_id)
    trace = np.zeros_like(t_s)
    for component in template.components:
        trace += render_component(t_s, component, offset_s=event.t_s)
    return trace


def render_events(
    events: Sequence[CardiacEvent],
    t_s: np.ndarray,
    projections: Mapping[EventKind, LeadProjection],
    overlays: Sequence[MorphologyOverlay] = (),
    variability: VariabilityParams | None = None,
) -> np.ndarray:
    """Convierte una lista de eventos en una señal de doce derivaciones."""
    signal = np.zeros((N_LEADS, t_s.size), dtype=np.float64)

    for event in events:
        trace = _trace_for_event(t_s, event)
        signal += projections[event.kind].as_column() * trace[np.newaxis, :]

    # Los overlays modifican morfología ventricular. No tocan la aurícula, y
    # por construcción no pueden crear ni mover eventos.
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    for overlay in overlays:
        overlay_trace = np.zeros_like(t_s)
        for event in ventricular:
            for component in overlay.components():
                overlay_trace += render_component(
                    t_s, component, offset_s=event.t_s
                )
        signal += overlay.lead_mask() * overlay_trace[np.newaxis, :]

    if variability is not None:
        signal *= amplitude_scale(t_s, variability)[np.newaxis, :]

    return signal
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_renderer.py -v`
Expected: PASS, 14 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/renderer.py packages/ecg-engine/tests/unit/test_renderer.py
git commit -m "Añadir renderer de eventos a muestras"
```

---

### Task 12: Fuentes de señal en `sources.py`

Aquí se compone todo: tren auricular + política de conducción + escape opcional + renderer. La fibrilación ventricular es la única excepción al modelo de eventos, y aun así implementa la misma interfaz pública.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/sources.py`
- Test: `packages/ecg-engine/tests/unit/test_sources.py`

**Interfaces:**
- Consumes: `EventTrain`, `RegularTrain` de `rhythm.py`; `ConductionPolicy` de `conduction.py`; `render_events`, `time_grid`, `RENDER_MARGIN_S`, `DEFAULT_PROJECTIONS` de `renderer.py`; `MorphologyOverlay` de `overlays.py`; tipos de `types.py`.
- Produces:
  - `BeatBasedSource(atrial, conduction, escape=None, overlays=(), variability=VariabilityParams())` con `events(t0_s, t1_s) -> list[CardiacEvent]`, `render(t0_s, n_samples, sample_rate_hz) -> np.ndarray` y `set_rate_hz(rate_hz)`.
  - `VentricularFibrillationSource(coarseness, amplitude_v, dominant_hz, rng)` con `render(...)` y `set_rate_hz(rate_hz)` que no hace nada.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_sources.py`:

```python
import numpy as np
import pytest

from ecg_engine.conduction import CompleteBlock, FixedPR
from ecg_engine.rhythm import EventTrain, RegularTrain
from ecg_engine.sources import BeatBasedSource, VentricularFibrillationSource
from ecg_engine.types import (
    LEAD_ORDER,
    N_LEADS,
    EventKind,
    VariabilityParams,
)


def sinus_source(seed: int = 20260725) -> BeatBasedSource:
    return BeatBasedSource(
        atrial=EventTrain(
            kind=EventKind.ATRIAL,
            template_id="sinus_p",
            rate_hz=70 / 60,
            variability=VariabilityParams(),
            rng=np.random.default_rng(seed),
        ),
        conduction=FixedPR(pr_s=0.16),
    )


def complete_block_source() -> BeatBasedSource:
    return BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="sinus_p", rate_hz=75 / 60
        ),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR, template_id="escape_qrst", rate_hz=40 / 60
        ),
    )


def test_source_emits_both_atrial_and_ventricular_events():
    events = sinus_source().events(0.0, 10.0)
    kinds = {e.kind for e in events}
    assert kinds == {EventKind.ATRIAL, EventKind.VENTRICULAR}


def test_events_come_back_sorted_in_time():
    times = [e.t_s for e in sinus_source().events(0.0, 20.0)]
    assert times == sorted(times)


def test_every_p_is_followed_by_its_qrs_in_sinus_rhythm():
    events = sinus_source().events(0.0, 20.0)
    atrial = [e for e in events if e.kind is EventKind.ATRIAL]
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    assert abs(len(atrial) - len(ventricular)) <= 1


def test_complete_block_produces_independent_atrial_and_ventricular_rates():
    """BAV de tercer grado: aurícula a 75, ventrículo a 40, sin relación."""
    events = complete_block_source().events(0.0, 60.0)
    atrial = [e for e in events if e.kind is EventKind.ATRIAL]
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    assert len(atrial) / 60.0 == pytest.approx(75 / 60, rel=0.05)
    assert len(ventricular) / 60.0 == pytest.approx(40 / 60, rel=0.05)


def test_complete_block_pr_intervals_are_not_constant():
    """Si el PR fuera constante habría conducción, y en el BAV completo no
    la hay. Es la comprobación que distingue un bloqueo real de uno falso."""
    events = complete_block_source().events(0.0, 60.0)
    atrial = np.array([e.t_s for e in events if e.kind is EventKind.ATRIAL])
    ventricular = [e.t_s for e in events if e.kind is EventKind.VENTRICULAR]
    intervals = [
        qrs - atrial[atrial <= qrs][-1] for qrs in ventricular if (atrial <= qrs).any()
    ]
    assert np.std(intervals) > 0.1


def test_render_returns_twelve_leads_of_the_requested_length():
    signal = sinus_source().render(0.0, 500, 500)
    assert signal.shape == (N_LEADS, 500)
    assert signal.dtype == np.float64


def test_render_is_continuous_across_chunk_boundaries():
    """Sin el margen de render aparecería un escalón en cada frontera."""
    source = sinus_source()
    whole = source.render(0.0, 1000, 500)
    first = source.render(0.0, 500, 500)
    second = source.render(1.0, 500, 500)
    assert np.allclose(whole[:, :500], first)
    assert np.allclose(whole[:, 500:], second, atol=1e-12)


def test_render_includes_contributions_from_beats_before_the_window():
    """Una T de un latido anterior debe seguir presente al inicio de la
    ventana; si no, el margen no se está aplicando."""
    source = sinus_source()
    late = source.render(9.0, 250, 500)
    assert np.abs(late).max() > 0.0


def test_set_rate_changes_the_ventricular_rate():
    source = sinus_source()
    slow = source.events(0.0, 30.0)
    source.set_rate_hz(140 / 60)
    fast = source.events(30.0, 60.0)
    slow_count = len([e for e in slow if e.kind is EventKind.VENTRICULAR])
    fast_count = len([e for e in fast if e.kind is EventKind.VENTRICULAR])
    assert fast_count > 1.5 * slow_count


def test_two_sources_with_the_same_seed_render_identically():
    assert np.array_equal(
        sinus_source(seed=99).render(0.0, 2000, 500),
        sinus_source(seed=99).render(0.0, 2000, 500),
    )


def test_ventricular_fibrillation_has_no_discrete_events():
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(1),
    )
    assert not hasattr(source, "events")


def test_ventricular_fibrillation_implements_the_common_render_interface():
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(1),
    )
    signal = source.render(0.0, 2500, 500)
    assert signal.shape == (N_LEADS, 2500)


def test_ventricular_fibrillation_energy_sits_in_its_dominant_band():
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(1),
    )
    trace = source.render(0.0, 5000, 500)[LEAD_ORDER.index("II")]
    spectrum = np.abs(np.fft.rfft(trace))
    freqs = np.fft.rfftfreq(trace.size, d=1 / 500.0)
    peak_hz = freqs[int(np.argmax(spectrum))]
    assert 3.0 <= peak_hz <= 10.0


def test_coarse_fibrillation_has_larger_excursions_than_fine():
    coarse = VentricularFibrillationSource(
        coarseness=1.0, amplitude_v=0.0004, dominant_hz=6.0,
        rng=np.random.default_rng(4),
    ).render(0.0, 5000, 500)
    fine = VentricularFibrillationSource(
        coarseness=0.2, amplitude_v=0.0004, dominant_hz=6.0,
        rng=np.random.default_rng(4),
    ).render(0.0, 5000, 500)
    assert coarse.std() > fine.std()


def test_fibrillation_has_no_isoelectric_baseline():
    """En la FV no hay línea de base: la señal nunca descansa."""
    trace = VentricularFibrillationSource(
        coarseness=0.7, amplitude_v=0.0004, dominant_hz=6.0,
        rng=np.random.default_rng(2),
    ).render(0.0, 5000, 500)[LEAD_ORDER.index("II")]
    near_zero = np.mean(np.abs(trace) < 0.00002)
    assert near_zero < 0.15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_sources.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.sources'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/sources.py`:

```python
"""Fuentes de señal.

`BeatBasedSource` compone el modelo de dos trenes: un tren auricular emite
ondas P, una política de conducción decide cuáles alcanzan el ventrículo, y
una fuente de escape opcional aporta QRS cuando el nodo AV no conduce nada.
Esa composición es la que convierte once de los doce ritmos del MVP en
configuración de catálogo en lugar de en código.

`VentricularFibrillationSource` es la única excepción: en la FV no hay
latidos discretos que modelar, así que genera señal caótica continua. Aun
así implementa la misma interfaz `render`, de modo que el resto del sistema
no necesita saber que es distinta.
"""

from __future__ import annotations

from typing import Protocol, Sequence

import numpy as np

from .conduction import ConductionPolicy
from .overlays import MorphologyOverlay
from .renderer import (
    DEFAULT_PROJECTIONS,
    RENDER_MARGIN_S,
    render_events,
    time_grid,
)
from .types import N_LEADS, CardiacEvent, EventKind, VariabilityParams


class _Train(Protocol):
    """Lo que `BeatBasedSource` necesita de un tren, sea cual sea su tipo."""

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]: ...


class BeatBasedSource:
    """Fuente construida sobre eventos cardíacos discretos."""

    def __init__(
        self,
        atrial: _Train,
        conduction: ConductionPolicy,
        escape: _Train | None = None,
        overlays: Sequence[MorphologyOverlay] = (),
        variability: VariabilityParams | None = None,
        rng: np.random.Generator | None = None,
    ) -> None:
        self._atrial = atrial
        self._conduction = conduction
        self._escape = escape
        self._overlays = tuple(overlays)
        self._variability = variability
        self._rng = rng if rng is not None else np.random.default_rng(0)

    def set_rate_hz(self, rate_hz: float) -> None:
        """Cambia la frecuencia del tren auricular.

        En los ritmos con conducción 1:1 eso equivale a cambiar la frecuencia
        ventricular, que es lo que el usuario espera al mover el control.
        """
        self._atrial.set_rate_hz(rate_hz)

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        atrial = list(self._atrial.events(t0_s, t1_s))
        ventricular = self._conduction.conduct(atrial, self._rng)
        if self._escape is not None:
            ventricular = ventricular + list(self._escape.events(t0_s, t1_s))
        return sorted(atrial + ventricular, key=lambda e: e.t_s)

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        t_s = time_grid(t0_s, n_samples, sample_rate_hz)
        window_end_s = t0_s + n_samples / float(sample_rate_hz)
        # El margen es imprescindible: la T de un latido anterior a la ventana
        # sigue contribuyendo dentro de ella.
        events = self.events(
            max(0.0, t0_s - RENDER_MARGIN_S), window_end_s + RENDER_MARGIN_S
        )
        return render_events(
            events,
            t_s,
            DEFAULT_PROJECTIONS,
            overlays=self._overlays,
            variability=self._variability,
        )


class VentricularFibrillationSource:
    """Señal caótica continua, sin latidos discretos.

    Se genera como suma de senoides moduladas en frecuencia y amplitud en
    torno a la frecuencia dominante. `coarseness` controla la diferencia
    entre la fibrilación gruesa y la fina, que clínicamente marca el pronóstico
    y la respuesta a la desfibrilación.
    """

    _N_OSCILLATORS: int = 12

    def __init__(
        self,
        coarseness: float,
        amplitude_v: float,
        dominant_hz: float,
        rng: np.random.Generator,
    ) -> None:
        if not 0.0 < coarseness <= 1.0:
            raise ValueError(
                f"coarseness debe estar en (0, 1], recibido {coarseness}"
            )
        if not 3.0 <= dominant_hz <= 10.0:
            raise ValueError(
                f"dominant_hz debe estar entre 3 y 10, recibido {dominant_hz}"
            )
        self._coarseness = coarseness
        self._amplitude_v = amplitude_v
        self._dominant_hz = dominant_hz
        self._phases = rng.uniform(0.0, 2.0 * np.pi, self._N_OSCILLATORS)
        self._detunes = rng.normal(1.0, 0.18, self._N_OSCILLATORS)
        self._weights = rng.uniform(0.5, 1.0, self._N_OSCILLATORS)
        self._lead_gains = rng.uniform(0.6, 1.4, N_LEADS).reshape(N_LEADS, 1)

    def set_rate_hz(self, rate_hz: float) -> None:
        """La FV no tiene frecuencia cardíaca. El control no aplica."""
        return None

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        t_s = time_grid(t0_s, n_samples, sample_rate_hz)
        trace = np.zeros_like(t_s)
        for phase, detune, weight in zip(
            self._phases, self._detunes, self._weights
        ):
            freq_hz = self._dominant_hz * detune
            trace += weight * np.sin(2.0 * np.pi * freq_hz * t_s + phase)
        trace /= self._weights.sum()

        # La fibrilación gruesa tiene excursiones amplias y lentas; la fina,
        # una ondulación menuda y de bajo voltaje.
        envelope = 1.0 + self._coarseness * np.sin(
            2.0 * np.pi * 0.7 * t_s + self._phases[0]
        )
        trace = trace * envelope * self._coarseness

        return self._lead_gains * (self._amplitude_v * trace)[np.newaxis, :]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_sources.py -v`
Expected: PASS, 15 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/sources.py packages/ecg-engine/tests/unit/test_sources.py
git commit -m "Añadir fuentes de señal por eventos y de fibrilación ventricular"
```

---
