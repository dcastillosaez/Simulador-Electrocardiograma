# Eje eléctrico cardíaco — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la tabla fija de proyección de derivaciones en una proyección calculada a partir de un ángulo, de modo que un parámetro de orientación eléctrica —editable en caliente por la API y por un panel hexaxial— modifique las seis derivaciones de miembros exactamente como en un paciente real, sin cambiar ni una muestra del comportamiento actual.

**Architecture:** El motor gana `AxisParams` (orientación anatómica + un desfase por onda) y una función `projection_for_axis(ángulo)` que reproduce con exactitud verificable la tabla histórica. `render_events` pasa de recibir un `Mapping[EventKind, LeadProjection]` a un `LeadProjectionSet` con proyección propia para P, QRS, ST y T. El eje viaja como campo de `EngineParams`, se propaga a la fuente por un método `set_axis` espejo de `set_rate_hz`, y el frontend lo controla con un disco hexaxial en SVG. Las precordiales conservan sus tablas fijas: el eje frontal solo gobierna las derivaciones de miembros.

**Tech Stack:** Python 3.11 + numpy (`packages/ecg-engine`), Pydantic + FastAPI (`apps/api`), React 18 + TypeScript + Zustand + Vitest + Testing Library (`apps/web`, `packages/ui-system`).

## Global Constraints

- **Regresión cero.** Los golden signals comparan con `np.testing.assert_allclose` a tolerancia `1e-12` (efectivamente bit a bit). Deben pasar **sin regenerarse**. Para lograrlo, la orientación de referencia (el `AxisParams` por defecto) usa las tablas históricas literales —`projection_set_for_axis` hace short-circuit a `DEFAULT_PROJECTION_SET`—, y solo un eje desviado se calcula por trigonometría; `projection_for_axis(50°)` reproduce la tabla solo dentro del redondeo (~3e-4), no bit a bit. Regenerar un golden para acomodar esta refactorización es un fallo del plan.
- **Solo derivaciones de miembros.** El eje frontal gobierna I, II, III, aVR, aVL, aVF y **nada más**. V1–V6 conservan sus tablas actuales (`QRS_PRECORDIAL`, `ATRIAL_PRECORDIAL`).
- **aVR/aVL/aVF por Goldberger, sin amplificar.** `aVR = −(I+II)/2`, `aVL = (I−III)/2`, `aVF = (II+III)/2`. No se aplica el factor √3/2.
- **Dos magnitudes constantes**, una por familia de onda: `1/cos(50°−60°) = 1.01543` para QRS/ST/T y `1/cos(53.4°−60°) = 1.00667` para P. La magnitud **no se recalcula** al mover el eje: lo que rota es la dirección del vector, no su módulo.
- **`orientation_deg` es un parámetro fisiológico**, no del ECG. Lo consumirán también el vector del panel y el corazón 3D de la fase D. Valor de referencia: **50°** para los doce ritmos (decisión deliberada, no un defecto pendiente).
- **`AxisZone` es un helper derivado del ángulo, nunca un dato almacenado.** Una implementación en Python y un espejo en TypeScript, mantenido con un test de contrato.
- **Nombre `LeadProjectionSet`** (no `ProjectionSet`): es un conjunto de `LeadProjection` y el nombre debe seguir teniendo sentido el día de la onda U.
- **Unidades SI** en el motor (segundos, voltios, hercios); grados solo para ángulos. Dataclasses `frozen=True, slots=True`. Comentarios en español, con acentos correctos.

---

### Task 1: `AxisParams` en el contrato de dominio

**Files:**
- Modify: `packages/ecg-engine/src/ecg_engine/types.py`
- Modify: `packages/ecg-engine/src/ecg_engine/__init__.py`
- Test: `packages/ecg-engine/tests/unit/test_types.py` (crear si no existe)

**Interfaces:**
- Produces: `AxisParams(orientation_deg=50.0, p_offset_deg=3.4, qrs_offset_deg=0.0, st_offset_deg=0.0, t_offset_deg=0.0)`, dataclass `frozen=True, slots=True`. Nuevo campo `EngineParams.axis: AxisParams` con `default_factory=AxisParams`. `AxisParams` exportado desde `ecg_engine`.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/ecg-engine/tests/unit/test_types.py` (o añadir si ya existe):

```python
from ecg_engine import AxisParams, EngineParams


def test_axis_params_defaults_reproduce_the_historical_orientation():
    axis = AxisParams()
    assert axis.orientation_deg == 50.0
    assert axis.p_offset_deg == 3.4
    assert axis.qrs_offset_deg == 0.0
    assert axis.st_offset_deg == 0.0
    assert axis.t_offset_deg == 0.0


def test_engine_params_carry_a_default_axis():
    assert EngineParams().axis == AxisParams()


def test_axis_params_are_frozen():
    import dataclasses
    axis = AxisParams()
    try:
        axis.orientation_deg = 0.0  # type: ignore[misc]
    except dataclasses.FrozenInstanceError:
        return
    raise AssertionError("AxisParams debería ser inmutable")
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_types.py -v`
Expected: FAIL con `ImportError: cannot import name 'AxisParams'`.

- [ ] **Step 3: Añadir `AxisParams` y el campo `axis`**

En `types.py`, justo antes de `class EngineParams`:

```python
@dataclass(frozen=True, slots=True)
class AxisParams:
    """Orientación eléctrica del corazón en el plano frontal.

    `orientation_deg` es la orientación anatómica: al moverla rotan las cuatro
    ondas juntas. Los desfases dan a cada onda su eje propio —un hemibloqueo
    mueve solo el QRS, la isquemia solo el ST— sin desincronizar nada, porque
    el eje efectivo de cada onda es `orientation_deg + su desfase` y no hay
    estado duplicado.

    `orientation_deg` no es un parámetro del ECG sino fisiológico: lo consumen
    el motor de señal, el vector del panel y el corazón 3D de la fase D, que lo
    leerá como su giro en el plano frontal.
    """

    orientation_deg: float = 50.0
    p_offset_deg: float = 3.4
    qrs_offset_deg: float = 0.0
    st_offset_deg: float = 0.0
    t_offset_deg: float = 0.0
```

En la dataclass `EngineParams`, añadir el campo (después de `variability`):

```python
    axis: AxisParams = field(default_factory=AxisParams)
```

En `__init__.py`, añadir `AxisParams` al import desde `.types` y a `__all__`:

```python
from .types import (
    DEFAULT_SAMPLE_RATE_HZ,
    LEAD_ORDER,
    AxisParams,
    EngineParams,
    NoiseParams,
    VariabilityParams,
)
```

Y en `__all__`, insertar `"AxisParams",` en orden alfabético (antes de `"DEFAULT_SAMPLE_RATE_HZ"` no, va tras él; colócalo antes de `"EcgEngine"`).

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_types.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/types.py packages/ecg-engine/src/ecg_engine/__init__.py packages/ecg-engine/tests/unit/test_types.py
git commit -m "feat(engine): AxisParams como contrato de dominio del eje electrico"
```

---

### Task 2: `projection_for_axis` — la tabla como caso particular

**Files:**
- Modify: `packages/ecg-engine/src/ecg_engine/leads.py`
- Test: `packages/ecg-engine/tests/unit/test_leads.py`

**Interfaces:**
- Consumes: `projection_from_mapping`, `LeadProjection`, `NORMAL_AXIS_PROJECTION`, `ATRIAL_PROJECTION` (ya en `leads.py`).
- Produces: constantes `QRS_PRECORDIAL`, `ATRIAL_PRECORDIAL` (`dict[str, float]` de V1–V6), `_QRS_MAGNITUDE`, `_P_MAGNITUDE` (módulo). Función `projection_for_axis(angle_deg: float, magnitude: float, precordial: Mapping[str, float]) -> LeadProjection` que compone las seis derivaciones de miembros por coseno + Goldberger y añade las seis precordiales fijas.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `packages/ecg-engine/tests/unit/test_leads.py`:

```python
import numpy as np

from ecg_engine.leads import (
    ATRIAL_PRECORDIAL,
    QRS_PRECORDIAL,
    _P_MAGNITUDE,
    _QRS_MAGNITUDE,
    projection_for_axis,
)


def test_projection_for_axis_reproduces_the_normal_qrs_table():
    # La tabla histórica está redondeada a tres decimales y aVR/aVL/aVF se
    # escribieron desde esos valores ya redondeados: media unidad del ultimo
    # decimal es la mejor reproduccion posible, no 1e-9.
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
    from ecg_engine.types import LEAD_ORDER
    return projection.coefficients[LEAD_ORDER.index(lead)]


def test_einthoven_is_a_theorem_over_the_whole_range():
    # I + III = II para cualquier angulo: identidad trigonometrica, no tres
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
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -k projection_for_axis -v`
Expected: FAIL con `ImportError: cannot import name 'projection_for_axis'`.

- [ ] **Step 3: Implementar `projection_for_axis` y las constantes**

En `leads.py`, añadir tras los imports `import math` y `from typing import Mapping` (ya está `Mapping`). Añadir después de la definición de `ATRIAL_PROJECTION`:

```python
# --- Proyección paramétrica en el plano frontal ---------------------------
#
# Las tablas de arriba no son doce numeros a mano: sus derivaciones de
# miembros son M·cos(ref − angulo_derivacion), y aVR/aVL/aVF salen de las
# relaciones de Goldberger. Esta seccion generaliza esa construccion a
# cualquier angulo, de modo que projection_for_axis(50°) reproduce la tabla.

_LEAD_II_DEG: float = 60.0
"""Ángulo de la derivación II en el plano frontal. Es el eje sobre el que se
normalizó la tabla histórica: por eso II vale 1,000 exacto en la referencia."""

_QRS_REFERENCE_DEG: float = 50.0
_P_REFERENCE_DEG: float = 53.4

_QRS_MAGNITUDE: float = 1.0 / math.cos(math.radians(_QRS_REFERENCE_DEG - _LEAD_II_DEG))
"""Módulo del vector QRS: 1/cos(50°−60°) = 1.01543. Constante. Lo que rota al
mover el eje es la dirección del vector, no su tamaño; renormalizar en cada
ángulo haría que II valiese siempre 1,000 —físicamente falso— y explotaría a
150°, donde cos(II) es cero."""

_P_MAGNITUDE: float = 1.0 / math.cos(math.radians(_P_REFERENCE_DEG - _LEAD_II_DEG))
"""Módulo del vector P: 1/cos(53.4°−60°) = 1.00667. Distinto del del QRS: con
una sola magnitud compartida, el II de la proyección auricular saldría 1,009
en vez del 1,000 de la tabla."""

_LIMB_ANGLE_DEG: dict[str, float] = {"I": 0.0, "II": 60.0, "III": 120.0}
"""Ángulos de las tres derivaciones bipolares. Las aumentadas no están aquí:
se derivan de estas por Goldberger, no por coseno directo sobre su angulo."""

QRS_PRECORDIAL: dict[str, float] = {
    "V1": -0.45, "V2": -0.15, "V3": 0.55, "V4": 1.15, "V5": 1.30, "V6": 0.95,
}
"""Precordiales del QRS. El eje frontal no las gobierna: V1–V6 estan en el
plano horizontal y dependen de la rotacion horaria, un giro distinto. ST y T
comparten estas mismas precordiales, como hoy al compartir traza con el QRS."""

ATRIAL_PRECORDIAL: dict[str, float] = {
    "V1": 0.40, "V2": 0.50, "V3": 0.45, "V4": 0.40, "V5": 0.35, "V6": 0.30,
}
"""Precordiales de la P."""


def projection_for_axis(
    angle_deg: float, magnitude: float, precordial: Mapping[str, float]
) -> LeadProjection:
    """Proyección de doce derivaciones para un eje frontal dado.

    Las seis derivaciones de miembros salen de `angle_deg` y `magnitude`; las
    seis precordiales son las de `precordial`, que el eje frontal no toca.
    """
    a = math.radians(angle_deg)
    i = magnitude * math.cos(a - math.radians(_LIMB_ANGLE_DEG["I"]))
    ii = magnitude * math.cos(a - math.radians(_LIMB_ANGLE_DEG["II"]))
    iii = magnitude * math.cos(a - math.radians(_LIMB_ANGLE_DEG["III"]))
    mapping = dict(precordial)
    mapping.update(
        {
            "I": i,
            "II": ii,
            "III": iii,
            "aVR": -(i + ii) / 2.0,
            "aVL": (i - iii) / 2.0,
            "aVF": (ii + iii) / 2.0,
        }
    )
    return projection_from_mapping(mapping)
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -v`
Expected: PASS (los nuevos y los existentes; la suite de `test_leads.py` no se ha tocado en su parte antigua).

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/leads.py packages/ecg-engine/tests/unit/test_leads.py
git commit -m "feat(engine): projection_for_axis reproduce la tabla como caso particular"
```

---

### Task 3: `AxisZone` y `zone_for`

**Files:**
- Modify: `packages/ecg-engine/src/ecg_engine/leads.py`
- Test: `packages/ecg-engine/tests/unit/test_leads.py`

**Interfaces:**
- Produces: `AxisZone(str, Enum)` con miembros `NORMAL="normal"`, `LEFT="left"`, `RIGHT="right"`, `EXTREME="extreme"`. `zone_for(deg: float) -> AxisZone`, que **normaliza primero** a (−180, +180].

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test_leads.py`:

```python
from ecg_engine.leads import AxisZone, zone_for


def test_zone_boundaries_are_testable_one_by_one():
    assert zone_for(-30.0) is AxisZone.NORMAL
    assert zone_for(-31.0) is AxisZone.LEFT
    assert zone_for(90.0) is AxisZone.NORMAL
    assert zone_for(91.0) is AxisZone.RIGHT
    assert zone_for(-90.0) is AxisZone.LEFT
    assert zone_for(-91.0) is AxisZone.EXTREME
    assert zone_for(180.0) is AxisZone.RIGHT


def test_zone_for_normalizes_before_classifying():
    # +270° es el mismo eje que −90°: un QRS con orientation +180 y offset +90.
    assert zone_for(270.0) is zone_for(-90.0)


def test_zones_cover_the_whole_circle_without_gaps():
    for deg in range(-180, 181):
        assert isinstance(zone_for(float(deg)), AxisZone)
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -k zone -v`
Expected: FAIL con `ImportError: cannot import name 'AxisZone'`.

- [ ] **Step 3: Implementar `AxisZone` y `zone_for`**

En `leads.py`, añadir `from enum import Enum` a los imports y, al final del módulo:

```python
class AxisZone(str, Enum):
    """Interpretación clínica de un eje frontal. Helper derivado del ángulo,
    nunca un dato almacenado: guardarlo crearía dos fuentes de verdad."""

    NORMAL = "normal"
    LEFT = "left"
    RIGHT = "right"
    EXTREME = "extreme"


def _normalize_deg(deg: float) -> float:
    """Lleva un ángulo cualquiera a (−180, +180]."""
    d = (deg + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def zone_for(deg: float) -> AxisZone:
    """Zona clínica del eje. Normaliza primero: con orientation en +180 y
    offset en +90 el eje efectivo sale a +270, un ángulo válido que sin
    normalizar caería fuera de los cuatro intervalos."""
    a = _normalize_deg(deg)
    if -30.0 <= a <= 90.0:
        return AxisZone.NORMAL
    if -90.0 <= a < -30.0:
        return AxisZone.LEFT
    if 90.0 < a <= 180.0:
        return AxisZone.RIGHT
    return AxisZone.EXTREME  # −180 < a < −90
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -k zone -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/leads.py packages/ecg-engine/tests/unit/test_leads.py
git commit -m "feat(engine): AxisZone y zone_for con normalizacion angular"
```

---

### Task 4: `LeadProjectionSet` y `projection_set_for_axis`

**Files:**
- Modify: `packages/ecg-engine/src/ecg_engine/leads.py`
- Test: `packages/ecg-engine/tests/unit/test_leads.py`

**Interfaces:**
- Consumes: `AxisParams` (Task 1), `projection_for_axis`, magnitudes y precordiales (Task 2).
- Produces: `LeadProjectionSet(p, qrs, st, t)` dataclass `frozen=True, slots=True` de cuatro `LeadProjection`. `projection_set_for_axis(axis: AxisParams) -> LeadProjectionSet`. Constante `DEFAULT_PROJECTION_SET = projection_set_for_axis(AxisParams())`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test_leads.py`:

```python
from ecg_engine.leads import (
    DEFAULT_PROJECTION_SET,
    LeadProjectionSet,
    projection_set_for_axis,
)
from ecg_engine.types import AxisParams


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
    s = projection_set_for_axis(AxisParams(qrs_offset_deg=30.0))
    assert s.qrs.coefficients != s.t.coefficients  # solo el QRS rotó
    assert s.t.coefficients == DEFAULT_PROJECTION_SET.t.coefficients
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -k projection_set -v`
Expected: FAIL con `ImportError: cannot import name 'LeadProjectionSet'`.

- [ ] **Step 3: Implementar el conjunto y su constructor**

En `leads.py`, añadir `from .types import AxisParams` al bloque de imports (junto a `LEAD_ORDER, N_LEADS`). Al final del módulo:

```python
@dataclass(frozen=True, slots=True)
class LeadProjectionSet:
    """Proyección por onda. La T puede tener eje propio porque cada onda lleva
    su propia `LeadProjection`. Se llama así, y no `ProjectionSet`, porque el
    nombre tiene que seguir teniendo sentido el día de la onda U."""

    p: LeadProjection
    qrs: LeadProjection
    st: LeadProjection
    t: LeadProjection


def projection_set_for_axis(axis: AxisParams) -> LeadProjectionSet:
    """Construye las cuatro proyecciones desde el eje. El eje efectivo de cada
    onda es `orientation_deg + su desfase`."""
    return LeadProjectionSet(
        p=projection_for_axis(
            axis.orientation_deg + axis.p_offset_deg, _P_MAGNITUDE, ATRIAL_PRECORDIAL
        ),
        qrs=projection_for_axis(
            axis.orientation_deg + axis.qrs_offset_deg, _QRS_MAGNITUDE, QRS_PRECORDIAL
        ),
        st=projection_for_axis(
            axis.orientation_deg + axis.st_offset_deg, _QRS_MAGNITUDE, QRS_PRECORDIAL
        ),
        t=projection_for_axis(
            axis.orientation_deg + axis.t_offset_deg, _QRS_MAGNITUDE, QRS_PRECORDIAL
        ),
    )


DEFAULT_PROJECTION_SET: LeadProjectionSet = projection_set_for_axis(AxisParams())
"""Conjunto por defecto: reproduce las tablas históricas. Es lo que usa una
fuente hasta que el motor le fija un eje."""
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_leads.py -v`
Expected: PASS (toda la suite de leads).

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/leads.py packages/ecg-engine/tests/unit/test_leads.py
git commit -m "feat(engine): LeadProjectionSet y projection_set_for_axis"
```

---

### Task 5: `render_events` proyecta por onda

**Files:**
- Modify: `packages/ecg-engine/src/ecg_engine/renderer.py`
- Modify: `packages/ecg-engine/src/ecg_engine/sources.py`
- Test: `packages/ecg-engine/tests/unit/test_renderer.py`

**Interfaces:**
- Consumes: `LeadProjectionSet`, `DEFAULT_PROJECTION_SET` (Task 4); `WaveTarget`, `GaussianComponent`, `EventKind` de `types`.
- Produces: `render_events(events, t_s, projections: LeadProjectionSet, overlays=(), variability=None)`. Se elimina `DEFAULT_PROJECTIONS` (dict). `sources.py` pasa `DEFAULT_PROJECTION_SET`. El comportamiento es idéntico con desfases a cero.

- [ ] **Step 1: Escribir el test que falla**

Editar los imports de `packages/ecg-engine/tests/unit/test_renderer.py`: sustituir `DEFAULT_PROJECTIONS` por `DEFAULT_PROJECTION_SET` en el import desde `ecg_engine.renderer`, y reemplazar **todas** las apariciones de `DEFAULT_PROJECTIONS` por `DEFAULT_PROJECTION_SET` en el fichero (16 usos). Añadir además este test nuevo al final:

```python
from ecg_engine.leads import DEFAULT_PROJECTION_SET, LeadProjectionSet, projection_from_mapping


def test_ventricular_waves_use_their_own_projection(grid):
    # Anulando la proyeccion de ST y T pero no la del QRS, la onda T (que cae
    # ~0,25 s tras la R) desaparece: prueba de que el corte por onda funciona.
    zero = projection_from_mapping({lead: 0.0 for lead in LEAD_ORDER})
    qrs_only = LeadProjectionSet(
        p=DEFAULT_PROJECTION_SET.p,
        qrs=DEFAULT_PROJECTION_SET.qrs,
        st=zero,
        t=zero,
    )
    signal = render_events([qrs_at(1.0)], grid, qrs_only)
    lead_ii = signal[LEAD_ORDER.index("II")]
    t_region = lead_ii[grid > 1.15]
    assert np.abs(t_region).max() < 1e-4
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_renderer.py -v`
Expected: FAIL con `ImportError: cannot import name 'DEFAULT_PROJECTION_SET'` (y el test nuevo aún no puede pasar).

- [ ] **Step 3: Reescribir `render_events`**

En `renderer.py`:

Cambiar los imports:

```python
from typing import Sequence

import numpy as np

from .beat import get_template
from .leads import DEFAULT_PROJECTION_SET, LeadProjectionSet
from .overlays import MorphologyOverlay
from .types import (
    N_LEADS,
    CardiacEvent,
    EventKind,
    GaussianComponent,
    VariabilityParams,
    WaveTarget,
)
from .variability import amplitude_scale
from .waveform import render_component
```

Eliminar el bloque `DEFAULT_PROJECTIONS: dict[EventKind, LeadProjection] = {...}` entero.

Sustituir `_trace_for_event` por `_trace_for_components`:

```python
def _trace_for_components(
    t_s: np.ndarray,
    components: Sequence[GaussianComponent],
    offset_s: float,
) -> np.ndarray:
    trace = np.zeros_like(t_s)
    for component in components:
        trace += render_component(t_s, component, offset_s=offset_s)
    return trace
```

Reescribir `render_events`:

```python
def render_events(
    events: Sequence[CardiacEvent],
    t_s: np.ndarray,
    projections: LeadProjectionSet,
    overlays: Sequence[MorphologyOverlay] = (),
    variability: VariabilityParams | None = None,
) -> np.ndarray:
    """Convierte una lista de eventos en una señal de doce derivaciones."""
    signal = np.zeros((N_LEADS, t_s.size), dtype=np.float64)

    for event in events:
        template = get_template(event.template_id)
        if event.kind is EventKind.ATRIAL:
            # Las plantillas auriculares contienen solo componentes P, así que
            # el evento se proyecta entero con el eje de la P.
            trace = _trace_for_components(t_s, template.components, event.t_s)
            signal += projections.p.as_column() * trace[np.newaxis, :]
            continue
        # El evento ventricular se parte por onda: QRS, ST y T pueden tener
        # cada uno su propio eje. Con desfases a cero, los tres se proyectan
        # con coeficientes idénticos y la suma es la misma señal de siempre.
        for target, projection in (
            (WaveTarget.QRS, projections.qrs),
            (WaveTarget.ST, projections.st),
            (WaveTarget.T, projections.t),
        ):
            components = template.components_for(target)
            if not components:
                continue
            trace = _trace_for_components(t_s, components, event.t_s)
            signal += projection.as_column() * trace[np.newaxis, :]

    # Los overlays modifican morfología ventricular. No tocan la aurícula, y
    # por construcción no pueden crear ni mover eventos.
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    for overlay in overlays:
        overlay_trace = np.zeros_like(t_s)
        for event in ventricular:
            for component in overlay.components():
                overlay_trace += render_component(t_s, component, offset_s=event.t_s)
        signal += overlay.lead_mask() * overlay_trace[np.newaxis, :]

    if variability is not None:
        signal *= amplitude_scale(t_s, variability)[np.newaxis, :]

    return signal
```

En `sources.py`, cambiar el import de `renderer` para no traer `DEFAULT_PROJECTIONS` y traer el conjunto por defecto desde `leads`:

```python
from .leads import DEFAULT_PROJECTION_SET
from .renderer import (
    RENDER_MARGIN_S,
    render_events,
    time_grid,
)
```

Y en `BeatBasedSource.render`, cambiar la llamada:

```python
        return render_events(
            events,
            t_s,
            DEFAULT_PROJECTION_SET,
            overlays=self._overlays,
            variability=self._variability,
        )
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_renderer.py tests/unit/test_leads.py -v`
Expected: PASS. Después, verificar que **los golden signals pasan sin regenerar**:

Run: `cd packages/ecg-engine && uv run pytest -v`
Expected: PASS en toda la suite (incluidos golden signals).

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/renderer.py packages/ecg-engine/src/ecg_engine/sources.py packages/ecg-engine/tests/unit/test_renderer.py
git commit -m "refactor(engine): render_events proyecta cada onda con su propio eje"
```

---

### Task 6: El eje recorre motor, fuente y catálogo

**Files:**
- Modify: `packages/ecg-engine/src/ecg_engine/sources.py`
- Modify: `packages/ecg-engine/src/ecg_engine/engine.py`
- Modify: `packages/ecg-engine/src/ecg_engine/catalog/definitions.py`
- Modify: `packages/ecg-engine/src/ecg_engine/catalog/__init__.py`
- Test: `packages/ecg-engine/tests/unit/test_engine.py`, `packages/ecg-engine/tests/unit/test_catalog.py` (crear los tests si el fichero no existe)

**Interfaces:**
- Consumes: `AxisParams` (Task 1), `projection_set_for_axis` (Task 4), `ParameterRange` (catálogo).
- Produces: `BeatBasedSource.set_axis(axis: AxisParams)` y `VentricularFibrillationSource.set_axis(axis)` (no-op). `EcgEngine._clamped` recorta los cinco campos del eje. `AXIS_PARAMETER_RANGES: Mapping[str, ParameterRange]` en `definitions.py`, fusionado en `editable_parameters` de cada ritmo por `catalog/__init__.py`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `packages/ecg-engine/tests/unit/test_engine.py` (o crearlo):

```python
import numpy as np

from ecg_engine import AxisParams, EcgEngine, EngineParams
from ecg_engine.types import LEAD_ORDER


def _first_beat_signal(axis):
    engine = EcgEngine(
        rhythm_id="sinus_normal",
        seed=20260803,
        params=EngineParams(heart_rate_hz=70 / 60, axis=axis),
    )
    return engine.generate(1000)  # 2 s a 500 Hz


def test_rotating_the_axis_changes_limb_leads_not_precordials():
    baseline = _first_beat_signal(AxisParams())
    rotated = _first_beat_signal(AxisParams(orientation_deg=90.0))
    lead_i = LEAD_ORDER.index("I")
    v3 = LEAD_ORDER.index("V3")
    # I cae a casi cero con el eje a +90° (perpendicular a I).
    assert np.abs(rotated[lead_i]).max() < np.abs(baseline[lead_i]).max()
    # Las precordiales no se inmutan: el eje frontal no las gobierna.
    np.testing.assert_allclose(rotated[v3], baseline[v3], atol=1e-9)


def test_clamped_axis_respects_the_catalog_ranges():
    engine = EcgEngine(
        rhythm_id="sinus_normal",
        seed=1,
        params=EngineParams(axis=AxisParams(qrs_offset_deg=200.0)),
    )
    # qrs_offset_deg tiene rango ±90: 200 se recorta a 90.
    assert engine.params.axis.qrs_offset_deg == 90.0
```

Añadir a `packages/ecg-engine/tests/unit/test_catalog.py` (o crearlo):

```python
from ecg_engine.catalog import get_rhythm, list_rhythms


def test_every_rhythm_exposes_the_axis_ranges():
    for definition in list_rhythms():
        editable = definition.editable_parameters
        for name in (
            "orientation_deg",
            "p_offset_deg",
            "qrs_offset_deg",
            "st_offset_deg",
            "t_offset_deg",
        ):
            assert name in editable, f"{definition.rhythm_id} sin {name}"


def test_axis_ranges_match_the_design_limits():
    editable = get_rhythm("sinus_normal").editable_parameters
    assert (editable["orientation_deg"].minimum, editable["orientation_deg"].maximum) == (-180.0, 180.0)
    assert (editable["qrs_offset_deg"].minimum, editable["qrs_offset_deg"].maximum) == (-90.0, 90.0)
    assert (editable["p_offset_deg"].minimum, editable["p_offset_deg"].maximum) == (-45.0, 45.0)
    assert editable["orientation_deg"].default == 50.0
```

- [ ] **Step 2: Ejecutar los tests para verlos fallar**

Run: `cd packages/ecg-engine && uv run pytest tests/unit/test_engine.py tests/unit/test_catalog.py -v`
Expected: FAIL — `set_axis` no existe / `orientation_deg` no está en `editable_parameters`.

- [ ] **Step 3: Implementar la propagación y los rangos**

En `sources.py`, ampliar imports:

```python
from .leads import DEFAULT_PROJECTION_SET, LeadProjectionSet, projection_set_for_axis
from .types import N_LEADS, AxisParams, CardiacEvent, EventKind, VariabilityParams
```

En `BeatBasedSource.__init__`, al final del cuerpo, inicializar el conjunto:

```python
        self._projection_set: LeadProjectionSet = DEFAULT_PROJECTION_SET
```

Añadir el método (junto a `set_rate_hz`):

```python
    def set_axis(self, axis: AxisParams) -> None:
        """Recalcula el conjunto de proyecciones al cambiar el eje eléctrico.
        Espejo de `set_rate_hz`: el motor lo llama cuando el usuario mueve el
        eje, y el conjunto se guarda para no recomputarlo en cada trozo."""
        self._projection_set = projection_set_for_axis(axis)
```

En `BeatBasedSource.render`, usar el conjunto guardado:

```python
        return render_events(
            events,
            t_s,
            self._projection_set,
            overlays=self._overlays,
            variability=self._variability,
        )
```

En `VentricularFibrillationSource`, junto a `set_rate_hz`, añadir:

```python
    def set_axis(self, axis: AxisParams) -> None:
        """La FV es señal caótica sin dipolo proyectable. El eje no aplica."""
        return None
```

En `engine.py`, importar `AxisParams`:

```python
from .types import DEFAULT_SAMPLE_RATE_HZ, AxisParams, EngineParams, SignalSource
```

En `_build_source`, tras `source.set_rate_hz(...)`:

```python
        source.set_axis(self._params.axis)
```

En `update_params`, tras `self._source.set_rate_hz(...)`:

```python
        self._source.set_axis(self._params.axis)
```

Reescribir `_clamped`:

```python
    def _clamped(self, params: EngineParams) -> EngineParams:
        """Recorta frecuencia y eje a los rangos clínicos que declara el ritmo."""
        editable = self._definition.editable_parameters
        clamped_hz = editable["heart_rate_hz"].clamp(params.heart_rate_hz)
        axis = params.axis
        clamped_axis = AxisParams(
            orientation_deg=editable["orientation_deg"].clamp(axis.orientation_deg),
            p_offset_deg=editable["p_offset_deg"].clamp(axis.p_offset_deg),
            qrs_offset_deg=editable["qrs_offset_deg"].clamp(axis.qrs_offset_deg),
            st_offset_deg=editable["st_offset_deg"].clamp(axis.st_offset_deg),
            t_offset_deg=editable["t_offset_deg"].clamp(axis.t_offset_deg),
        )
        if clamped_hz == params.heart_rate_hz and clamped_axis == axis:
            return params
        return EngineParams(
            heart_rate_hz=clamped_hz,
            noise=params.noise,
            variability=params.variability,
            axis=clamped_axis,
        )
```

En `catalog/definitions.py`, añadir tras la definición de `_fixed` (antes de `DEFINITIONS`):

```python
AXIS_PARAMETER_RANGES: Mapping[str, ParameterRange] = {
    "orientation_deg": ParameterRange(-180.0, 180.0, 50.0),
    "p_offset_deg": ParameterRange(-45.0, 45.0, 3.4),
    "qrs_offset_deg": ParameterRange(-90.0, 90.0, 0.0),
    "st_offset_deg": ParameterRange(-180.0, 180.0, 0.0),
    "t_offset_deg": ParameterRange(-180.0, 180.0, 0.0),
}
"""Rangos del eje, compartidos por los doce ritmos. Una sola definición: doce
copias serían doce sitios donde desincronizar. Se fusionan en cada ritmo desde
`catalog/__init__.py`. No son un límite del motor —sabe calcular cualquier
ángulo— sino la declaración de qué considera el sistema fisiológicamente
razonable, y viajan al cliente por la API."""
```

En `catalog/__init__.py`, fusionar los rangos en un único punto:

```python
from __future__ import annotations

from dataclasses import replace

from .definitions import (
    AXIS_PARAMETER_RANGES,
    DEFINITIONS,
    ParameterRange,
    RhythmCategory,
    RhythmDefinition,
)


def _with_axis(definition: RhythmDefinition) -> RhythmDefinition:
    """Añade los rangos del eje a `editable_parameters` sin tocar las doce
    definiciones a mano. Punto único de fusión: el catálogo entero pasa por
    aquí, así que ningún ritmo puede quedarse sin los ejes."""
    return replace(
        definition,
        editable_parameters={**definition.editable_parameters, **AXIS_PARAMETER_RANGES},
    )


_ALL: tuple[RhythmDefinition, ...] = tuple(_with_axis(d) for d in DEFINITIONS)

_BY_ID: dict[str, RhythmDefinition] = {d.rhythm_id: d for d in _ALL}

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
    return _ALL


def get_rhythm(rhythm_id: str) -> RhythmDefinition:
    try:
        return _BY_ID[rhythm_id]
    except KeyError as exc:
        known = ", ".join(sorted(_BY_ID))
        raise KeyError(
            f"ritmo desconocido: {rhythm_id!r}. Conocidos: {known}"
        ) from exc
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd packages/ecg-engine && uv run pytest -v`
Expected: PASS en toda la suite. Los golden signals siguen pasando: el eje por defecto es `AxisParams()`, que reproduce las tablas.

- [ ] **Step 5: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/sources.py packages/ecg-engine/src/ecg_engine/engine.py packages/ecg-engine/src/ecg_engine/catalog/definitions.py packages/ecg-engine/src/ecg_engine/catalog/__init__.py packages/ecg-engine/tests/unit/test_engine.py packages/ecg-engine/tests/unit/test_catalog.py
git commit -m "feat(engine): el eje electrico recorre motor, fuente y catalogo"
```

---

### Task 7: Espejo del payload en la API

**Files:**
- Modify: `apps/api/src/ecg_api/schemas.py`
- Test: `apps/api/tests/unit/test_ws_schemas.py`

**Interfaces:**
- Consumes: `AxisParams` de `ecg_engine`.
- Produces: `AxisParamsPayload` (Pydantic) con los cinco campos y sus defaults. `EngineParamsPayload.axis: AxisParamsPayload` con `default_factory`. `to_engine_params` construye `AxisParams`; `engine_params_to_dict` vuelca `axis`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/api/tests/unit/test_ws_schemas.py`:

```python
from ecg_api.schemas import EngineParamsPayload, engine_params_to_dict


def test_axis_round_trips_through_engine_params():
    payload = EngineParamsPayload.model_validate(
        {
            "heart_rate_hz": 70 / 60,
            "axis": {"orientation_deg": -30.0, "qrs_offset_deg": 15.0},
        }
    )
    engine = payload.to_engine_params()
    assert engine.axis.orientation_deg == -30.0
    assert engine.axis.qrs_offset_deg == 15.0
    # p_offset_deg no venía en el payload: cae al default de diseño.
    assert engine.axis.p_offset_deg == 3.4

    dumped = engine_params_to_dict(engine)
    assert dumped["axis"]["orientation_deg"] == -30.0
    assert dumped["axis"]["qrs_offset_deg"] == 15.0


def test_axis_is_optional_and_defaults_to_the_reference_orientation():
    payload = EngineParamsPayload.model_validate({"heart_rate_hz": 1.0})
    assert payload.to_engine_params().axis.orientation_deg == 50.0
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd apps/api && uv run pytest tests/unit/test_ws_schemas.py -k axis -v`
Expected: FAIL con `AttributeError` / `KeyError: 'axis'`.

- [ ] **Step 3: Añadir el espejo del eje**

En `schemas.py`, ampliar el import de `ecg_engine`:

```python
from ecg_engine import AxisParams, EngineParams, NoiseParams, VariabilityParams
```

Añadir la clase `AxisParamsPayload` (tras `VariabilityParamsPayload`):

```python
class AxisParamsPayload(BaseModel):
    orientation_deg: float = 50.0
    p_offset_deg: float = 3.4
    qrs_offset_deg: float = 0.0
    st_offset_deg: float = 0.0
    t_offset_deg: float = 0.0
```

En `EngineParamsPayload`, añadir el campo y ampliar `to_engine_params`:

```python
class EngineParamsPayload(BaseModel):
    heart_rate_hz: float
    noise: NoiseParamsPayload = Field(default_factory=NoiseParamsPayload)
    variability: VariabilityParamsPayload = Field(
        default_factory=VariabilityParamsPayload
    )
    axis: AxisParamsPayload = Field(default_factory=AxisParamsPayload)

    def to_engine_params(self) -> EngineParams:
        return EngineParams(
            heart_rate_hz=self.heart_rate_hz,
            noise=NoiseParams(**self.noise.model_dump()),
            variability=VariabilityParams(**self.variability.model_dump()),
            axis=AxisParams(**self.axis.model_dump()),
        )
```

En `engine_params_to_dict`, añadir la clave `axis`:

```python
    return {
        "heart_rate_hz": params.heart_rate_hz,
        "noise": asdict(params.noise),
        "variability": asdict(params.variability),
        "axis": asdict(params.axis),
    }
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd apps/api && uv run pytest tests/unit/test_ws_schemas.py -v`
Expected: PASS. Los rangos del eje ya viajan en el detalle REST del catálogo sin tocar `routers/rhythms.py`, porque serializa `editable_parameters` de forma genérica.

Run: `cd apps/api && uv run pytest -v`
Expected: PASS (el detalle del catálogo ahora incluye los cinco rangos nuevos; ningún test previo los prohibía).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/schemas.py apps/api/tests/unit/test_ws_schemas.py
git commit -m "feat(api): espejo del eje electrico en el payload del motor"
```

---

### Task 8: Espejo del payload en el frontend

**Files:**
- Modify: `apps/web/src/types/engine-params.ts`
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`
- Modify: `apps/web/src/simulation-runtime/session-runtime.test.ts`
- Test: (cubierto por la compilación de tipos y los tests existentes de workspace/runtime)

**Interfaces:**
- Produces: `AxisParamsPayload` (TS) y `EngineParamsPayload.axis: AxisParamsPayload` (requerido). Constante `DEFAULT_AXIS` en `ECGWorkspace.tsx`, usada en `start()` y en el `currentParams` de reserva.

- [ ] **Step 1: Escribir el cambio de tipo (el fallo es de compilación)**

En `apps/web/src/types/engine-params.ts`, añadir la interfaz y el campo:

```ts
export interface AxisParamsPayload {
  orientation_deg: number;
  p_offset_deg: number;
  qrs_offset_deg: number;
  st_offset_deg: number;
  t_offset_deg: number;
}

export interface EngineParamsPayload {
  heart_rate_hz: number;
  noise: NoiseParamsPayload;
  variability: VariabilityParamsPayload;
  axis: AxisParamsPayload;
}
```

- [ ] **Step 2: Ejecutar el chequeo de tipos para ver el fallo**

Run: `cd apps/web && npx tsc --noEmit`
Expected: FAIL — faltan `axis` en las construcciones de `EngineParamsPayload` (ECGWorkspace.tsx líneas ~176 y ~186; session-runtime.test.ts línea 86).

- [ ] **Step 3: Rellenar `axis` en los tres sitios de construcción**

En `ECGWorkspace.tsx`, junto a `SILENT_NOISE` / `DEFAULT_VARIABILITY` (líneas ~45–51), añadir:

```ts
const DEFAULT_AXIS = {
  orientation_deg: 50,
  p_offset_deg: 3.4,
  qrs_offset_deg: 0,
  st_offset_deg: 0,
  t_offset_deg: 0,
};
```

En la llamada `runtime.start(...)` (línea ~175), añadir `axis: DEFAULT_AXIS`:

```ts
    runtime.start(rhythmId, {
      heart_rate_hz: detail.default_parameters.heart_rate_hz,
      noise: SILENT_NOISE,
      variability: DEFAULT_VARIABILITY,
      axis: DEFAULT_AXIS,
    });
```

En el `currentParams` de reserva (línea ~182), añadir `axis: DEFAULT_AXIS`:

```ts
  const currentParams =
    store.params ??
    (selectedRhythm
      ? {
          heart_rate_hz: selectedRhythm.default_parameters.heart_rate_hz,
          noise: SILENT_NOISE,
          variability: DEFAULT_VARIABILITY,
          axis: DEFAULT_AXIS,
        }
      : null);
```

En `session-runtime.test.ts` línea 86, añadir el campo `axis` al literal de `start`:

```ts
    runtime.start("sinus_normal", { heart_rate_hz: 70 / 60, noise: { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null }, variability: { respiration_hz: 0.25, rsa_fraction: 0.04, amplitude_fraction: 0.03, rr_jitter_fraction: 0.015 }, axis: { orientation_deg: 50, p_offset_deg: 3.4, qrs_offset_deg: 0, st_offset_deg: 0, t_offset_deg: 0 } }, 123);
```

- [ ] **Step 4: Ejecutar chequeo de tipos y tests**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: PASS (tipos limpios; los tests de workspace y runtime siguen verdes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/engine-params.ts apps/web/src/ui/ECGWorkspace.tsx apps/web/src/simulation-runtime/session-runtime.test.ts
git commit -m "feat(web): espejo del eje electrico en el payload del cliente"
```

---

### Task 9: Espejo TypeScript de las zonas

**Files:**
- Create: `apps/web/src/ui/AxisControl/axis-zones.ts`
- Test: `apps/web/src/ui/AxisControl/axis-zones.test.ts`

**Interfaces:**
- Produces: `type AxisZone = "normal" | "left" | "right" | "extreme"`. `normalizeDeg(deg: number): number` → (−180, 180]. `zoneFor(deg: number): AxisZone`. `ZONE_LABEL: Record<AxisZone, string>` con las etiquetas clínicas en español. Contrato: mismos límites que `zone_for` en Python.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/ui/AxisControl/axis-zones.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeDeg, zoneFor } from "./axis-zones";

describe("zoneFor — espejo de zone_for del motor", () => {
  it("clasifica cada frontera por ambos lados", () => {
    expect(zoneFor(-30)).toBe("normal");
    expect(zoneFor(-31)).toBe("left");
    expect(zoneFor(90)).toBe("normal");
    expect(zoneFor(91)).toBe("right");
    expect(zoneFor(-90)).toBe("left");
    expect(zoneFor(-91)).toBe("extreme");
    expect(zoneFor(180)).toBe("right");
  });

  it("normaliza antes de clasificar: +270 = −90", () => {
    expect(zoneFor(270)).toBe(zoneFor(-90));
    expect(normalizeDeg(270)).toBe(-90);
    expect(normalizeDeg(-180)).toBe(180);
  });

  it("cubre el círculo entero sin huecos", () => {
    for (let deg = -180; deg <= 180; deg++) {
      expect(["normal", "left", "right", "extreme"]).toContain(zoneFor(deg));
    }
  });
});
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd apps/web && npx vitest run src/ui/AxisControl/axis-zones.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el espejo**

Crear `apps/web/src/ui/AxisControl/axis-zones.ts`:

```ts
// Espejo de `zone_for`/`AxisZone` del motor (packages/ecg-engine/leads.py).
// Se mantiene a mano con el test de contrato de al lado, igual que la cabecera
// binaria de 40 bytes es espejo de frames.py. Existe para que el disco pueda
// colorear la zona mientras el usuario arrastra, sin ida y vuelta al servidor.

export type AxisZone = "normal" | "left" | "right" | "extreme";

/** Lleva un ángulo cualquiera a (−180, +180]. */
export function normalizeDeg(deg: number): number {
  const d = (((deg + 180) % 360) + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

export function zoneFor(deg: number): AxisZone {
  const a = normalizeDeg(deg);
  if (a >= -30 && a <= 90) return "normal";
  if (a >= -90 && a < -30) return "left";
  if (a > 90 && a <= 180) return "right";
  return "extreme";
}

export const ZONE_LABEL: Record<AxisZone, string> = {
  normal: "eje normal",
  left: "desviación izquierda",
  right: "desviación derecha",
  extreme: "eje extremo",
};

/** Nota docente bajo el disco. No modifica la señal ni condiciona nada. */
export const ZONE_NOTE: Record<AxisZone, string> = {
  normal: "Eje entre −30° y +90°: orientación normal del adulto.",
  left: "Compatible con hemibloqueo anterior izquierdo, hipertrofia ventricular izquierda o cardiopatía isquémica.",
  right: "Compatible con hemibloqueo posterior izquierdo, hipertrofia ventricular derecha o corazón vertical.",
  extreme: "Eje en tierra de nadie: sospechar ritmo de origen ventricular o error de colocación de electrodos.",
};
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `cd apps/web && npx vitest run src/ui/AxisControl/axis-zones.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/AxisControl/axis-zones.ts apps/web/src/ui/AxisControl/axis-zones.test.ts
git commit -m "feat(web): espejo TS de las zonas del eje con test de contrato"
```

---

### Task 10: Roles de color del eje en el tema

**Files:**
- Modify: `packages/ui-system/tokens/tokens.ts`
- Modify: `packages/ui-system/themes/types.ts`
- Modify: `packages/ui-system/themes/dark.ts`
- Modify: `packages/ui-system/themes/light.ts`
- Modify: `packages/ui-system/tokens/tokens.css` (regenerado)
- Test: `packages/ui-system/themes/themes.test.ts`

**Interfaces:**
- Produces: `Theme.axis: { normal: string; left: string; right: string; extreme: string }`. Cuatro entradas nuevas en `palette`. Custom properties `--axis-normal`, `--axis-left`, `--axis-right`, `--axis-extreme` en `tokens.css`, generadas automáticamente por `themeRoleGroups`.

- [ ] **Step 1: Escribir el test que falla**

En `packages/ui-system/themes/themes.test.ts`, dentro de la función que recorre los grupos (la que hoy hace `walk(theme.ecg)`, `walk(theme.panel)`, `walk(theme.inspector)`), añadir:

```ts
  walk(theme.axis);
```

Y añadir un test explícito de que los cuatro roles existen y son colores:

```ts
import { getTheme } from "./index";

it("cada tema declara los cuatro roles de zona del eje", () => {
  for (const name of ["dark", "light"] as const) {
    const axis = getTheme(name).axis;
    for (const role of ["normal", "left", "right", "extreme"] as const) {
      expect(axis[role]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  }
});
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Toda la suite de frontend (web y ui-system) corre desde `apps/web`: su `vite.config.ts` incluye `../../packages/ui-system/**/*.{test,spec}`. `packages/ui-system` no tiene `package.json` propio.

Run: `cd apps/web && npx vitest run themes.test`
Expected: FAIL — `theme.axis` es `undefined`.

- [ ] **Step 3: Añadir los roles y regenerar el CSS**

En `packages/ui-system/tokens/tokens.ts`, dentro de `palette`, añadir cuatro colores (discretos, apagados: es el borde de un instrumento, no una alarma):

```ts
  // Zonas del eje eléctrico: verde tenue en normal, azul en desviación
  // izquierda, ámbar en derecha, rojo oscuro en eje extremo.
  axisNormal: "#2E7D5B",
  axisLeft: "#3B6EA5",
  axisRight: "#B7791F",
  axisExtreme: "#7A2E2E",
```

En `packages/ui-system/themes/types.ts`, añadir el grupo a la interfaz `Theme`:

```ts
  axis: { normal: string; left: string; right: string; extreme: string };
```

En `packages/ui-system/themes/dark.ts`, dentro de `darkTheme` (tras `inspector`):

```ts
  axis: {
    normal: palette.axisNormal,
    left: palette.axisLeft,
    right: palette.axisRight,
    extreme: palette.axisExtreme,
  },
```

En `packages/ui-system/themes/light.ts`, dentro de `lightTheme`, el mismo bloque `axis` (los cuatro colores funcionan sobre fondo claro y oscuro; si el revisor visual los quiere distintos en claro, es un ajuste posterior):

```ts
  axis: {
    normal: palette.axisNormal,
    left: palette.axisLeft,
    right: palette.axisRight,
    extreme: palette.axisExtreme,
  },
```

Regenerar `tokens.css` con el generador (no editar el CSS a mano — lo dice su banner). El script `tokens` vive en `apps/web/package.json` (`vite-node ../../packages/ui-system/tokens/build.ts`):

Run: `cd apps/web && npm run tokens`
Expected: `tokens.css generado` en stdout, y el fichero contiene `--axis-normal`, `--axis-left`, `--axis-right`, `--axis-extreme` bajo `:root` y bajo `:root[data-theme="light"]`.

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd apps/web && npx vitest run themes.test css.test`
Expected: PASS. `themeRoleGroups` descubre `axis` sola, así que `css.ts` y `themes.test.ts` lo ven sin más cambios.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-system/tokens/tokens.ts packages/ui-system/themes/types.ts packages/ui-system/themes/dark.ts packages/ui-system/themes/light.ts packages/ui-system/tokens/tokens.css packages/ui-system/themes/themes.test.ts
git commit -m "feat(ui-system): roles de color de las zonas del eje"
```

---

### Task 11: Componente `AxisControl` — disco hexaxial

**Files:**
- Create: `apps/web/src/ui/AxisControl/AxisControl.tsx`
- Create: `apps/web/src/ui/AxisControl/AxisControl.module.css`
- Create: `apps/web/src/ui/AxisControl/hexaxial.ts`
- Create: `apps/web/src/ui/AxisControl/index.ts`
- Test: `apps/web/src/ui/AxisControl/AxisControl.test.tsx`, `apps/web/src/ui/AxisControl/hexaxial.test.ts`

**Interfaces:**
- Consumes: `zoneFor`, `ZONE_LABEL`, `ZONE_NOTE`, `AxisZone` (Task 9).
- Produces: `angleFromPoint(cx, cy, x, y): number` (grados, convención ECG: y hacia abajo, +90° abajo). `tipFor(deg, radius): { x: number; y: number }`. Componente `AxisControl({ valueDeg, min, max, referenceDeg, onChange }: AxisControlProps)`. `role="slider"` con `aria-valuenow/min/max/valuetext`; flechas ±5°, `Home` → `referenceDeg`; stepper ±5°; color de zona en el borde; rotación de 200 ms; nota clínica.

- [ ] **Step 1: Escribir los tests de la matemática pura (fallan)**

Crear `apps/web/src/ui/AxisControl/hexaxial.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { angleFromPoint, tipFor } from "./hexaxial";

describe("hexaxial — geometría del disco", () => {
  it("convención ECG: 0° a la derecha, +90° hacia abajo", () => {
    // Centro (100,100). Un punto a la derecha es 0°, abajo es +90°.
    expect(angleFromPoint(100, 100, 200, 100)).toBeCloseTo(0);
    expect(angleFromPoint(100, 100, 100, 200)).toBeCloseTo(90);
    expect(angleFromPoint(100, 100, 0, 100)).toBeCloseTo(180);
    expect(angleFromPoint(100, 100, 100, 0)).toBeCloseTo(-90);
  });

  it("la punta del vector cierra el círculo con angleFromPoint", () => {
    const { x, y } = tipFor(-30, 80);
    // tipFor da coordenadas relativas al centro; angleFromPoint(0,0,...) las
    // reinterpreta y devuelve el mismo ángulo.
    expect(angleFromPoint(0, 0, x, y)).toBeCloseTo(-30);
  });
});
```

- [ ] **Step 2: Ejecutar para ver el fallo**

Run: `cd apps/web && npx vitest run src/ui/AxisControl/hexaxial.test.ts`
Expected: FAIL — no existe `hexaxial.ts`.

- [ ] **Step 3: Implementar la geometría**

Crear `apps/web/src/ui/AxisControl/hexaxial.ts`:

```ts
// Convención del ECG hexaxial: lead I horizontal (0°) hacia la izquierda del
// paciente, aVF (+90°) hacia los pies. En pantalla el eje +y va hacia abajo,
// así que los grados positivos son horarios y +90° queda abajo, que coincide
// con la lectura clínica del diagrama.

export interface HexaxialLead {
  name: string;
  angleDeg: number;
}

/** Las seis derivaciones de miembros en sus ángulos reales. */
export const HEXAXIAL_LEADS: readonly HexaxialLead[] = [
  { name: "I", angleDeg: 0 },
  { name: "II", angleDeg: 60 },
  { name: "aVF", angleDeg: 90 },
  { name: "III", angleDeg: 120 },
  { name: "aVR", angleDeg: -150 },
  { name: "aVL", angleDeg: -30 },
];

/** Ángulo (grados, (−180,180]) del punto (x,y) respecto al centro (cx,cy). */
export function angleFromPoint(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

/** Punto a distancia `radius` en la dirección `deg`, relativo al centro. */
export function tipFor(deg: number, radius: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}
```

Crear `apps/web/src/ui/AxisControl/index.ts`:

```ts
export { AxisControl } from "./AxisControl";
export type { AxisControlProps } from "./AxisControl";
```

- [ ] **Step 4: Ejecutar los tests de geometría para verlos pasar**

Run: `cd apps/web && npx vitest run src/ui/AxisControl/hexaxial.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir los tests del componente (fallan)**

Crear `apps/web/src/ui/AxisControl/AxisControl.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AxisControl } from "./AxisControl";

function setup(valueDeg = 50) {
  const onChange = vi.fn();
  render(
    <AxisControl valueDeg={valueDeg} min={-180} max={180} referenceDeg={50} onChange={onChange} />
  );
  return { onChange, slider: screen.getByRole("slider") };
}

describe("AxisControl", () => {
  it("expone los valores ARIA del eje, con ángulo y zona en el valuetext", () => {
    const { slider } = setup(50);
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuemin", "-180");
    expect(slider).toHaveAttribute("aria-valuemax", "180");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/50°/);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/normal/i);
  });

  it("las flechas mueven 5° en cada sentido", () => {
    const { onChange, slider } = setup(50);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(45);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it("Home vuelve a la orientación de referencia", () => {
    const { onChange, slider } = setup(-40);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it("no rebasa los límites", () => {
    const { onChange, slider } = setup(180);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(180);
  });

  it("el stepper +5 / −5 llama a onChange", () => {
    const { onChange } = setup(50);
    fireEvent.click(screen.getByRole("button", { name: /aumentar/i }));
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.click(screen.getByRole("button", { name: /disminuir/i }));
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it("anuncia la zona clínica bajo el disco", () => {
    setup(-60);
    expect(screen.getByText(/desviación izquierda/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Ejecutar para ver el fallo**

Run: `cd apps/web && npx vitest run src/ui/AxisControl/AxisControl.test.tsx`
Expected: FAIL — no existe `AxisControl.tsx`.

- [ ] **Step 7: Implementar el componente**

Crear `apps/web/src/ui/AxisControl/AxisControl.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: center;
}

.disk {
  outline: none;
  touch-action: none;
}

.disk:focus-visible .border {
  stroke-width: 3;
}

/* La rotación del vector: 200 ms es lo que separa un instrumento de un salto
   instantáneo. transform-box: view-box hace que el origen sea el centro del
   viewBox. */
.vector {
  transition: transform var(--motion-normal) ease-out;
  transform-box: view-box;
  transform-origin: 100px 100px;
}

.leadLabel {
  fill: var(--text-muted);
  font-size: 9px;
}

.readout {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
}

.angle {
  font-size: var(--font-size-lg);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.zone {
  font-size: var(--font-size-sm);
}

.stepper {
  display: flex;
  gap: var(--space-2);
}

.note {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  text-align: center;
  max-width: 24ch;
}
```

Crear `apps/web/src/ui/AxisControl/AxisControl.tsx`:

```tsx
import { useCallback, useRef } from "react";
import styles from "./AxisControl.module.css";
import { angleFromPoint, HEXAXIAL_LEADS, tipFor } from "./hexaxial";
import { ZONE_LABEL, ZONE_NOTE, zoneFor } from "./axis-zones";

export interface AxisControlProps {
  /** Orientación eléctrica actual, en grados. */
  valueDeg: number;
  min: number;
  max: number;
  /** Orientación de referencia a la que vuelve `Home` (50° por defecto). */
  referenceDeg: number;
  onChange: (deg: number) => void;
}

const STEP = 5;
const CENTER = 100;
const RADIUS = 80;
const VIEWBOX = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function AxisControl({ valueDeg, min, max, referenceDeg, onChange }: AxisControlProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rounded = Math.round(valueDeg);
  const zone = zoneFor(valueDeg);
  const tip = tipFor(valueDeg, RADIUS);

  const emit = useCallback(
    (next: number) => onChange(clamp(Math.round(next), min, max)),
    [onChange, min, max]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>) => {
      switch (event.key) {
        case "ArrowUp":
        case "ArrowRight":
          event.preventDefault();
          emit(valueDeg + STEP);
          break;
        case "ArrowDown":
        case "ArrowLeft":
          event.preventDefault();
          emit(valueDeg - STEP);
          break;
        case "Home":
          event.preventDefault();
          onChange(clamp(referenceDeg, min, max));
          break;
        default:
          break;
      }
    },
    [emit, valueDeg, referenceDeg, min, max, onChange]
  );

  // Arrastrar la punta: convierte la posición del puntero, en el sistema de
  // coordenadas del SVG, a un ángulo. El teclado sigue siendo el camino
  // primario; el arrastre es una mejora encima.
  const pointerToAngle = useCallback((clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = point.matrixTransform(ctm.inverse());
    return angleFromPoint(CENTER, CENTER, local.x, local.y);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.buttons === 0) return;
      const angle = pointerToAngle(event.clientX, event.clientY);
      if (angle !== null) emit(angle);
    },
    [pointerToAngle, emit]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const angle = pointerToAngle(event.clientX, event.clientY);
      if (angle !== null) emit(angle);
    },
    [pointerToAngle, emit]
  );

  const zoneColor = `var(--axis-${zone})`;

  return (
    <div className={styles.root}>
      <svg
        ref={svgRef}
        className={styles.disk}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width="180"
        height="180"
        role="slider"
        tabIndex={0}
        aria-label="Eje eléctrico"
        aria-valuenow={rounded}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${rounded}°, ${ZONE_LABEL[zone]}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <circle
          className={styles.border}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS + 8}
          fill="none"
          stroke={zoneColor}
          strokeWidth={2}
        />
        {HEXAXIAL_LEADS.map((lead) => {
          const end = tipFor(lead.angleDeg, RADIUS);
          const label = tipFor(lead.angleDeg, RADIUS + 6);
          return (
            <g key={lead.name}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={CENTER + end.x}
                y2={CENTER + end.y}
                stroke="var(--panel-border)"
                strokeWidth={1}
              />
              <text
                className={styles.leadLabel}
                x={CENTER + label.x}
                y={CENTER + label.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {lead.name}
              </text>
            </g>
          );
        })}
        <g
          className={styles.vector}
          style={{ transform: `rotate(${valueDeg}deg)` }}
        >
          <line
            x1={CENTER}
            y1={CENTER}
            x2={CENTER + RADIUS}
            y2={CENTER}
            stroke="var(--ecg-trace)"
            strokeWidth={3}
          />
          <circle cx={CENTER + RADIUS} cy={CENTER} r={6} fill="var(--ecg-trace)" />
        </g>
      </svg>

      <div className={styles.readout}>
        <span className={styles.angle}>{rounded}°</span>
        <span className={styles.zone} style={{ color: zoneColor }}>
          {ZONE_LABEL[zone]}
        </span>
      </div>

      <div className={styles.stepper}>
        <button type="button" aria-label="Disminuir eje 5 grados" onClick={() => emit(valueDeg - STEP)}>
          −5°
        </button>
        <button type="button" aria-label="Aumentar eje 5 grados" onClick={() => emit(valueDeg + STEP)}>
          +5°
        </button>
      </div>

      <p className={styles.note}>{ZONE_NOTE[zone]}</p>
    </div>
  );
}
```

Nota de implementación: el vector rota con `transform: rotate()` sobre un `<g>`; `transform-box: view-box` (en el CSS) fija el origen de la rotación al centro del `viewBox`. El vector base apunta a 0° (a la derecha) y la rotación lo lleva a `valueDeg`, coherente con `tipFor`.

- [ ] **Step 8: Ejecutar los tests del componente para verlos pasar**

Run: `cd apps/web && npx vitest run src/ui/AxisControl/`
Expected: PASS (geometría, zonas y componente).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/ui/AxisControl/
git commit -m "feat(web): AxisControl, disco hexaxial con arrastre, teclado y zona"
```

---

### Task 12: Montaje en el puesto de simulación

**Files:**
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`
- Modify: `apps/web/src/ui/ECGWorkspace.test.tsx`
- Modify: `apps/web/src/ui/accessibility-contract.test.tsx`

**Interfaces:**
- Consumes: `AxisControl` (Task 11), `zoneFor`, `ZONE_LABEL` (Task 9), `currentParams.axis` (Task 8), `selectedRhythm.editable_parameters.orientation_deg` (Task 6/7).
- Produces: el panel del eje montado en el sidebar y una métrica «Eje» en el inspector con ángulo y zona. Al cambiar el eje se emite `runtime.update({ ...currentParams, axis: { ...currentParams.axis, orientation_deg } })`.

- [ ] **Step 1: Escribir el test que falla**

En `apps/web/src/ui/ECGWorkspace.test.tsx`, añadir `orientation_deg` al `editable_parameters` del mock de ritmo (línea ~81) para que el `AxisControl` reciba min/max:

```ts
  editable_parameters: {
    heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 },
    orientation_deg: { minimum: -180, maximum: 180, default: 50 },
    p_offset_deg: { minimum: -45, maximum: 45, default: 3.4 },
    qrs_offset_deg: { minimum: -90, maximum: 90, default: 0 },
    st_offset_deg: { minimum: -180, maximum: 180, default: 0 },
    t_offset_deg: { minimum: -180, maximum: 180, default: 0 },
  },
```

Añadir un test que, siguiendo el patrón exacto de los tests vecinos (`stubRhythmFetch()`, render con `webSocketFactory`, esperar el `display_name` «Sinusal normal», despachar `open`, `selectOptions` con `"sinus_normal"`), compruebe que aparecen el control del eje y su métrica:

```tsx
it("muestra el control del eje y su métrica cuando hay un ritmo activo", async () => {
  stubRhythmFetch();
  render(
    <ECGWorkspace
      wsUrl="ws://test"
      apiBaseUrl="http://api.test"
      webSocketFactory={() => fakeSocket as unknown as WebSocket}
    />
  );
  await waitFor(() => screen.getByText("Sinusal normal"));
  act(() => fakeSocket.dispatch("open", {}));
  await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");

  await waitFor(() =>
    expect(screen.getByRole("slider", { name: /eje eléctrico/i })).toBeInTheDocument()
  );
  expect(screen.getByText("Eje")).toBeInTheDocument();
});
```

En `accessibility-contract.test.tsx`, replicar la ampliación del `editable_parameters` del mock (línea ~28) con los cinco rangos del eje, idéntico al bloque de arriba, para que el `role="slider"` del eje reciba min/max y no rompa el contrato de accesibilidad.

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `cd apps/web && npx vitest run src/ui/ECGWorkspace.test.tsx`
Expected: FAIL — no hay `slider` de eje ni métrica «Eje».

- [ ] **Step 3: Montar el panel y la métrica**

En `ECGWorkspace.tsx`, añadir dos imports (`SectionTitle`, `Metric`, `Panel` ya vienen de `@ui-system` en las líneas 2–16; no los dupliques):

```ts
import { AxisControl } from "./AxisControl";
import { zoneFor, ZONE_LABEL } from "./AxisControl/axis-zones";
```

Dentro del `<Panel>` del sidebar, tras el bloque de `AdvancedControlPanel`/`BasicControlPanel` (línea ~277), añadir el panel del eje:

```tsx
            {selectedRhythm && currentParams && (
              <>
                <SectionTitle>Eje eléctrico</SectionTitle>
                <AxisControl
                  valueDeg={currentParams.axis.orientation_deg}
                  min={selectedRhythm.editable_parameters.orientation_deg.minimum}
                  max={selectedRhythm.editable_parameters.orientation_deg.maximum}
                  referenceDeg={selectedRhythm.editable_parameters.orientation_deg.default}
                  onChange={(orientation_deg) =>
                    runtime.update({
                      ...currentParams,
                      axis: { ...currentParams.axis, orientation_deg },
                    })
                  }
                />
              </>
            )}
```

En el inspector, dentro de `<MetricGrid>` (tras la métrica «FC», línea ~320), añadir la métrica del eje:

```tsx
              <Metric
                label="Eje"
                value={
                  currentParams
                    ? `${Math.round(currentParams.axis.orientation_deg)}° ${ZONE_LABEL[zoneFor(currentParams.axis.orientation_deg)]}`
                    : ""
                }
                unavailable={!currentParams}
              />
```

- [ ] **Step 4: Ejecutar los tests para verlos pasar**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: PASS (workspace, contrato de accesibilidad y el resto de la suite).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/ECGWorkspace.tsx apps/web/src/ui/ECGWorkspace.test.tsx apps/web/src/ui/accessibility-contract.test.tsx
git commit -m "feat(web): panel del eje electrico y metrica del eje en el inspector"
```

---

## Verificación final (tras la última tarea)

Recorrer la tabla de verificación del spec §10 y confirmar que cada fila tiene su prueba:

- [ ] `projection_for_axis(50°)` reproduce `NORMAL_AXIS_PROJECTION` (tol 5e-4) — Task 2.
- [ ] La P reproduce `ATRIAL_PROJECTION` (tol 5e-3) — Task 2.
- [ ] Einthoven `I + III = II` en barrido de 1° — Task 2.
- [ ] aVR negativa en todo el rango normal — Task 2.
- [ ] Firma de desviación izquierda y derecha — Task 2.
- [ ] Fronteras de `zone_for` por ambos lados — Task 3.
- [ ] Normalización de `zone_for` (+270 = −90) — Task 3.
- [ ] Cobertura sin huecos de las zonas — Task 3.
- [ ] Los goldens siguen pasando sin regenerar — Tasks 5 y 6 (`uv run pytest` completo).
- [ ] Espejo TS de las zonas — Task 9.
- [ ] Accesibilidad del disco (rol, ARIA, flechas, Home) — Task 11.

Ejecutar las tres suites de una vez:

```bash
cd packages/ecg-engine && uv run pytest -q
cd apps/api && uv run pytest -q
cd apps/web && npx vitest run
```

Arrancar el sistema y comprobar a mano el arrastre del vector (que jsdom no cubre): mover el eje a −60° y ver que I baja, aVL sube y aVF se invierte, mientras V1–V6 no se mueven.
