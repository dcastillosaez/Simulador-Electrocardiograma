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
    ) -> np.ndarray:
        """Genera señal desde `t0_s`.

        Devuelve un array de forma `(12, n_samples)` y dtype `float64`, en
        **voltios**, con las derivaciones en el orden de `LEAD_ORDER`. Ese
        contrato vincula a toda implementación: el resto del sistema lo da
        por hecho sin comprobarlo.
        """
        ...
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
  - `target_extent_s(template: BeatTemplate, target: WaveTarget) -> tuple[float, float]` — extensión (inicio, fin) del target a ±2,5σ, relativa al instante del evento.
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
from ecg_engine.waveform import fwhm_s


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


def test_target_extent_straddles_the_event_instant():
    template = get_template("normal_qrst")
    start, end = target_extent_s(template, WaveTarget.QRS)
    assert start < 0.0 < end


def test_r_wave_is_sharp_not_broad():
    """Guarda contra la tentación de ensanchar ondas hasta que los tests de
    intervalo pasen. Una R normal mide unos 20 ms a media altura; si alguien
    la engorda para estirar el QRS, el complejo deja de parecer normal aunque
    su duración caiga en rango."""
    r_wave = max(
        get_template("normal_qrst").components_for(WaveTarget.QRS),
        key=lambda c: c.amplitude_v,
    )
    assert fwhm_s(r_wave.width_s) == pytest.approx(0.021, abs=0.004)


def test_wide_qrs_really_is_broad_at_half_height():
    """El QRS ancho lo es por morfología, no por un truco de la convención
    de medida: su onda dominante debe ser genuinamente ancha."""
    dominant = max(
        get_template("wide_qrst").components_for(WaveTarget.QRS),
        key=lambda c: abs(c.amplitude_v),
    )
    assert fwhm_s(dominant.width_s) > 0.055


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

_SIGMA_EXTENT: float = 2.5
"""Cuántas desviaciones típicas a cada lado se consideran parte de la onda.

A ±2,5σ una gaussiana ha caído al 4,4 % de su pico, que es aproximadamente
donde el ojo clínico sitúa el inicio y el final de una onda sobre el papel.
Con ±2σ la extensión se queda corta y los intervalos medidos salen por debajo
del rango fisiológico aunque la morfología sea correcta.
"""


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
    # Las posiciones de Q y S importan tanto como sus anchuras: en un ECG real
    # la Q cae unos 26 ms antes del pico de la R y la S unos 28 ms después.
    # Acercarlas comprime el QRS por debajo del rango fisiológico por mucho que
    # se ensanchen las ondas, y ensancharlas para compensar produce un complejo
    # gordo y redondeado que ya no parece un latido normal.
    "normal_qrst": BeatTemplate(
        template_id="normal_qrst",
        components=(
            _qrs(-0.00005, -0.026, 0.0055),   # Q
            _qrs(0.00100, 0.000, 0.0090),     # R
            _qrs(-0.00015, 0.028, 0.0075),    # S
            _st(0.00000, 0.090, 0.0300),      # segmento ST, isoeléctrico
            _t(0.00025, 0.2525, 0.0430),      # T
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
    """Extensión temporal de un target, a ±2,5σ, relativa al evento."""
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
Expected: PASS, 12 passed

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
  - `ConductionPolicy` — Protocol con `conduct(atrial: Sequence[CardiacEvent], rng: np.random.Generator, t0_s: float, t1_s: float) -> list[CardiacEvent]`. La ventana llega explícita y no se deduce de los eventos recibidos.
  - `FixedPR(pr_s: float, template_id: str = "normal_qrst")`
  - `WenckebachPR(pr_base_s: float, pr_increment_s: float, cycle_length: int, template_id: str = "normal_qrst")`
  - `FixedRatioBlock(ratio: int, pr_s: float, template_id: str = "normal_qrst")`
  - `CompleteBlock()` — no conduce nada; el escape lo aporta otra fuente.
  - `IrregularConduction(mean_rr_s: float, rr_spread_s: float, template_id: str = "normal_qrst")` — única política con estado: cachea su línea temporal hacia adelante y expone además `set_rate_hz(rate_hz: float) -> None`.

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


def window_of(atrial: list[CardiacEvent]) -> tuple[float, float]:
    """Ventana que cubre un tren completo, para los tests que no la varían."""
    return (0.0, atrial[-1].t_s + 1e-6) if atrial else (0.0, 0.0)


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260725)


def test_fixed_pr_conducts_every_p(rng):
    atrial = atrial_train(10)
    ventricular = FixedPR(pr_s=0.16).conduct(atrial, rng, *window_of(atrial))
    assert len(ventricular) == 10
    assert all(e.kind is EventKind.VENTRICULAR for e in ventricular)


def test_fixed_pr_offsets_each_qrs_by_the_pr_interval(rng):
    atrial = atrial_train(5)
    ventricular = FixedPR(pr_s=0.16).conduct(atrial, rng, *window_of(atrial))
    for p, qrs in zip(atrial, ventricular):
        assert qrs.t_s == pytest.approx(p.t_s + 0.16)


def test_first_degree_block_is_just_a_long_fixed_pr(rng):
    """El BAV de primer grado no es una política aparte: es FixedPR largo."""
    atrial = atrial_train(3)
    ventricular = FixedPR(pr_s=0.24).conduct(atrial, rng, *window_of(atrial))
    assert ventricular[0].t_s == pytest.approx(0.24)


def test_pure_policies_ignore_the_window(rng):
    """Las políticas puras derivan todo del índice de la P. La ventana solo
    existe para la fibrilación auricular; pasarles una distinta no puede
    cambiar su salida."""
    atrial = atrial_train(6)
    wide = FixedPR(pr_s=0.16).conduct(atrial, rng, 0.0, 1000.0)
    narrow = FixedPR(pr_s=0.16).conduct(atrial, rng, 2.0, 2.5)
    assert [e.t_s for e in wide] == pytest.approx([e.t_s for e in narrow])


def test_wenckebach_lengthens_pr_until_a_beat_drops(rng):
    """Mobitz I: el PR crece latido a latido y el cuarto no conduce."""
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(8)
    ventricular = policy.conduct(atrial, rng, *window_of(atrial))

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
    ventricular = policy.conduct(atrial, rng, *window_of(atrial))
    fifth = next(e for e in ventricular if e.index == 4)
    assert fifth.t_s - atrial[4].t_s == pytest.approx(0.16)


def test_wenckebach_is_independent_of_chunk_boundaries(rng):
    """Renderizar en dos trozos debe dar el mismo resultado que en uno."""
    policy = WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=4)
    atrial = atrial_train(12)
    whole = policy.conduct(atrial, rng, *window_of(atrial))
    split = policy.conduct(
        atrial[:5], rng, *window_of(atrial[:5])
    ) + policy.conduct(atrial[5:], rng, *window_of(atrial[5:]))
    assert [e.t_s for e in whole] == pytest.approx([e.t_s for e in split])


def test_fixed_ratio_block_conducts_one_in_n(rng):
    """Flutter 2:1 — conduce una de cada dos ondas auriculares."""
    atrial = atrial_train(10)
    ventricular = FixedRatioBlock(ratio=2, pr_s=0.14).conduct(
        atrial, rng, *window_of(atrial)
    )
    assert len(ventricular) == 5
    assert [e.index for e in ventricular] == [0, 2, 4, 6, 8]


def test_fixed_ratio_block_supports_four_to_one(rng):
    atrial = atrial_train(12)
    ventricular = FixedRatioBlock(ratio=4, pr_s=0.14).conduct(
        atrial, rng, *window_of(atrial)
    )
    assert [e.index for e in ventricular] == [0, 4, 8]


def test_fixed_ratio_block_rejects_a_ratio_below_two(rng):
    with pytest.raises(ValueError, match="ratio"):
        FixedRatioBlock(ratio=1, pr_s=0.14)


def test_wenckebach_rejects_a_cycle_length_below_two(rng):
    with pytest.raises(ValueError, match="cycle_length"):
        WenckebachPR(pr_base_s=0.16, pr_increment_s=0.04, cycle_length=1)


def test_complete_block_conducts_nothing(rng):
    """BAV de tercer grado: ninguna P alcanza el ventrículo.
    Los QRS los aporta una fuente de escape independiente."""
    atrial = atrial_train(20)
    assert CompleteBlock().conduct(atrial, rng, *window_of(atrial)) == []


def test_irregular_conduction_produces_irregular_rr(rng):
    """FA: el RR debe ser genuinamente irregular, no solo ruidoso."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    ventricular = policy.conduct([], rng, 0.0, 120.0)
    rr = np.diff([e.t_s for e in ventricular])
    assert rr.std() > 0.08
    assert rr.min() > 0.0


def test_irregular_conduction_does_not_need_atrial_events_at_all(rng):
    """La ventana manda. En la FA la aurícula no marca el paso del
    ventrículo, así que la política debe producir latidos aunque no le
    llegue ni una sola onda f: es justo lo que ocurre en un trozo corto."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    assert policy.conduct([], rng, 0.0, 10.0)


def test_irregular_conduction_is_deterministic_for_a_given_seed():
    first = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        [], np.random.default_rng(7), 0.0, 60.0
    )
    second = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        [], np.random.default_rng(7), 0.0, 60.0
    )
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_irregular_conduction_survives_chunks_shorter_than_its_beats(rng):
    """El caso que de verdad importa, y el que un tren auricular denso
    esconde: trozos de 100 ms, más cortos que el RR y que el intervalo entre
    ondas f. Ni un latido puede perderse por el camino."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    chunked: list[float] = []
    t = 0.0
    while t < 30.0:
        chunked.extend(e.t_s for e in policy.conduct([], rng, t, t + 0.1))
        t += 0.1

    whole = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18).conduct(
        [], np.random.default_rng(20260725), 0.0, 30.0
    )
    assert [e.t_s for e in whole] == pytest.approx(chunked)


def test_irregular_conduction_repeats_the_same_beats_for_a_repeated_window(rng):
    """Renderizar dos veces la misma ventana debe dar los mismos latidos."""
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    first = policy.conduct([], rng, 0.0, 20.0)
    second = policy.conduct([], rng, 0.0, 20.0)
    assert [e.t_s for e in first] == pytest.approx([e.t_s for e in second])


def test_irregular_conduction_indices_are_absolute_not_per_window(rng):
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    policy.conduct([], rng, 0.0, 30.0)
    late = policy.conduct([], rng, 30.0, 60.0)
    assert late[0].index > 0


def test_irregular_conduction_rate_change_affects_only_future_beats(rng):
    policy = IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.18)
    before = policy.conduct([], rng, 0.0, 30.0)
    policy.set_rate_hz(150 / 60)
    after = policy.conduct([], rng, 30.0, 60.0)
    assert policy.conduct([], rng, 0.0, 30.0) == before
    assert len(after) > len(before)


def test_conducted_events_carry_the_configured_template(rng):
    atrial = atrial_train(3)
    ventricular = FixedPR(pr_s=0.16, template_id="wide_qrst").conduct(
        atrial, rng, *window_of(atrial)
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
    """Convierte eventos auriculares en eventos ventriculares.

    La ventana `[t0_s, t1_s)` llega explícita y no se deduce de los eventos
    recibidos. Las políticas puras la ignoran, porque su salida depende solo
    del índice de cada P. `IrregularConduction` la necesita: sin ella tendría
    que adivinar el rango a partir del primer y el último evento auricular, y
    entonces su corrección dependería de cuántas ondas f caigan en el trozo
    —un invariante que vive en el renderer, no aquí—. Una fibrilación
    auricular perdería latidos en silencio el día que alguien ajustara el
    margen de render.
    """

    def conduct(
        self,
        atrial: Sequence[CardiacEvent],
        rng: np.random.Generator,
        t0_s: float,
        t1_s: float,
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
        self,
        atrial: Sequence[CardiacEvent],
        rng: np.random.Generator,
        t0_s: float,
        t1_s: float,
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
        self,
        atrial: Sequence[CardiacEvent],
        rng: np.random.Generator,
        t0_s: float,
        t1_s: float,
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
        self,
        atrial: Sequence[CardiacEvent],
        rng: np.random.Generator,
        t0_s: float,
        t1_s: float,
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
        self,
        atrial: Sequence[CardiacEvent],
        rng: np.random.Generator,
        t0_s: float,
        t1_s: float,
    ) -> list[CardiacEvent]:
        return []


class IrregularConduction:
    """Conducción irregular de la fibrilación auricular.

    Es la única política **con estado**, y por dos motivos independientes.

    El primero es clínico: en la FA la frecuencia que importa es la respuesta
    ventricular, y esa la fija el nodo AV, no la aurícula. Controlar la
    frecuencia de una FA significa mover `mean_rr_s`, que es justo lo que hace
    un frenador del nodo AV. De ahí que sea mutable.

    El segundo es de determinismo. Las demás políticas derivan su
    comportamiento del índice del evento auricular, así que son puras. Esta no
    puede: la irregularidad del RR sale del RNG, y sortear en cada llamada
    haría que el resultado dependiera de dónde caigan las fronteras de chunk.
    Por eso mantiene una línea temporal cacheada que solo crece hacia adelante,
    exactamente el mismo patrón que `EventTrain`. Sin esa caché, renderizar
    10 s de una vez y renderizar cien chunks de 100 ms darían señales
    distintas, y los golden de muestras y de eventos describirían latidos
    diferentes sin que ningún test lo delatara.

    La actividad auricular en la FA es caótica y de alta frecuencia; el nodo AV
    deja pasar impulsos de forma impredecible. El resultado es un RR
    genuinamente irregular, no un RR regular con ruido encima.
    """

    _MIN_RR_S: float = 0.24

    def __init__(
        self,
        mean_rr_s: float,
        rr_spread_s: float,
        template_id: str = "normal_qrst",
    ) -> None:
        self.mean_rr_s = mean_rr_s
        self.rr_spread_s = rr_spread_s
        self.template_id = template_id
        self._times_s: list[float] = [0.0]

    def set_rate_hz(self, rate_hz: float) -> None:
        """Ajusta la respuesta ventricular media.

        Solo afecta a los latidos aún no generados: la caché ya emitida no se
        reescribe, igual que en `EventTrain`.
        """
        if rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {rate_hz}")
        self.mean_rr_s = 1.0 / rate_hz

    def _extend_until(self, t_s: float, rng: np.random.Generator) -> None:
        while self._times_s[-1] < t_s:
            step_s = float(rng.normal(self.mean_rr_s, self.rr_spread_s))
            self._times_s.append(self._times_s[-1] + max(step_s, self._MIN_RR_S))

    def conduct(
        self,
        atrial: Sequence[CardiacEvent],
        rng: np.random.Generator,
        t0_s: float,
        t1_s: float,
    ) -> list[CardiacEvent]:
        """Devuelve los latidos ventriculares de la ventana `[t0_s, t1_s)`.

        La ventana llega dada, no se deduce de `atrial`. Deducirla sería un
        error sutil y difícil de ver: en la fibrilación auricular las ondas f
        van a unas 420 por minuto, así que un trozo corto puede contener una
        sola onda o ninguna, y el rango inferido se colapsaría a un instante
        —o al conjunto vacío— dejando fuera latidos que sí debían sonar.
        """
        self._extend_until(t1_s, rng)
        return [
            CardiacEvent(
                kind=EventKind.VENTRICULAR,
                t_s=t_s,
                template_id=self.template_id,
                index=index,
            )
            for index, t_s in enumerate(self._times_s)
            if t0_s <= t_s < t1_s
        ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_conduction.py -v`
Expected: PASS, 19 passed

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


def test_amplitude_and_rr_respond_to_the_same_oscillator(rng):
    """El punto arquitectónico del módulo: un solo oscilador para las dos
    cosas. En el pico inspiratorio el RR se acorta y la amplitud sube, y
    ocurre en el mismo instante porque ambas leen la misma fase. Si alguien
    desacopla `amplitude_scale` de `respiratory_phase`, esto lo ve; el test
    que solo mira el RR, no."""
    params = VariabilityParams(
        respiration_hz=0.25,
        rsa_fraction=0.04,
        amplitude_fraction=0.03,
        rr_jitter_fraction=0.0,
    )
    peak_s, trough_s = 1.0, 3.0
    scale = amplitude_scale(np.array([peak_s, trough_s]), params)

    assert scale[0] == pytest.approx(1.03, abs=1e-9)
    assert scale[1] == pytest.approx(0.97, abs=1e-9)
    assert next_rr_s(1.0, peak_s, params, rng) == pytest.approx(0.96, abs=1e-9)
    assert next_rr_s(1.0, trough_s, params, rng) == pytest.approx(1.04, abs=1e-9)


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
Expected: PASS, 9 passed

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


@pytest.mark.parametrize("bpm", [40, 50, 75, 100, 150, 180, 200, 250, 300, 420])
def test_regular_train_chunking_is_exact_at_every_rate(bpm):
    """El tren regular también debe sobrevivir al troceado, y con más razón
    que el otro: es el que usan el flutter y los ritmos de escape.

    El fallo que este test caza no es teórico. Con el rango de índices
    calculado por división y la pertenencia decidida por multiplicación, los
    dos redondeos discrepan cuando un evento cae a un ULP de una frontera de
    trozo: desaparece de la ventana anterior y de la siguiente a la vez. A
    200 lpm se perdía uno de cada diez latidos, y ninguna de las frecuencias
    que probaban los demás tests lo delataba."""
    train = RegularTrain(
        kind=EventKind.VENTRICULAR, template_id="normal_qrst", rate_hz=bpm / 60
    )
    n_chunks = 600  # un minuto en trozos de 100 ms
    whole = {e.index for e in train.events(0.0, n_chunks * 50 / 500)}

    chunked: set[int] = set()
    for k in range(n_chunks):
        chunked |= {
            e.index for e in train.events(k * 50 / 500, (k + 1) * 50 / 500)
        }

    assert chunked == whole


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
        """No hace nada: la frecuencia de un tren regular es estructural.

        El flutter despolariza la aurícula a 300 por minuto y un escape
        ventricular late a 40. Esos números definen el ritmo; no son un
        ajuste del usuario. Quien controla la frecuencia que el usuario sí
        puede tocar es el catálogo, mediante `editable_parameters`.
        """
        return None

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        interval_s = 1.0 / self.rate_hz
        # El rango candidato se ensancha un índice a cada lado a propósito,
        # de modo que el filtro de abajo sea el único árbitro y use la misma
        # operación `index * interval_s` que decide la pertenencia. Calcular
        # los extremos por división y filtrar por multiplicación son dos
        # redondeos distintos: un evento cuyo instante caiga a un ULP de una
        # frontera se escapa por la grieta entre dos trozos y no aparece en
        # ninguno. A 200 lpm eso perdía el 10 % de los latidos.
        first = max(0, math.floor(t0_s / interval_s) - 1)
        last = math.ceil(t1_s / interval_s) + 1
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
Expected: PASS, 24 passed (el test parametrizado de troceado genera 10 casos)

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
  - `emg_noise(t_s, level_v, rng, sample_rate_hz) -> np.ndarray` de forma `(12, n)`
  - `mains_noise(t_s, level_v) -> np.ndarray` de forma `(12, n)`
  - `baseline_wander(t_s, level_v, respiration_hz) -> np.ndarray` de forma `(12, n)`
  - `motion_artifact(t_s, level_v, rng, sample_rate_hz) -> tuple[np.ndarray, np.ndarray]` — contribución aditiva y factor multiplicativo.
  - `apply_clipping(signal_v, clip_v) -> np.ndarray`
  - `apply_noise(signal_v, t_s, noise, variability, rng, sample_rate_hz) -> np.ndarray` — aplica la cadena en orden fijo.

La frecuencia de muestreo **se recibe, no se deduce del espaciado de `t_s`**. Deducirla parece inofensivo y no lo es: con una rejilla descendente o no uniforme el cálculo sale negativo o sin sentido y el ruido se desvanece en silencio, sin excepción ni aviso. El resto del paquete ya la pasa explícita —`SignalSource.render` la recibe—, así que inferirla aquí además rompía el patrón establecido.

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
    t = time_grid(0, 500, 500)
    assert t.size == 500
    assert t[0] == pytest.approx(0.0)
    assert np.diff(t) == pytest.approx(np.full(499, 1 / 500))


def test_time_grid_starts_at_the_requested_sample():
    t = time_grid(18750, 10, 500)
    assert t[0] == pytest.approx(37.5)


def test_time_grid_chunks_join_bit_for_bit():
    """La rejilla se construye desde el índice de muestra justamente para
    esto. Con `t0_s + i/sr` la muestra 2001 sale de dos redondeos distintos
    según se pida entera o por trozos, y difiere en un ULP; ese error se
    amplifica al pasar por las gaussianas."""
    whole = time_grid(0, 2500, 500)
    tail = time_grid(2000, 500, 500)
    assert np.array_equal(whole[2000:], tail)


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


def time_grid(
    start_index: int, n_samples: int, sample_rate_hz: int
) -> np.ndarray:
    """Rejilla temporal absoluta de `n_samples` muestras desde `start_index`.

    Toma el **índice de muestra**, no un instante en segundos, y ese detalle
    es lo que hace que dos trozos consecutivos empalmen de forma exacta.
    Construida como `t0_s + i/sr`, la muestra 2001 se calcula como
    `4,0 + 1/500` dentro de un trozo y como `2001/500` en el render completo:
    dos redondeos distintos que difieren en un ULP. Calculada como
    `(índice + i)/sr` la operación es la misma en ambos casos y el resultado
    es idéntico bit a bit.
    """
    return (start_index + np.arange(n_samples, dtype=np.float64)) / float(
        sample_rate_hz
    )


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

from ecg_engine.conduction import CompleteBlock, FixedPR, IrregularConduction
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


def test_ventricular_fibrillation_is_continuous_across_chunks():
    """La normalización de la FV es una constante fijada al construir. Si
    alguien la midiera dentro de `render`, cada trozo tendría su propio
    factor de escala y el trazo saltaría en cada frontera. Ningún otro test
    lo vería: la forma no cambia, el pico espectral tampoco, y la línea de
    base se mide sobre una sola llamada."""
    source = VentricularFibrillationSource(
        coarseness=0.7,
        amplitude_v=0.0004,
        dominant_hz=6.0,
        rng=np.random.default_rng(3),
    )
    whole = source.render(0.0, 1000, 500)
    first = source.render(0.0, 500, 500)
    second = source.render(1.0, 500, 500)
    assert np.allclose(whole[:, :500], first)
    assert np.allclose(whole[:, 500:], second)


def test_set_rate_reaches_the_conduction_policy():
    """En la fibrilación auricular la frecuencia la gobierna el nodo AV, no
    la aurícula: la aurícula va a su aire a más de 400 por minuto. Si
    `set_rate_hz` no llegara hasta la política de conducción, mover el
    control de frecuencia en una FA no haría absolutamente nada."""
    source = BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=420 / 60
        ),
        conduction=IrregularConduction(mean_rr_s=0.85, rr_spread_s=0.15),
        rng=np.random.default_rng(11),
    )
    slow = len(
        [e for e in source.events(0.0, 60.0) if e.kind is EventKind.VENTRICULAR]
    )
    source.set_rate_hz(150 / 60)
    fast = len(
        [e for e in source.events(60.0, 120.0) if e.kind is EventKind.VENTRICULAR]
    )
    assert fast > slow


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
        """Propaga la frecuencia a quien la gobierne en este ritmo.

        En los ritmos con conducción 1:1 manda el tren auricular. En la
        fibrilación auricular manda el nodo AV, porque la aurícula va a su
        aire y lo que el usuario controla es la respuesta ventricular. Los
        trenes regulares ignoran el cambio: su frecuencia es estructural.
        """
        self._atrial.set_rate_hz(rate_hz)
        setter = getattr(self._conduction, "set_rate_hz", None)
        if setter is not None:
            setter(rate_hz)

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        atrial = list(self._atrial.events(t0_s, t1_s))
        # La ventana va explícita: la política no debe deducirla de `atrial`.
        # En la fibrilación auricular un trozo corto puede no contener ni una
        # onda f, y aun así tiene que sonar el latido ventricular que caiga
        # dentro.
        ventricular = self._conduction.conduct(atrial, self._rng, t0_s, t1_s)
        if self._escape is not None:
            ventricular = ventricular + list(self._escape.events(t0_s, t1_s))
        return sorted(atrial + ventricular, key=lambda e: e.t_s)

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        # `t0_s` siempre cae sobre la rejilla de muestreo, porque el motor lo
        # deriva de un contador de muestras. Recuperar ese entero es lo que
        # permite que los trozos empalmen sin arrastrar error de redondeo.
        start_index = round(t0_s * sample_rate_hz)
        t_s = time_grid(start_index, n_samples, sample_rate_hz)
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
        # Amplitud eficaz analítica de la suma de senoides con fases
        # independientes. Es una constante calculada aquí, no una medida
        # tomada sobre cada trozo: medirla trozo a trozo daría un factor de
        # escala distinto en cada uno y el trazo daría un salto en cada
        # frontera. Dividir por la suma de pesos, en cambio, encoge la señal
        # unas cuatro veces y la deja pegada a la línea de base.
        self._norm = float(np.sqrt(np.sum(self._weights**2) / 2.0))

    def set_rate_hz(self, rate_hz: float) -> None:
        """La FV no tiene frecuencia cardíaca. El control no aplica."""
        return None

    def render(
        self, t0_s: float, n_samples: int, sample_rate_hz: int
    ) -> np.ndarray:
        # `t0_s` siempre cae sobre la rejilla de muestreo, porque el motor lo
        # deriva de un contador de muestras. Recuperar ese entero es lo que
        # permite que los trozos empalmen sin arrastrar error de redondeo.
        start_index = round(t0_s * sample_rate_hz)
        t_s = time_grid(start_index, n_samples, sample_rate_hz)
        trace = np.zeros_like(t_s)
        for phase, detune, weight in zip(
            self._phases, self._detunes, self._weights
        ):
            freq_hz = self._dominant_hz * detune
            trace += weight * np.sin(2.0 * np.pi * freq_hz * t_s + phase)
        trace /= self._norm

        # La envolvente modula la amplitud, pero nunca llega a apagarla: en
        # la fibrilación ventricular no hay línea isoeléctrica, la señal no
        # descansa jamás. Una envolvente profunda dejaba tramos de calma que
        # no existen en un paciente en FV.
        envelope = 1.0 + 0.30 * np.sin(2.0 * np.pi * 0.7 * t_s + self._phases[0])

        # La fibrilación gruesa tiene excursiones amplias; la fina, una
        # ondulación menuda y de bajo voltaje. Esa diferencia marca el
        # pronóstico y la respuesta a la desfibrilación.
        trace = trace * envelope * self._coarseness

        return self._lead_gains * (self._amplitude_v * trace)[np.newaxis, :]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_sources.py -v`
Expected: PASS, 17 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/sources.py packages/ecg-engine/tests/unit/test_sources.py
git commit -m "Añadir fuentes de señal por eventos y de fibrilación ventricular"
```

---

### Frecuencia de mando y pulso

Cada `RhythmDefinition` declara `ventricular_rate_hz` además de su
`heart_rate_hz`. Coinciden en los ritmos de conducción 1:1 y divergen justo
donde importa:

| Ritmo | Mando (lpm) | Pulso (lpm) | Por qué difieren |
|---|---|---|---|
| Sinusal normal | 70 | 70 | conducción 1:1 |
| Taquicardia sinusal | 120 | 120 | conducción 1:1 |
| Bradicardia sinusal | 48 | 48 | conducción 1:1 |
| Fibrilación auricular | 80 | 80 | el mando ya es la respuesta ventricular |
| Flutter auricular | 150 | 150 | el mando ya es la respuesta; la aurícula va a 300 |
| TSV | 180 | 180 | conducción 1:1 |
| Taquicardia ventricular | 180 | 180 | el foco ventricular es el mando |
| Fibrilación ventricular | — | 0 | sin frecuencia medible |
| BAV de 1.er grado | 70 | 70 | conducción 1:1, solo con PR largo |
| **BAV 2.º Mobitz I** | **75** | **56,25** | cae una P de cada cuatro |
| **BAV completo** | **75** | **40** | las aurículas no conducen; manda el escape |
| IAM inferior | 78 | 78 | conducción 1:1 |

Las dos filas en negrita son la razón de que el campo exista.

---

### Task 13: El catálogo de ritmos

Aquí es donde se comprueba si la arquitectura funciona. Si algún ritmo obliga a escribir un `if`, el diseño ha fallado y hay que arreglarlo antes de seguir.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/catalog/__init__.py`
- Create: `packages/ecg-engine/src/ecg_engine/catalog/definitions.py`
- Test: `packages/ecg-engine/tests/unit/test_catalog.py`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `RhythmCategory(str, Enum)` con `SINUS`, `SUPRAVENTRICULAR`, `VENTRICULAR`, `BLOCK`, `ISCHEMIA`.
  - `ParameterRange(minimum: float, maximum: float, default: float)` con `clamp(value) -> float`.
  - `RhythmDefinition` — dataclass congelada con `rhythm_id`, `display_name`, `category`, `build_source`, `default_parameters`, `editable_parameters`, `allowed_overlays`, `clinical_description`, `references`.
  - `list_rhythms() -> tuple[RhythmDefinition, ...]`, `get_rhythm(rhythm_id: str) -> RhythmDefinition`, `RHYTHM_IDS: tuple[str, ...]`.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_catalog.py`:

```python
import numpy as np
import pytest

from ecg_engine.catalog import RHYTHM_IDS, get_rhythm, list_rhythms
from ecg_engine.catalog.definitions import ParameterRange, RhythmCategory
from ecg_engine.types import N_LEADS, EventKind

EXPECTED_IDS = {
    "sinus_normal",
    "sinus_tachycardia",
    "sinus_bradycardia",
    "atrial_fibrillation",
    "atrial_flutter",
    "svt",
    "ventricular_tachycardia",
    "ventricular_fibrillation",
    "av_block_first",
    "av_block_second_mobitz_i",
    "av_block_third",
    "stemi_inferior",
}


def test_catalog_contains_exactly_the_twelve_mvp_rhythms():
    assert set(RHYTHM_IDS) == EXPECTED_IDS
    assert len(RHYTHM_IDS) == 12


def test_registry_keys_match_definition_ids():
    assert all(d.rhythm_id in EXPECTED_IDS for d in list_rhythms())


def test_unknown_rhythm_raises_with_a_helpful_message():
    with pytest.raises(KeyError, match="taquicardia_rara"):
        get_rhythm("taquicardia_rara")


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_declares_its_full_contract(rhythm_id):
    definition = get_rhythm(rhythm_id)
    assert definition.display_name
    assert isinstance(definition.category, RhythmCategory)
    assert definition.clinical_description
    assert definition.references, f"{rhythm_id} debe citar al menos una fuente"
    assert "heart_rate_hz" in definition.editable_parameters


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_renders_twelve_leads(rhythm_id):
    source = get_rhythm(rhythm_id).build_source(np.random.default_rng(20260725))
    signal = source.render(0.0, 2500, 500)
    assert signal.shape == (N_LEADS, 2500)
    assert np.isfinite(signal).all()


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_produces_a_non_flat_trace(rhythm_id):
    source = get_rhythm(rhythm_id).build_source(np.random.default_rng(1))
    signal = source.render(0.0, 2500, 500)
    assert np.abs(signal).max() > 0.0001


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_every_rhythm_is_deterministic_for_a_given_seed(rhythm_id):
    first = get_rhythm(rhythm_id).build_source(np.random.default_rng(8))
    second = get_rhythm(rhythm_id).build_source(np.random.default_rng(8))
    assert np.array_equal(first.render(0.0, 1500, 500), second.render(0.0, 1500, 500))


def test_default_rates_are_clinically_correct():
    """Cada ritmo debe nacer en su rango clínico, no en uno genérico."""
    assert get_rhythm("sinus_normal").default_parameters["heart_rate_hz"] == (
        pytest.approx(70 / 60)
    )
    assert get_rhythm("sinus_bradycardia").default_parameters["heart_rate_hz"] < (
        60 / 60
    )
    assert get_rhythm("sinus_tachycardia").default_parameters["heart_rate_hz"] > (
        100 / 60
    )
    assert get_rhythm("svt").default_parameters["heart_rate_hz"] > 150 / 60


def test_editable_rate_ranges_are_bounded_by_physiology():
    """Nadie debe poder poner una bradicardia a 200 lpm desde la interfaz."""
    brady = get_rhythm("sinus_bradycardia").editable_parameters["heart_rate_hz"]
    assert brady.maximum <= 60 / 60
    tachy = get_rhythm("sinus_tachycardia").editable_parameters["heart_rate_hz"]
    assert tachy.minimum >= 100 / 60


def test_parameter_range_clamps_out_of_range_values():
    r = ParameterRange(minimum=1.0, maximum=2.0, default=1.5)
    assert r.clamp(0.0) == 1.0
    assert r.clamp(3.0) == 2.0
    assert r.clamp(1.7) == 1.7


def test_parameter_range_rejects_an_out_of_bounds_default():
    with pytest.raises(ValueError, match="default"):
        ParameterRange(minimum=1.0, maximum=2.0, default=5.0)


def test_only_stemi_declares_the_st_elevation_overlay():
    """El IAM no es un ritmo nuevo: es sinusal más un overlay."""
    assert get_rhythm("stemi_inferior").allowed_overlays == ("st_elevation_inferior",)
    others = [d for d in list_rhythms() if d.rhythm_id != "stemi_inferior"]
    assert all(d.allowed_overlays == () for d in others)


def test_ventricular_fibrillation_exposes_no_rate_control():
    """La FV no tiene frecuencia cardíaca; el catálogo no debe fingir que sí."""
    definition = get_rhythm("ventricular_fibrillation")
    assert definition.category is RhythmCategory.VENTRICULAR
    rate_range = definition.editable_parameters["heart_rate_hz"]
    assert rate_range.minimum == rate_range.maximum


@pytest.mark.parametrize("rhythm_id", sorted(EXPECTED_IDS))
def test_editable_rate_actually_changes_the_ventricular_rate(rhythm_id):
    """Coherencia entre lo que el catálogo promete y lo que el motor hace.

    Si un rango es editable, mover la frecuencia tiene que notarse. Si no se
    nota, el rango debe declararse fijo. Un deslizante que no hace nada es
    peor que un control deshabilitado.
    """
    definition = get_rhythm(rhythm_id)
    rate_range = definition.editable_parameters["heart_rate_hz"]
    source = definition.build_source(np.random.default_rng(5))

    if rate_range.minimum == rate_range.maximum:
        pytest.skip("frecuencia estructural, declarada como fija")

    def ventricular_count() -> int:
        events = source.events(0.0, 60.0)
        return len([e for e in events if e.kind is EventKind.VENTRICULAR])

    source.set_rate_hz(rate_range.minimum)
    slow = ventricular_count()
    source.set_rate_hz(rate_range.maximum)
    fast = len(
        [e for e in source.events(60.0, 120.0) if e.kind is EventKind.VENTRICULAR]
    )
    assert fast > slow


def test_third_degree_block_produces_dissociated_trains():
    source = get_rhythm("av_block_third").build_source(np.random.default_rng(3))
    events = source.events(0.0, 60.0)
    atrial = len([e for e in events if e.kind is EventKind.ATRIAL])
    ventricular = len([e for e in events if e.kind is EventKind.VENTRICULAR])
    assert atrial > ventricular * 1.5


def test_atrial_fibrillation_has_irregular_rr():
    source = get_rhythm("atrial_fibrillation").build_source(np.random.default_rng(3))
    events = source.events(0.0, 120.0)
    ventricular = [e.t_s for e in events if e.kind is EventKind.VENTRICULAR]
    rr = np.diff(ventricular)
    assert rr.std() > 0.08


def test_flutter_conducts_a_fraction_of_its_atrial_waves():
    source = get_rhythm("atrial_flutter").build_source(np.random.default_rng(3))
    events = source.events(0.0, 60.0)
    atrial = len([e for e in events if e.kind is EventKind.ATRIAL])
    ventricular = len([e for e in events if e.kind is EventKind.VENTRICULAR])
    assert atrial / ventricular == pytest.approx(2.0, rel=0.15)


def test_no_rhythm_specific_branching_in_the_engine():
    """Principio arquitectónico 3: cero casos especiales por ritmo.

    Este test es una red de seguridad barata contra la tentación de meter
    un `if rhythm_id == ...` cuando algún ritmo se resista.
    """
    import pathlib

    import ecg_engine

    root = pathlib.Path(ecg_engine.__file__).parent
    offenders = []
    for path in root.rglob("*.py"):
        if path.parent.name == "catalog":
            continue
        source = path.read_text(encoding="utf-8")
        for rhythm_id in RHYTHM_IDS:
            if f'"{rhythm_id}"' in source or f"'{rhythm_id}'" in source:
                offenders.append(f"{path.name}: {rhythm_id}")
    assert offenders == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_catalog.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.catalog'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/catalog/definitions.py`:

```python
"""Los doce ritmos del MVP, como datos.

Si algún ritmo obligara a escribir un `if` fuera de este paquete, la
arquitectura habría fallado. Todo lo que distingue un ritmo de otro cabe en
una `RhythmDefinition`: qué trenes lo componen, qué política de conducción
lo gobierna y qué overlays admite.

Las descripciones clínicas y las referencias no son adorno: son lo que hace
auditable la revisión por un profesional antes de cerrar la fase.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Mapping

import numpy as np

from ..conduction import (
    CompleteBlock,
    FixedPR,
    FixedRatioBlock,
    IrregularConduction,
    WenckebachPR,
)
from ..overlays import ST_ELEVATION_INFERIOR
from ..rhythm import EventTrain, RegularTrain
from ..sources import BeatBasedSource, VentricularFibrillationSource
from ..types import EventKind, SignalSource, VariabilityParams


class RhythmCategory(str, Enum):
    SINUS = "sinus"
    SUPRAVENTRICULAR = "supraventricular"
    VENTRICULAR = "ventricular"
    BLOCK = "block"
    ISCHEMIA = "ischemia"


@dataclass(frozen=True, slots=True)
class ParameterRange:
    """Rango válido de un parámetro editable por el usuario."""

    minimum: float
    maximum: float
    default: float

    def __post_init__(self) -> None:
        if self.minimum > self.maximum:
            raise ValueError(
                f"minimum {self.minimum} supera a maximum {self.maximum}"
            )
        if not self.minimum <= self.default <= self.maximum:
            raise ValueError(
                f"default {self.default} fuera del rango "
                f"[{self.minimum}, {self.maximum}]"
            )

    def clamp(self, value: float) -> float:
        return min(max(value, self.minimum), self.maximum)


@dataclass(frozen=True, slots=True)
class RhythmDefinition:
    """Contrato completo de un ritmo del catálogo.

    `heart_rate_hz`, dentro de `default_parameters` y `editable_parameters`,
    es la **frecuencia de mando**: el valor que el usuario mueve y que el
    motor propaga a quien gobierne el ritmo. En los ritmos sinusales es
    también el pulso del paciente, pero en los bloqueos no: en un Mobitz I
    manda la frecuencia sinusal y uno de cada cuatro latidos no llega al
    ventrículo, y en un bloqueo completo las aurículas van a su aire mientras
    el pulso lo marca el escape.

    `ventricular_rate_hz` es ese pulso: lo que un clínico llama frecuencia
    cardíaca y lo que una interfaz debe mostrar. Separarlos no es purismo.
    Mostrar 75 lpm en un bloqueo AV completo —la frecuencia auricular— cuando
    el paciente tiene un pulso de 40 basta para que un cardiólogo descarte el
    simulador de un vistazo.
    """

    rhythm_id: str
    display_name: str
    category: RhythmCategory
    build_source: Callable[[np.random.Generator], SignalSource]
    default_parameters: Mapping[str, float]
    editable_parameters: Mapping[str, ParameterRange]
    ventricular_rate_hz: float
    clinical_description: str
    references: tuple[str, ...]
    allowed_overlays: tuple[str, ...] = field(default=())


def _bpm(value: float) -> float:
    """Latidos por minuto a hercios. La frontera con las unidades clínicas."""
    return value / 60.0


def _atrial_train(
    rate_hz: float, rng: np.random.Generator, template_id: str = "sinus_p"
) -> EventTrain:
    return EventTrain(
        kind=EventKind.ATRIAL,
        template_id=template_id,
        rate_hz=rate_hz,
        variability=VariabilityParams(),
        rng=rng,
    )


def _sinus_like(
    rate_bpm: float, pr_s: float = 0.16
) -> Callable[[np.random.Generator], SignalSource]:
    def build(rng: np.random.Generator) -> SignalSource:
        return BeatBasedSource(
            atrial=_atrial_train(_bpm(rate_bpm), rng),
            conduction=FixedPR(pr_s=pr_s),
            variability=VariabilityParams(),
            rng=rng,
        )

    return build


def _build_atrial_fibrillation(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        # Actividad auricular caótica de alta frecuencia: ondas f, no ondas P.
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=_bpm(420)
        ),
        conduction=IrregularConduction(mean_rr_s=0.75, rr_spread_s=0.20),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_atrial_flutter(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="flutter_f", rate_hz=_bpm(300)
        ),
        conduction=FixedRatioBlock(ratio=2, pr_s=0.14),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_ventricular_tachycardia(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        # En la TV no hay actividad auricular organizada que conduzca: el
        # tren "auricular" solo marca el paso del foco ventricular.
        atrial=RegularTrain(
            kind=EventKind.ATRIAL, template_id="sinus_p", rate_hz=_bpm(180)
        ),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR, template_id="wide_qrst", rate_hz=_bpm(180)
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_ventricular_fibrillation(rng: np.random.Generator) -> SignalSource:
    return VentricularFibrillationSource(
        coarseness=0.7, amplitude_v=0.00040, dominant_hz=6.0, rng=rng
    )


def _build_av_block_second(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(75), rng),
        conduction=WenckebachPR(
            pr_base_s=0.16, pr_increment_s=0.05, cycle_length=4
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_av_block_third(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(75), rng),
        conduction=CompleteBlock(),
        escape=RegularTrain(
            kind=EventKind.VENTRICULAR, template_id="escape_qrst", rate_hz=_bpm(40)
        ),
        variability=VariabilityParams(),
        rng=rng,
    )


def _build_stemi_inferior(rng: np.random.Generator) -> SignalSource:
    return BeatBasedSource(
        atrial=_atrial_train(_bpm(78), rng),
        conduction=FixedPR(pr_s=0.16),
        overlays=(ST_ELEVATION_INFERIOR,),
        variability=VariabilityParams(),
        rng=rng,
    )


_FIXED_RATE = ParameterRange(minimum=0.0, maximum=0.0, default=0.0)


def _fixed(rate_hz: float) -> ParameterRange:
    """Rango de un solo punto, para ritmos de frecuencia estructural.

    El flutter despolariza la aurícula a 300 por minuto con conducción 2:1, y
    un escape ventricular late a 40. Esas frecuencias definen el ritmo. Ofrecer
    un control deslizante que no hace nada sería mentirle al usuario, así que
    el catálogo declara el rango como fijo y la interfaz lo muestra
    deshabilitado.
    """
    return ParameterRange(minimum=rate_hz, maximum=rate_hz, default=rate_hz)


DEFINITIONS: tuple[RhythmDefinition, ...] = (
    RhythmDefinition(
        rhythm_id="sinus_normal",
        display_name="Ritmo sinusal normal",
        category=RhythmCategory.SINUS,
        build_source=_sinus_like(70),
        default_parameters={"heart_rate_hz": _bpm(70)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(60), _bpm(100), _bpm(70))
        },
        clinical_description=(
            "Onda P precediendo a cada QRS con PR constante entre 120 y 200 ms, "
            "frecuencia entre 60 y 100 lpm y QRS estrecho."
        ),
        references=("Surawicz B, Knilans T. Chou's Electrocardiography, cap. 1",),
    ),
    RhythmDefinition(
        rhythm_id="sinus_tachycardia",
        display_name="Taquicardia sinusal",
        category=RhythmCategory.SINUS,
        build_source=_sinus_like(120),
        default_parameters={"heart_rate_hz": _bpm(120)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(101), _bpm(180), _bpm(120))
        },
        clinical_description=(
            "Ritmo sinusal por encima de 100 lpm. La P puede fundirse con la T "
            "precedente a frecuencias altas."
        ),
        references=("Surawicz B, Knilans T. Chou's Electrocardiography, cap. 13",),
    ),
    RhythmDefinition(
        rhythm_id="sinus_bradycardia",
        display_name="Bradicardia sinusal",
        category=RhythmCategory.SINUS,
        build_source=_sinus_like(48),
        default_parameters={"heart_rate_hz": _bpm(48)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(30), _bpm(59), _bpm(48))
        },
        clinical_description=(
            "Ritmo sinusal por debajo de 60 lpm. Frecuente y benigno en "
            "deportistas y durante el sueño."
        ),
        references=("Surawicz B, Knilans T. Chou's Electrocardiography, cap. 13",),
    ),
    RhythmDefinition(
        rhythm_id="atrial_fibrillation",
        display_name="Fibrilación auricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_build_atrial_fibrillation,
        default_parameters={"heart_rate_hz": _bpm(80)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(50), _bpm(180), _bpm(80))
        },
        clinical_description=(
            "Ausencia de ondas P organizadas, sustituidas por ondas f de "
            "amplitud variable, con respuesta ventricular irregularmente "
            "irregular."
        ),
        references=(
            "Hindricks G, et al. 2020 ESC Guidelines for atrial fibrillation",
        ),
    ),
    RhythmDefinition(
        rhythm_id="atrial_flutter",
        display_name="Flutter auricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_build_atrial_flutter,
        default_parameters={"heart_rate_hz": _bpm(150)},
        editable_parameters={"heart_rate_hz": _fixed(_bpm(150))},
        clinical_description=(
            "Ondas F en dientes de sierra a unos 300 por minuto, con conducción "
            "habitualmente 2:1, lo que da una respuesta ventricular en torno a "
            "150 lpm."
        ),
        references=(
            "Brugada J, et al. 2019 ESC Guidelines for supraventricular "
            "tachycardia",
        ),
    ),
    RhythmDefinition(
        rhythm_id="svt",
        display_name="Taquicardia supraventricular",
        category=RhythmCategory.SUPRAVENTRICULAR,
        build_source=_sinus_like(180, pr_s=0.09),
        default_parameters={"heart_rate_hz": _bpm(180)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(150), _bpm(250), _bpm(180))
        },
        clinical_description=(
            "Taquicardia regular de QRS estrecho entre 150 y 250 lpm, con la P "
            "habitualmente oculta dentro del QRS o de la T."
        ),
        references=(
            "Brugada J, et al. 2019 ESC Guidelines for supraventricular "
            "tachycardia",
        ),
    ),
    RhythmDefinition(
        rhythm_id="ventricular_tachycardia",
        display_name="Taquicardia ventricular",
        category=RhythmCategory.VENTRICULAR,
        build_source=_build_ventricular_tachycardia,
        default_parameters={"heart_rate_hz": _bpm(180)},
        editable_parameters={"heart_rate_hz": _fixed(_bpm(180))},
        clinical_description=(
            "Taquicardia regular de QRS ancho por encima de 120 ms, con "
            "disociación auriculoventricular."
        ),
        references=(
            "Zeppenfeld K, et al. 2022 ESC Guidelines for ventricular "
            "arrhythmias",
        ),
    ),
    RhythmDefinition(
        rhythm_id="ventricular_fibrillation",
        display_name="Fibrilación ventricular",
        category=RhythmCategory.VENTRICULAR,
        build_source=_build_ventricular_fibrillation,
        default_parameters={"heart_rate_hz": 0.0},
        editable_parameters={"heart_rate_hz": _FIXED_RATE},
        clinical_description=(
            "Actividad eléctrica caótica sin complejos identificables ni línea "
            "isoeléctrica. No tiene frecuencia cardíaca medible."
        ),
        references=(
            "Zeppenfeld K, et al. 2022 ESC Guidelines for ventricular "
            "arrhythmias",
        ),
    ),
    RhythmDefinition(
        rhythm_id="av_block_first",
        display_name="Bloqueo AV de primer grado",
        category=RhythmCategory.BLOCK,
        build_source=_sinus_like(70, pr_s=0.26),
        default_parameters={"heart_rate_hz": _bpm(70)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(45), _bpm(100), _bpm(70))
        },
        clinical_description=(
            "PR constante por encima de 200 ms, con conducción 1:1 conservada. "
            "Toda P va seguida de su QRS."
        ),
        references=(
            "Glikson M, et al. 2021 ESC Guidelines on cardiac pacing",
        ),
    ),
    RhythmDefinition(
        rhythm_id="av_block_second_mobitz_i",
        display_name="Bloqueo AV de segundo grado, Mobitz I",
        category=RhythmCategory.BLOCK,
        build_source=_build_av_block_second,
        default_parameters={"heart_rate_hz": _bpm(75)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(50), _bpm(100), _bpm(75))
        },
        clinical_description=(
            "Alargamiento progresivo del PR latido a latido hasta que una onda "
            "P no conduce. Tras la pausa, el PR vuelve a su valor basal."
        ),
        references=(
            "Glikson M, et al. 2021 ESC Guidelines on cardiac pacing",
        ),
    ),
    RhythmDefinition(
        rhythm_id="av_block_third",
        display_name="Bloqueo AV completo",
        category=RhythmCategory.BLOCK,
        build_source=_build_av_block_third,
        default_parameters={"heart_rate_hz": _bpm(75)},
        editable_parameters={"heart_rate_hz": _fixed(_bpm(75))},
        clinical_description=(
            "Disociación auriculoventricular completa: las aurículas y los "
            "ventrículos laten a frecuencias independientes, con un ritmo de "
            "escape ventricular en torno a 40 lpm."
        ),
        references=(
            "Glikson M, et al. 2021 ESC Guidelines on cardiac pacing",
        ),
    ),
    RhythmDefinition(
        rhythm_id="stemi_inferior",
        display_name="IAM inferior con elevación del ST",
        category=RhythmCategory.ISCHEMIA,
        build_source=_build_stemi_inferior,
        default_parameters={"heart_rate_hz": _bpm(78)},
        editable_parameters={
            "heart_rate_hz": ParameterRange(_bpm(50), _bpm(120), _bpm(78))
        },
        allowed_overlays=("st_elevation_inferior",),
        clinical_description=(
            "Ritmo sinusal con elevación del segmento ST en II, III y aVF. No "
            "es un ritmo distinto: es sinusal más un overlay morfológico."
        ),
        references=(
            "Byrne RA, et al. 2023 ESC Guidelines for acute coronary syndromes",
        ),
    ),
)
```

Crear `packages/ecg-engine/src/ecg_engine/catalog/__init__.py`:

```python
"""Acceso al catálogo de ritmos."""

from __future__ import annotations

from .definitions import (
    DEFINITIONS,
    ParameterRange,
    RhythmCategory,
    RhythmDefinition,
)

_BY_ID: dict[str, RhythmDefinition] = {d.rhythm_id: d for d in DEFINITIONS}

RHYTHM_IDS: tuple[str, ...] = tuple(_BY_ID)

__all__ = [
    "RHYTHM_IDS",
    "ParameterRange",
    "RhythmCategory",
    "RhythmDefinition",
    "get_rhythm",
    "list_rhythms",
]


def list_rhythms() -> tuple[RhythmDefinition, ...]:
    return DEFINITIONS


def get_rhythm(rhythm_id: str) -> RhythmDefinition:
    try:
        return _BY_ID[rhythm_id]
    except KeyError as exc:
        known = ", ".join(sorted(_BY_ID))
        raise KeyError(
            f"ritmo desconocido: {rhythm_id!r}. Conocidos: {known}"
        ) from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_catalog.py -v`
Expected: PASS, 88 passed (los tests parametrizados generan 12 casos cada uno; los de frecuencia estructural aparecen como `skipped`)

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/catalog/ packages/ecg-engine/tests/unit/test_catalog.py
git commit -m "Añadir catálogo con los doce ritmos del MVP"
```

---

### Task 14: Medidas derivadas en `measurements.py`

Estas medidas son la base de los golden measurements. Un cambio puede alterar ligeramente las muestras sin tocar la fisiología, o —mucho peor— mantener las muestras casi idénticas mientras desplaza un intervalo. Los golden de muestras cazan lo primero; estos, lo segundo. Y cuando fallan, fallan con un mensaje que se entiende.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/measurements.py`
- Test: `packages/ecg-engine/tests/unit/test_measurements.py`

**Interfaces:**
- Consumes: `CardiacEvent`, `EventKind`, `LEAD_ORDER` de `types.py`; `get_template`, `qrs_duration_s`, `qt_duration_s` de `beat.py`.
- Produces:
  - `PR_DISSOCIATION_THRESHOLD_S: float = 0.05`
  - `Measurements` — dataclass congelada con `heart_rate_hz`, `rr_mean_s`, `rr_std_s`, `pr_mean_s`, `qrs_duration_s`, `qt_s`, `r_amplitude_lead_ii_v`, y método `as_dict() -> dict[str, float]`.
  - `measure(events, signal_v, sample_rate_hz) -> Measurements`

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_measurements.py`:

```python
import math

import numpy as np
import pytest

from ecg_engine.catalog import get_rhythm
from ecg_engine.measurements import Measurements, measure
from ecg_engine.types import LEAD_ORDER, N_LEADS, CardiacEvent, EventKind


def build(rhythm_id: str, seconds: float = 30.0, seed: int = 20260725):
    source = get_rhythm(rhythm_id).build_source(np.random.default_rng(seed))
    n_samples = int(seconds * 500)
    signal = source.render(0.0, n_samples, 500)
    events = source.events(0.0, seconds) if hasattr(source, "events") else []
    return events, signal


def test_measures_heart_rate_from_ventricular_events():
    events, signal = build("sinus_normal", seconds=60.0)
    result = measure(events, signal, 500)
    assert result.heart_rate_hz == pytest.approx(70 / 60, rel=0.05)


def test_bradycardia_measures_below_sixty_bpm():
    events, signal = build("sinus_bradycardia", seconds=60.0)
    assert measure(events, signal, 500).heart_rate_hz < 60 / 60


def test_tachycardia_measures_above_one_hundred_bpm():
    events, signal = build("sinus_tachycardia", seconds=60.0)
    assert measure(events, signal, 500).heart_rate_hz > 100 / 60


def test_rr_standard_deviation_is_small_in_sinus_rhythm():
    events, signal = build("sinus_normal", seconds=60.0)
    assert measure(events, signal, 500).rr_std_s < 0.08


def test_rr_standard_deviation_is_large_in_atrial_fibrillation():
    """La irregularidad del RR es el hallazgo que define la FA."""
    events, signal = build("atrial_fibrillation", seconds=120.0)
    assert measure(events, signal, 500).rr_std_s > 0.10


def test_pr_interval_matches_the_configured_value_in_sinus_rhythm():
    events, signal = build("sinus_normal", seconds=30.0)
    assert measure(events, signal, 500).pr_mean_s == pytest.approx(0.16, abs=0.02)


def test_first_degree_block_measures_a_pr_above_two_hundred_ms():
    events, signal = build("av_block_first", seconds=30.0)
    assert measure(events, signal, 500).pr_mean_s > 0.20


def test_complete_block_reports_no_measurable_pr():
    """Con disociación AV el PR no existe. Devolver un número medio sería
    mentir; se devuelve NaN."""
    events, signal = build("av_block_third", seconds=60.0)
    assert math.isnan(measure(events, signal, 500).pr_mean_s)


def test_ventricular_tachycardia_measures_a_wide_qrs():
    events, signal = build("ventricular_tachycardia", seconds=20.0)
    assert measure(events, signal, 500).qrs_duration_s > 0.120


def test_sinus_rhythm_measures_a_narrow_qrs():
    events, signal = build("sinus_normal", seconds=20.0)
    assert measure(events, signal, 500).qrs_duration_s < 0.120


def test_qt_is_within_the_physiological_range():
    events, signal = build("sinus_normal", seconds=20.0)
    assert 0.30 <= measure(events, signal, 500).qt_s <= 0.46


def test_r_amplitude_is_read_from_lead_two():
    events, signal = build("sinus_normal", seconds=20.0)
    result = measure(events, signal, 500)
    assert result.r_amplitude_lead_ii_v == pytest.approx(
        signal[LEAD_ORDER.index("II")].max(), rel=1e-9
    )


def test_mixed_ventricular_morphologies_report_no_single_qrs():
    """Si un trazado mezcla latidos conducidos y de escape no existe «el»
    QRS: hay dos morfologías conviviendo. Devolver la del primero sería un
    número arbitrario disfrazado de medida, exactamente igual que promediar
    un PR disociado. La arquitectura ya permite esa mezcla —una política de
    conducción más un tren de escape en la misma fuente—, así que la medida
    tiene que estar preparada aunque hoy ningún ritmo del catálogo la use."""
    events = [
        CardiacEvent(
            kind=EventKind.VENTRICULAR, t_s=0.0, template_id="normal_qrst", index=0
        ),
        CardiacEvent(
            kind=EventKind.VENTRICULAR, t_s=1.0, template_id="escape_qrst", index=1
        ),
    ]
    result = measure(events, np.zeros((N_LEADS, 1000)), 500)
    assert math.isnan(result.qrs_duration_s)
    assert math.isnan(result.qt_s)
    assert not math.isnan(result.heart_rate_hz)  # la frecuencia sí es medible


def test_measurements_without_events_report_nan_timings():
    """La fibrilación ventricular no tiene eventos discretos que medir."""
    signal = np.zeros((N_LEADS, 5000))
    result = measure([], signal, 500)
    assert math.isnan(result.heart_rate_hz)
    assert math.isnan(result.pr_mean_s)


def test_as_dict_exposes_every_field_for_the_golden_files():
    events, signal = build("sinus_normal", seconds=20.0)
    payload = measure(events, signal, 500).as_dict()
    assert set(payload) == {
        "heart_rate_hz",
        "rr_mean_s",
        "rr_std_s",
        "pr_mean_s",
        "qrs_duration_s",
        "qt_s",
        "r_amplitude_lead_ii_v",
    }
    assert all(isinstance(v, float) for v in payload.values())


def test_measurements_are_immutable():
    import dataclasses

    events, signal = build("sinus_normal", seconds=10.0)
    result = measure(events, signal, 500)
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.heart_rate_hz = 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_measurements.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.measurements'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/measurements.py`:

```python
"""Medidas fisiológicas derivadas de una simulación.

Son la base de los golden measurements. Su valor está en que fallan con un
mensaje que se entiende: «el PR medio pasó de 160 a 190 ms» dice algo, «el
array difiere en la posición 4127» no dice nada.

Los tiempos se miden sobre los **eventos**, no sobre la señal: detectar picos
en una señal con ruido introduce sus propios errores, y aquí lo que interesa
es verificar la fisiología que el motor pretende generar.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Sequence

import numpy as np

from .beat import get_template, qrs_duration_s, qt_duration_s
from .types import LEAD_ORDER, CardiacEvent, EventKind

PR_DISSOCIATION_THRESHOLD_S: float = 0.05
"""Por encima de esta dispersión, el PR deja de considerarse medible.

En un bloqueo AV completo cada QRS cae a una distancia arbitraria de la P
anterior. Promediar esas distancias daría un número perfectamente calculado y
clínicamente falso, así que se devuelve NaN.
"""


@dataclass(frozen=True, slots=True)
class Measurements:
    heart_rate_hz: float
    rr_mean_s: float
    rr_std_s: float
    pr_mean_s: float
    qrs_duration_s: float
    qt_s: float
    r_amplitude_lead_ii_v: float

    def as_dict(self) -> dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


def _pr_mean_s(
    atrial_times: np.ndarray, ventricular_times: np.ndarray
) -> float:
    if atrial_times.size == 0 or ventricular_times.size == 0:
        return math.nan
    intervals: list[float] = []
    for qrs_s in ventricular_times:
        preceding = atrial_times[atrial_times <= qrs_s]
        if preceding.size:
            intervals.append(float(qrs_s - preceding[-1]))
    if not intervals:
        return math.nan
    if float(np.std(intervals)) > PR_DISSOCIATION_THRESHOLD_S:
        return math.nan  # disociación auriculoventricular
    return float(np.mean(intervals))


def measure(
    events: Sequence[CardiacEvent],
    signal_v: np.ndarray,
    sample_rate_hz: int,
) -> Measurements:
    """Extrae las medidas fisiológicas de una simulación."""
    atrial = np.array(
        [e.t_s for e in events if e.kind is EventKind.ATRIAL], dtype=np.float64
    )
    ventricular = np.array(
        [e.t_s for e in events if e.kind is EventKind.VENTRICULAR], dtype=np.float64
    )

    duration_s = signal_v.shape[1] / float(sample_rate_hz)
    heart_rate_hz = (
        float(ventricular.size) / duration_s if ventricular.size else math.nan
    )

    rr = np.diff(ventricular) if ventricular.size > 1 else np.array([])
    rr_mean_s = float(rr.mean()) if rr.size else math.nan
    rr_std_s = float(rr.std()) if rr.size else math.nan

    ventricular_events = [e for e in events if e.kind is EventKind.VENTRICULAR]
    template_ids = {e.template_id for e in ventricular_events}
    if len(template_ids) == 1:
        template = get_template(next(iter(template_ids)))
        qrs_s = qrs_duration_s(template)
        qt_s = qt_duration_s(template)
    else:
        # Sin latidos ventriculares no hay nada que medir. Y con latidos de
        # morfología distinta en el mismo trazado —conducidos y de escape
        # conviviendo— tampoco existe «el» QRS: hay dos. Devolver el del
        # primero sería un número arbitrario con apariencia de medida, el
        # mismo error que el PR evita ante una disociación.
        qrs_s = math.nan
        qt_s = math.nan

    return Measurements(
        heart_rate_hz=heart_rate_hz,
        rr_mean_s=rr_mean_s,
        rr_std_s=rr_std_s,
        pr_mean_s=_pr_mean_s(atrial, ventricular),
        qrs_duration_s=qrs_s,
        qt_s=qt_s,
        r_amplitude_lead_ii_v=float(signal_v[LEAD_ORDER.index("II")].max()),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_measurements.py -v`
Expected: PASS, 15 passed

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/measurements.py packages/ecg-engine/tests/unit/test_measurements.py
git commit -m "Añadir medidas fisiológicas derivadas"
```

---

### Task 15: El orquestador `EcgEngine`

La API pública del paquete. Mantiene el reloj de simulación, aplica el ruido y acepta cambios de parámetros en caliente sin recrear la simulación.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/engine.py`
- Modify: `packages/ecg-engine/src/ecg_engine/__init__.py`
- Test: `packages/ecg-engine/tests/unit/test_engine.py`

**Interfaces:**
- Consumes: `get_rhythm` de `catalog`; `apply_noise` de `noise.py`; `time_grid` de `renderer.py`; `EngineParams`, `DEFAULT_SAMPLE_RATE_HZ` de `types.py`.
- Produces:
  - `EcgEngine(rhythm_id: str, seed: int, sample_rate_hz: int = 500, params: EngineParams | None = None)`
  - Métodos: `generate(n_samples: int) -> np.ndarray`, `update_params(params: EngineParams) -> None`, `reset() -> None`.
  - Propiedades de solo lectura: `t_s: float`, `rhythm_id: str`, `seed: int`, `sample_rate_hz: int`, `params: EngineParams`, `source: SignalSource`.
  - Reexportado en `ecg_engine`: `EcgEngine`, `EngineParams`, `NoiseParams`, `VariabilityParams`, `get_rhythm`, `list_rhythms`, `measure`.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/unit/test_engine.py`:

```python
import numpy as np
import pytest

from ecg_engine import EcgEngine, EngineParams, NoiseParams
from ecg_engine.types import N_LEADS


def engine(rhythm_id: str = "sinus_normal", seed: int = 20260725) -> EcgEngine:
    return EcgEngine(rhythm_id=rhythm_id, seed=seed)


def test_generate_returns_twelve_leads_of_the_requested_length():
    signal = engine().generate(500)
    assert signal.shape == (N_LEADS, 500)
    assert signal.dtype == np.float64


def test_clock_advances_by_the_generated_duration():
    eng = engine()
    assert eng.t_s == 0.0
    eng.generate(500)
    assert eng.t_s == pytest.approx(1.0)
    eng.generate(250)
    assert eng.t_s == pytest.approx(1.5)


def test_consecutive_chunks_join_without_a_discontinuity():
    """Requisito del streaming: sin esto, el trazo daría un salto cada 100 ms."""
    eng = engine()
    first = eng.generate(500)
    second = eng.generate(500)
    step = abs(second[1, 0] - first[1, -1])
    assert step < 0.0002


def test_chunked_generation_equals_a_single_large_generation():
    """La tolerancia es física, no de conveniencia. La rejilla se construye
    desde el índice de muestra, así que los trozos empalman de forma exacta;
    esta cota deja margen por si alguna ruta futura reintroduce redondeo.
    Un ECG real de 16 bits tiene un bit menos significativo de unos
    1,5·10⁻⁷ V, cien veces por encima de este umbral: cualquier diferencia
    que este test tolere es indetectable en un aparato."""
    whole = engine().generate(2500)
    chunked_engine = engine()
    chunks = [chunked_engine.generate(500) for _ in range(5)]
    assert np.allclose(whole, np.concatenate(chunks, axis=1), atol=1e-9)


def test_same_seed_and_params_reproduce_the_signal_bit_for_bit():
    """Sin esto no hay golden signals ni replay."""
    assert np.array_equal(engine(seed=42).generate(2500), engine(seed=42).generate(2500))


def test_different_seeds_produce_different_signals():
    assert not np.array_equal(
        engine(seed=1).generate(2500), engine(seed=2).generate(2500)
    )


def test_unknown_rhythm_fails_fast():
    with pytest.raises(KeyError, match="no_existe"):
        EcgEngine(rhythm_id="no_existe", seed=1)


def test_engine_starts_with_the_rhythm_default_parameters():
    assert engine().params.heart_rate_hz == pytest.approx(70 / 60)


def test_update_params_changes_the_rate_without_restarting():
    eng = engine()
    eng.generate(2500)
    t_before = eng.t_s
    # 100 lpm está dentro del rango editable del ritmo sinusal normal
    # (60-100). Pedir más lo recortaría, que es lo que comprueba el test
    # siguiente: aquí lo que se verifica es que el cambio se aplica sin
    # reiniciar el reloj.
    eng.update_params(EngineParams(heart_rate_hz=100 / 60))
    eng.generate(2500)
    assert eng.t_s == pytest.approx(t_before + 5.0)
    assert eng.params.heart_rate_hz == pytest.approx(100 / 60)


def test_update_params_clamps_the_rate_to_the_rhythm_range():
    """Una bradicardia sinusal no puede ir a 300 lpm por mucho que lo pidan."""
    eng = engine("sinus_bradycardia")
    eng.update_params(EngineParams(heart_rate_hz=300 / 60))
    assert eng.params.heart_rate_hz <= 60 / 60


def test_noise_free_engine_matches_the_clean_source():
    clean = engine().generate(1000)
    assert np.abs(clean).max() < 0.01  # sin ruido, amplitudes fisiológicas


def test_enabling_noise_increases_signal_variance():
    quiet = engine().generate(2500)
    noisy_engine = engine()
    noisy_engine.update_params(
        EngineParams(
            heart_rate_hz=70 / 60,
            noise=NoiseParams(emg_v=2e-5, mains_v=1e-5, baseline_v=1e-4),
        )
    )
    assert noisy_engine.generate(2500).std() > quiet.std()


def test_reset_returns_the_clock_and_the_signal_to_the_origin():
    eng = engine()
    first = eng.generate(1000)
    eng.generate(1000)
    eng.reset()
    assert eng.t_s == 0.0
    assert np.array_equal(eng.generate(1000), first)


def test_generate_rejects_a_non_positive_sample_count():
    with pytest.raises(ValueError, match="n_samples"):
        engine().generate(0)


@pytest.mark.parametrize(
    "rhythm_id",
    [
        "sinus_normal", "sinus_tachycardia", "sinus_bradycardia",
        "atrial_fibrillation", "atrial_flutter", "svt",
        "ventricular_tachycardia", "ventricular_fibrillation",
        "av_block_first", "av_block_second_mobitz_i", "av_block_third",
        "stemi_inferior",
    ],
)
def test_every_catalog_rhythm_drives_the_engine(rhythm_id):
    signal = EcgEngine(rhythm_id=rhythm_id, seed=7).generate(2500)
    assert signal.shape == (N_LEADS, 2500)
    assert np.isfinite(signal).all()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_engine.py -v`
Expected: FAIL con `ImportError: cannot import name 'EcgEngine' from 'ecg_engine'`

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/src/ecg_engine/engine.py`:

```python
"""Orquestador del motor.

Mantiene el reloj de simulación, compone la fuente del catálogo con la cadena
de ruido y acepta cambios de parámetros en caliente sin recrear nada.

El reloj avanza solo cuando se generan muestras, así que pausar la simulación
es simplemente dejar de llamar a `generate`.
"""

from __future__ import annotations

import numpy as np

from .catalog import get_rhythm
from .noise import apply_noise
from .renderer import time_grid
from .types import DEFAULT_SAMPLE_RATE_HZ, EngineParams, SignalSource


class EcgEngine:
    """API pública del motor fisiológico."""

    def __init__(
        self,
        rhythm_id: str,
        seed: int,
        sample_rate_hz: int = DEFAULT_SAMPLE_RATE_HZ,
        params: EngineParams | None = None,
    ) -> None:
        self._definition = get_rhythm(rhythm_id)  # lanza KeyError si no existe
        self._seed = seed
        self._sample_rate_hz = sample_rate_hz
        self._params = self._clamped(
            params
            if params is not None
            else EngineParams(
                heart_rate_hz=self._definition.default_parameters["heart_rate_hz"]
            )
        )
        self._sample_index = 0
        self._source: SignalSource = self._build_source()

    # --- construcción y estado --------------------------------------------

    def _build_source(self) -> SignalSource:
        """Cada fuente recibe su propio generador, derivado de la semilla."""
        source = self._definition.build_source(np.random.default_rng(self._seed))
        source.set_rate_hz(self._params.heart_rate_hz)
        self._noise_rng = np.random.default_rng(self._seed + 1)
        return source

    def _clamped(self, params: EngineParams) -> EngineParams:
        """Recorta la frecuencia al rango clínico declarado por el ritmo."""
        rate_range = self._definition.editable_parameters["heart_rate_hz"]
        clamped_hz = rate_range.clamp(params.heart_rate_hz)
        if clamped_hz == params.heart_rate_hz:
            return params
        return EngineParams(
            heart_rate_hz=clamped_hz,
            noise=params.noise,
            variability=params.variability,
        )

    # --- propiedades -------------------------------------------------------

    @property
    def t_s(self) -> float:
        return self._sample_index / float(self._sample_rate_hz)

    @property
    def rhythm_id(self) -> str:
        return self._definition.rhythm_id

    @property
    def seed(self) -> int:
        return self._seed

    @property
    def sample_rate_hz(self) -> int:
        return self._sample_rate_hz

    @property
    def params(self) -> EngineParams:
        return self._params

    @property
    def source(self) -> SignalSource:
        """Fuente subyacente, de solo lectura.

        La necesitan los golden signals para inspeccionar la línea de eventos
        además de las muestras. Exponerla como propiedad evita que los tests
        hurguen en atributos privados.
        """
        return self._source

    # --- operación ---------------------------------------------------------

    def update_params(self, params: EngineParams) -> None:
        """Aplica parámetros nuevos sin reiniciar la simulación."""
        self._params = self._clamped(params)
        self._source.set_rate_hz(self._params.heart_rate_hz)

    def reset(self) -> None:
        """Vuelve al origen. Con la misma semilla, repite la señal exacta."""
        self._sample_index = 0
        self._source = self._build_source()

    def generate(self, n_samples: int) -> np.ndarray:
        """Genera el siguiente bloque de señal y avanza el reloj."""
        if n_samples <= 0:
            raise ValueError(f"n_samples debe ser positivo, recibido {n_samples}")
        t0_s = self.t_s
        signal = self._source.render(t0_s, n_samples, self._sample_rate_hz)
        # El orquestador sí tiene el índice a mano, así que lo usa directo.
        t_s = time_grid(self._sample_index, n_samples, self._sample_rate_hz)
        signal = apply_noise(
            signal,
            t_s,
            self._params.noise,
            self._params.variability,
            self._noise_rng,
        )
        self._sample_index += n_samples
        return signal
```

Reemplazar el contenido de `packages/ecg-engine/src/ecg_engine/__init__.py`:

```python
"""Motor fisiológico de generación de ECG.

Trabaja exclusivamente en unidades SI: segundos, voltios y hercios.

    from ecg_engine import EcgEngine

    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    signal = engine.generate(500)   # (12, 500) en voltios
"""

from .catalog import get_rhythm, list_rhythms
from .engine import EcgEngine
from .measurements import Measurements, measure
from .types import (
    DEFAULT_SAMPLE_RATE_HZ,
    LEAD_ORDER,
    EngineParams,
    NoiseParams,
    VariabilityParams,
)

__version__ = "1.0.0"

__all__ = [
    "DEFAULT_SAMPLE_RATE_HZ",
    "LEAD_ORDER",
    "EcgEngine",
    "EngineParams",
    "Measurements",
    "NoiseParams",
    "VariabilityParams",
    "get_rhythm",
    "list_rhythms",
    "measure",
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/unit -v`
Expected: PASS, toda la suite unitaria en verde

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/engine.py packages/ecg-engine/src/ecg_engine/__init__.py packages/ecg-engine/tests/unit/test_engine.py
git commit -m "Añadir orquestador EcgEngine y API pública del paquete"
```

---

### Task 16: Golden signals en tres niveles

Tres niveles, porque detectan cosas distintas. Los de eventos cazan cambios en la fisiología con mensajes legibles. Los de muestras cazan cualquier alteración del renderizado. Los de medidas cazan lo peor: que las muestras apenas cambien mientras un intervalo se desplaza.

Dos suites: limpia con ruido a cero, y con ruido a nivel fijo. Nunca se mezclan.

**Files:**
- Create: `packages/ecg-engine/tests/golden/conftest.py`
- Create: `packages/ecg-engine/tests/golden/generate_golden.py`
- Create: `packages/ecg-engine/tests/golden/test_golden.py`
- Create: `packages/ecg-engine/tests/golden/data/` (generado)

**Interfaces:**
- Consumes: `EcgEngine`, `measure`, `list_rhythms`, `EngineParams`, `NoiseParams` de `ecg_engine`.
- Produces: `GOLDEN_SEED`, `GOLDEN_DURATION_S`, `NOISY_PARAMS`, `golden_dir()`, `simulate(rhythm_id, noisy)` en `conftest.py`, reutilizado por el generador y por los tests.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/golden/conftest.py`:

```python
"""Utilidades compartidas entre el generador de golden files y sus tests.

Que ambos usen exactamente el mismo código de simulación no es opcional: si
divergen, los golden dejan de comprobar lo que creemos que comprueban.
"""

from __future__ import annotations

import pathlib

import numpy as np

from ecg_engine import EcgEngine, EngineParams, NoiseParams, measure

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
        "measurements": measure(events, signal, GOLDEN_SAMPLE_RATE_HZ).as_dict(),
    }


def golden_paths(rhythm_id: str, noisy: bool) -> dict[str, pathlib.Path]:
    suite = "noisy" if noisy else "clean"
    base = golden_dir() / suite
    return {
        "signal": base / f"{rhythm_id}.samples.npy",
        "events": base / f"{rhythm_id}.events.json",
        "measurements": base / f"{rhythm_id}.measurements.json",
    }
```

Crear `packages/ecg-engine/tests/golden/test_golden.py`:

```python
import json

import numpy as np
import pytest

from ecg_engine import list_rhythms

from .conftest import golden_paths, simulate

RHYTHM_IDS = [d.rhythm_id for d in list_rhythms()]
SUITES = [False, True]
SUITE_NAMES = {False: "clean", True: "noisy"}

SAMPLE_TOLERANCE_V = 1e-12
MEASUREMENT_TOLERANCE = 1e-9


@pytest.mark.parametrize("noisy", SUITES, ids=SUITE_NAMES.get)
@pytest.mark.parametrize("rhythm_id", RHYTHM_IDS)
def test_golden_samples_are_unchanged(rhythm_id, noisy):
    """Regresión de señal. Si falla sin un cambio intencional del motor,
    algo se ha roto."""
    path = golden_paths(rhythm_id, noisy)["signal"]
    if not path.exists():
        pytest.fail(
            f"falta el golden {path.name}. Genera con: "
            "uv run python tests/golden/generate_golden.py"
        )
    expected = np.load(path)
    actual = simulate(rhythm_id, noisy)["signal"]
    assert actual.shape == expected.shape
    np.testing.assert_allclose(actual, expected, atol=SAMPLE_TOLERANCE_V)


@pytest.mark.parametrize("noisy", SUITES, ids=SUITE_NAMES.get)
@pytest.mark.parametrize("rhythm_id", RHYTHM_IDS)
def test_golden_events_are_unchanged(rhythm_id, noisy):
    """Regresión de fisiología, con mensajes legibles: aquí un fallo dice
    qué evento se movió, no en qué índice del array difiere un float."""
    path = golden_paths(rhythm_id, noisy)["events"]
    expected = json.loads(path.read_text(encoding="utf-8"))
    actual = simulate(rhythm_id, noisy)["events"]
    assert [list(e) for e in actual] == expected


@pytest.mark.parametrize("noisy", SUITES, ids=SUITE_NAMES.get)
@pytest.mark.parametrize("rhythm_id", RHYTHM_IDS)
def test_golden_measurements_are_unchanged(rhythm_id, noisy):
    """Caza el caso peor: muestras casi idénticas con un intervalo desplazado."""
    path = golden_paths(rhythm_id, noisy)["measurements"]
    expected = json.loads(path.read_text(encoding="utf-8"))
    actual = simulate(rhythm_id, noisy)["measurements"]
    assert set(actual) == set(expected)
    for key, expected_value in expected.items():
        actual_value = actual[key]
        if expected_value is None:
            assert np.isnan(actual_value), f"{key} debía ser NaN"
        else:
            assert actual_value == pytest.approx(
                expected_value, abs=MEASUREMENT_TOLERANCE
            ), f"{key}: {expected_value} → {actual_value}"


def test_every_catalog_rhythm_has_golden_files():
    """Un ritmo nuevo sin golden es un ritmo sin red de seguridad."""
    missing = [
        path.name
        for rhythm_id in RHYTHM_IDS
        for noisy in SUITES
        for path in golden_paths(rhythm_id, noisy).values()
        if not path.exists()
    ]
    assert missing == []


def test_clean_and_noisy_suites_actually_differ():
    """Si coincidieran, la suite con ruido no estaría probando nada."""
    clean = simulate("sinus_normal", noisy=False)["signal"]
    noisy = simulate("sinus_normal", noisy=True)["signal"]
    assert not np.allclose(clean, noisy)


def test_clean_suite_has_no_noise_at_all():
    """Los tests de fisiología corren con el ruido a cero. Sin excepciones."""
    from .conftest import GOLDEN_SEED, GOLDEN_SAMPLE_RATE_HZ
    from ecg_engine import EcgEngine

    engine = EcgEngine(rhythm_id="sinus_normal", seed=GOLDEN_SEED)
    assert engine.params.noise.emg_v == 0.0
    assert engine.params.noise.mains_v == 0.0
    assert engine.params.noise.baseline_v == 0.0
    assert engine.params.noise.motion_v == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/golden -v`
Expected: FAIL — los ficheros de `tests/golden/data/` todavía no existen

- [ ] **Step 3: Write minimal implementation**

Crear `packages/ecg-engine/tests/golden/generate_golden.py`:

```python
"""Genera los ficheros de referencia de golden signals.

**Ejecutar solo ante un cambio intencional y documentado del motor.**
Regenerar los golden para «arreglar» un test que ha empezado a fallar
equivale a borrar la alarma de incendios porque suena.

    uv run python tests/golden/generate_golden.py
"""

from __future__ import annotations

import json
import math
import sys

import numpy as np

from ecg_engine import list_rhythms

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from conftest import golden_paths, simulate  # noqa: E402


def _json_safe(value: float) -> float | None:
    """NaN no es JSON válido. Un PR no medible se guarda como null."""
    return None if math.isnan(value) else value


def main() -> None:
    written = 0
    for definition in list_rhythms():
        for noisy in (False, True):
            result = simulate(definition.rhythm_id, noisy)
            paths = golden_paths(definition.rhythm_id, noisy)
            paths["signal"].parent.mkdir(parents=True, exist_ok=True)

            np.save(paths["signal"], result["signal"])
            paths["events"].write_text(
                json.dumps(result["events"], indent=2), encoding="utf-8"
            )
            paths["measurements"].write_text(
                json.dumps(
                    {k: _json_safe(v) for k, v in result["measurements"].items()},
                    indent=2,
                ),
                encoding="utf-8",
            )
            written += 3
            suite = "noisy" if noisy else "clean"
            print(f"  {definition.rhythm_id} [{suite}]")

    print(f"\n{written} ficheros escritos en tests/golden/data/")


if __name__ == "__main__":
    main()
```

Generar los ficheros de referencia:

```bash
cd packages/ecg-engine && uv run python tests/golden/generate_golden.py
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ecg-engine && uv run pytest tests/golden -v`
Expected: PASS, 74 passed (12 ritmos × 2 suites × 3 niveles, más 3 tests de integridad)

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/tests/golden/
git commit -m "Añadir golden signals en tres niveles con suites limpia y con ruido"
```

---

### Task 17: Benchmarks y verificación final

Objetivos, no límites duros: existen para detectar regresiones de rendimiento, no para justificar optimización prematura.

**Files:**
- Create: `packages/ecg-engine/tests/benchmarks/test_performance.py`
- Modify: `packages/ecg-engine/README.md`

**Interfaces:**
- Consumes: `EcgEngine`, `list_rhythms` de `ecg_engine`.
- Produces: nada que consuman otras tareas. Cierra el plan.

- [ ] **Step 1: Write the failing test**

Crear `packages/ecg-engine/tests/benchmarks/test_performance.py`:

```python
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


def _median_chunk_s(engine, reps: int = 25) -> float:
    """Mediana de varias generaciones, para que el ruido del reloj no mande."""
    return statistics.median(
        elapsed_s(lambda: engine.generate(REALTIME_CHUNK_SAMPLES))
        for _ in range(reps)
    )


def test_generation_cost_does_not_grow_over_a_long_session():
    """La línea temporal de los trenes se cachea y crece con la sesión, así
    que este test existe para detectar que esa caché degrade a comportamiento
    cuadrático. Por eso recorre los diez minutos de la sesión de referencia,
    no uno.

    El umbral es relativo de verdad. Compararlo contra un techo absoluto
    —«que el trozo tardío siga cabiendo en 5 ms»— dejaba pasar una
    degradación de veinte veces sin decir nada, porque el presupuesto de
    tiempo real es tan holgado que la absorbe entera. Lo que interesa vigilar
    aquí no es si cabe, sino si crece."""
    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    engine.generate(REALTIME_CHUNK_SAMPLES)  # descarta el coste de arranque
    early_s = _median_chunk_s(engine)

    for _ in range(6000):  # diez minutos de simulación
        engine.generate(REALTIME_CHUNK_SAMPLES)

    late_s = _median_chunk_s(engine)
    assert late_s < early_s * 4.0, (
        f"el coste por trozo pasó de {early_s * 1000:.3f} ms a "
        f"{late_s * 1000:.3f} ms tras diez minutos de simulación"
    )


def test_ten_minutes_of_simulation_produce_finite_values_throughout():
    """Criterio de aceptación 2: diez minutos sin deriva ni valores rotos."""
    engine = EcgEngine(rhythm_id="sinus_normal", seed=20260725)
    for _ in range(6000):  # 600 s en chunks de 100 ms
        chunk = engine.generate(REALTIME_CHUNK_SAMPLES)
        assert np.isfinite(chunk).all()
    assert engine.t_s == pytest.approx(600.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ecg-engine && uv run pytest tests/benchmarks -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'tests.benchmarks'` o, si el motor es lento, fallo de presupuesto en `test_ten_seconds_of_ecg_generate_under_fifty_milliseconds`

- [ ] **Step 3: Write minimal implementation**

Si algún benchmark falla, la causa más probable es el bucle por evento de `render_events`, que evalúa cada gaussiana sobre la rejilla completa. La optimización es acotar cada componente a su ventana de ±4σ en lugar de a toda la rejilla.

Modificar `packages/ecg-engine/src/ecg_engine/renderer.py`, reemplazando `_trace_for_event`:

```python
_COMPONENT_EXTENT_SIGMA: float = 4.0


def _trace_for_event(t_s: np.ndarray, event: CardiacEvent) -> np.ndarray:
    """Suma las componentes del evento, cada una solo en su ventana útil.

    Más allá de cuatro desviaciones típicas una gaussiana aporta menos de
    3·10⁻⁵ de su amplitud: por debajo del ruido de cuantización de cualquier
    ECG real. Restringir el cálculo a esa ventana evita evaluar cada onda
    sobre la rejilla entera.
    """
    trace = np.zeros_like(t_s)
    if t_s.size == 0:
        return trace
    sample_period_s = float(t_s[1] - t_s[0]) if t_s.size > 1 else 1.0

    for component in get_template(event.template_id).components:
        center_s = event.t_s + component.center_s
        half_width_s = _COMPONENT_EXTENT_SIGMA * component.width_s
        start = int(np.searchsorted(t_s, center_s - half_width_s, side="left"))
        end = int(np.searchsorted(t_s, center_s + half_width_s, side="right"))
        if start >= end:
            continue
        window = t_s[start:end]
        trace[start:end] += render_component(window, component, offset_s=event.t_s)

    return trace
```

Añadir el import de `numpy.searchsorted` no hace falta; `np` ya está importado.

Actualizar `packages/ecg-engine/README.md`:

```markdown
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
```

- [ ] **Step 4: Run the whole suite**

Run: `cd packages/ecg-engine && uv run pytest -v`
Expected: PASS, toda la suite en verde — unitarios, golden y benchmarks

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/
git commit -m "Añadir benchmarks de rendimiento del motor"
```

---

## Cierre del plan

Al terminar la tarea 17, el paquete `ecg-engine` cumple la parte de los criterios de aceptación de la fase 1 que le corresponde:

| Criterio | Cubierto por |
|---|---|
| 1. Doce ritmos en doce derivaciones | Tareas 13 y 15 |
| 4. Reproducible desde la semilla | Tareas 15 y 16 |
| 5. Golden signals en tres niveles y dos suites | Tarea 16 |
| 6. Benchmarks dentro de objetivo | Tarea 17 |

Quedan fuera de este plan, por depender de la API o del navegador:

- **Criterio 2** (60 fps durante diez minutos): plan C. La tarea 17 verifica la mitad que sí es del motor —diez minutos de generación sin deriva ni valores rotos—.
- **Criterio 3** (parámetros en caliente): el motor lo soporta desde la tarea 15; el control de usuario llega en los planes B y C.
- **Criterio 7** (revisión clínica): requiere ver los trazados renderizados, así que se hace tras el plan C. Las `references` del catálogo son el material de contraste.

**Siguiente paso tras ejecutar este plan:** escribir el plan B (API y streaming), ya con los contratos del motor fijados en código en lugar de sobre el papel.

