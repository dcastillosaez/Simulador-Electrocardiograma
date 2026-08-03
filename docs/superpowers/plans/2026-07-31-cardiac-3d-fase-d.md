# Fase D — Corazón 3D sincronizado (Entrega 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un corazón 3D anatómico lata en pantalla, debajo del ECG y a la vez que él, gobernado por el mismo reloj de reproducción y por eventos mecánicos que calcula el servidor — nunca por lectura de la señal.

**Architecture:** Cuatro costuras nuevas y ninguna reescritura. (1) El catálogo de ritmos gana un `MechanicalProfile`: los hechos mecánicos que la señal no revela, como dato, no como `if`. (2) Un paquete Python `packages/heart-engine` traduce los `CardiacEvent` eléctricos que el motor ya produce en ventanas de contracción por cavidad. (3) El `FrameBuffer` del cliente expone por fin su cabeza de reproducción — el `simulation_time` que la fase D exige y que hoy no existe en ningún sitio. (4) Una `CardiacTimeline` pura encola esos eventos y responde "cuánto está contraída esta cavidad en el instante t"; el animador de Three.js solo lee ese número y lo aplica a nodos del GLB buscados por nombre.

**Tech Stack:** Python 3.13 + NumPy (motor y API), TypeScript, React 18, Three.js + @react-three/fiber + @react-three/drei, Vitest 3 (jsdom), pytest. Modelo anatómico glTF 2.0 exportado desde Z-Anatomy.

**Spec:** `docs/superpowers/specs/Instrucciones_Corazon3D.md`

---

## Global Constraints

- **El corazón nunca lee muestras de señal.** Ni el `FrameBuffer.consumeNewSamples`, ni el `SweepBuffer`, ni un canvas. Solo eventos y estado. Es el principio rector del spec ("Nunca debe analizarse el ECG para mover el corazón") y la razón de que toda la fisiología viva en Python.
- **Un solo reloj.** El corazón usa `runtime.buffer.playbackTimeS`. Prohibido `Date.now()`, `performance.now()` y `useFrame`'s `clock.elapsedTime` como fuente de tiempo fisiológico. El delta de rAF solo sirve para suavizar interpolación visual, jamás para decidir en qué fase del ciclo está una cavidad.
- **`advance()` se llama exactamente una vez por tick, y la llama `useSweepRenderer`.** El corazón solo *lee* `playbackTimeS`. Una segunda llamada a `advance()` consumiría trozos que el ECG nunca llegaría a dibujar.
- **Ni un `if rhythm_id === "..."`** en ningún punto de la cadena — ni en `heart-engine`, ni en la API, ni en el cliente. Es el principio 3 del spec de fase 1. Todo comportamiento por ritmo sale de `MechanicalProfile`, que es dato de catálogo.
- **Nodos del GLB por nombre, nunca por índice.** Un índice cambia al reexportar desde Blender y el fallo es silencioso: el ventrículo late y la aorta se encoge.
- **El módulo 3D no importa nada de `apps/web/src/render/` ni de `simulation-runtime/frame-*`.** Su única superficie de contacto con el runtime es `playbackTimeS` y los eventos del `SessionRuntime`.
- **Sin WebGL en los tests.** jsdom no tiene contexto WebGL. Todo lo testeable (timeline, animador, binding de nodos, curvas) vive fuera de componentes R3F; los componentes con `<Canvas>` no llevan test unitario.
- **Los tests existentes siguen pasando** al terminar cada tarea. Hoy: suite de `packages/ecg-engine`, suite de `apps/api`, y los tests de `apps/web`.
- **Nombres de malla del GLB** (contrato con Blender, exactos): `LeftAtrium`, `RightAtrium`, `LeftVentricle`, `RightVentricle`, `Septum`, `Aorta`, `PulmonaryArtery`, `PulmonaryVeins`, `SuperiorVenaCava`, `InferiorVenaCava`.
- **Objetivos de rendimiento del spec:** 60 FPS, < 3M triángulos, < 250 MB de GPU, carga < 2 s.

---

## Alcance de esta entrega

El brief de fase D es grande: cubre un paquete de fisiología nuevo, un contrato de red nuevo, una escena 3D completa, un motor de animación procedural, un layout redimensionable, y encima tres extensiones avanzadas (conducción eléctrica visible, corte anatómico, capas conmutables) más los overlays de infarto con materiales dinámicos de perfusión. Eso no es un plan: son cuatro.

**Esta entrega es la rebanada vertical que hace que el corazón lata.** Al terminarla existe software funcionando y verificable de punta a punta: el motor publica mecánica, la red la transporta, el cliente la reproduce en el reloj correcto, y un modelo anatómico se contrae en pantalla junto al ECG.

Entra en la Entrega 1:

| | |
|---|---|
| `MechanicalProfile` en el catálogo de ritmos | Task 1 |
| `packages/heart-engine` (eventos mecánicos + `HeartState`) | Tasks 2-3 |
| Contrato WS `cardiac_events` y `heart_state` | Task 4 |
| Reloj de reproducción compartido | Task 5 |
| Recepción del contrato y cola de contracciones | Tasks 6-7 |
| Modelo anatómico y binding de nodos por nombre | Task 8 |
| Animación procedural de cavidades | Task 9 |
| Puente entre el runtime y la cola | Task 10 |
| Escena, cámara e iluminación | Task 11 |
| Layout partido ECG/corazón con divisor arrastrable | Task 12 |

**Queda explícitamente fuera, para entregas posteriores:**

| Fuera de esta entrega | Por qué | Dónde |
|---|---|---|
| Conducción eléctrica visible (SA → AV → His → Purkinje) | Necesita geometría del sistema de conducción, que no viene en el GLB anatómico. Es un modelo aparte. | Entrega 3 |
| Corte anatómico y capas conmutables | Se apoyan sobre materiales y escena ya asentados; hacerlo a la vez que se monta la escena mezcla dos problemas. | Entrega 3 |
| Overlays de infarto y materiales dinámicos de perfusión | Requieren contractilidad *regional*, no por cavidad: otro modelo de datos en `heart-engine` y segmentación del ventrículo en el GLB. | Entrega 2 |
| `strokeVolume`, `contractility`, `preload`, `afterload` | Hoy el motor no modela hemodinámica. Publicar campos que nadie calcula sería inventar datos clínicos. `HeartState` deja el mapa abierto para cuando existan. | Cuando exista el modelo hemodinámico |
| Pestañas en tablet | El `AppShell` ya apila por debajo de 1100px. Sustituirlo por pestañas es un problema de layout responsive completo. | Entrega 2 |
| Interacción con el modelo: resaltar cavidad al pasar el ratón, seleccionarla al hacer clic, panel de información anatómica, doble clic para centrar, `HeartHUD` | Necesita *raycasting* sobre el modelo y un catálogo de descripciones anatómicas que no existe. Nada de eso condiciona la animación, que es lo que esta entrega tiene que demostrar. | Entrega 2 |
| Postprocesado (bloom, FXAA) | Coste de GPU y de dependencias contra un beneficio que no se puede juzgar hasta ver el modelo real iluminado. | Entrega 2, con medición delante |

## Decisiones que se apartan del brief

Tres, y conviene que estén escritas antes de la primera tarea.

**1. `kinematics.py` no va en Python.** El brief lo lista dentro de `packages/heart-engine`. La frontera que implementa este plan es distinta: Python decide **cuándo** se contrae cada cavidad y **cuánto** (ventana temporal y amplitud) — eso es fisiología. TypeScript decide **con qué forma** transcurre esa contracción (la curva de suavizado) — eso es presentación, se evalúa 60 veces por segundo en el cliente, y meterlo en Python obligaría a mantener una implementación de referencia y un fixture dorado entre dos lenguajes para lo que es una función coseno. Si en la Entrega 2 la contractilidad regional necesita curvas por segmento, se reabre.

**2. No se crea `packages/shared-types`.** El brief lo lista en la arquitectura. Crear un paquete para alojar una enumeración y dos dataclasses es exactamente lo que YAGNI descarta, y el repositorio ya tiene un patrón resuelto para contratos entre Python y TypeScript: el espejo manual con test de contrato, que es como viaja hoy la cabecera binaria de 40 bytes (`frames.py` ↔ `frame-decoder.ts`). Se sigue ese patrón. El día que haya un tercer consumidor, el paquete se justifica solo.

**3. El corazón no toca el grid del `AppShell`.** El brief pide el corazón bajo el ECG en la columna central. Eso *ya es* el área `ecg` del grid existente: la partición ocurre dentro de esa celda, con un `SplitPane`. Así el `AppShell`, su CSS y su test no se tocan, y el divisor arrastrable que pediste sale gratis porque solo reparte el alto de un contenedor que ya está acotado.

## Mapa de ficheros

```
packages/ecg-engine/src/ecg_engine/
├── mechanics.py                    NUEVO: Chamber, ContractionMode, MechanicalProfile
└── catalog/definitions.py          MODIFICAR: un mechanical_profile por ritmo

packages/heart-engine/              NUEVO PAQUETE (Python puro, sin Three.js)
├── pyproject.toml
├── src/heart_engine/
│   ├── __init__.py                 superficie pública
│   ├── events.py                   CardiacEvent eléctrico → MechanicalEvent
│   └── heart_state.py              HeartState: modo y frecuencia por cavidad
└── tests/
    ├── test_events.py
    └── test_heart_state.py

apps/api/src/ecg_api/
├── cardiac.py                      NUEVO: payloads cardiac_events y heart_state
├── simulation.py                   MODIFICAR: cardiac_events(), heart_state()
├── streaming.py                    MODIFICAR: stream_cardiac()
└── routers/simulation_ws.py        MODIFICAR: lanzar la tarea de fondo

apps/web/src/
├── simulation-runtime/
│   ├── frame-buffer.ts             MODIFICAR: playbackTimeS
│   └── session-runtime.ts          MODIFICAR: eventos cardiacEvents y heartState
├── types/ws-messages.ts            MODIFICAR: espejo del contrato nuevo
├── cardiac/                        NUEVO: fisiología del cliente, sin Three.js
│   ├── cardiac-timeline.ts         cola de eventos + excursión en el instante t
│   ├── contraction-curve.ts        la curva de suavizado
│   └── tremor.ts                   fibrilación y flutter: temblor determinista
└── ui/Cardiac3D/                   NUEVO: todo lo que sabe de Three.js
    ├── heart-nodes.ts              binding por nombre, testeable sin WebGL
    ├── HeartAnimator.ts            excursión → escala de nodo, puro
    ├── HeartModel.tsx              carga del GLB y useFrame
    ├── HeartScene.tsx              Canvas, cámara, luces
    ├── HeartCamera.ts              presets de vista
    └── useCardiacTimeline.ts       puente runtime → timeline

packages/ui-system/components/layout/
├── SplitPane.tsx                   NUEVO: divisor arrastrable accesible
└── SplitPane.module.css

apps/web/public/models/
└── heart.glb                       ASSET: exportado de Z-Anatomy (Task 8)
```

---

### Task 1: `MechanicalProfile` en el catálogo de ritmos

Los hechos mecánicos que la señal no revela. Que una fibrilación auricular no tiene contracción auricular efectiva no se deduce del trazado: se sabe. Va como dato de catálogo, junto a `pr_is_measurable`, que ya existe exactamente por el mismo motivo.

**Files:**
- Create: `packages/ecg-engine/src/ecg_engine/mechanics.py`
- Modify: `packages/ecg-engine/src/ecg_engine/catalog/definitions.py`
- Modify: `packages/ecg-engine/src/ecg_engine/__init__.py`
- Test: `packages/ecg-engine/tests/unit/test_mechanics.py`

**Interfaces:**
- Consumes: nada.
- Produces: `Chamber` (`ATRIA`, `VENTRICLES`), `ContractionMode` (`SYNCHRONOUS`, `FIBRILLATING`, `FLUTTERING`, `ABSENT`), `MechanicalProfile` y `RhythmDefinition.mechanical_profile`.

- [ ] **Step 1: Escribir el test que falla**

`packages/ecg-engine/tests/unit/test_mechanics.py`:

```python
import pytest

from ecg_engine.catalog import RHYTHMS, get_rhythm
from ecg_engine.mechanics import Chamber, ContractionMode, MechanicalProfile


def test_todo_ritmo_del_catalogo_declara_su_perfil_mecanico():
    """Sin excepciones: un ritmo sin perfil obligaría al corazón 3D a
    inventarse su mecánica, que es justo lo que el diseño prohíbe."""
    for rhythm_id in RHYTHMS:
        profile = get_rhythm(rhythm_id).mechanical_profile
        assert isinstance(profile, MechanicalProfile)


def test_fibrilacion_auricular_no_tiene_sistole_auricular_efectiva():
    profile = get_rhythm("atrial_fibrillation").mechanical_profile
    assert profile.atrial_mode is ContractionMode.FIBRILLATING
    assert profile.atrial_amplitude < 0.15


def test_fibrilacion_ventricular_no_tiene_sistole():
    profile = get_rhythm("ventricular_fibrillation").mechanical_profile
    assert profile.ventricular_mode is ContractionMode.FIBRILLATING
    assert profile.ventricular_amplitude < 0.15


def test_bloqueo_completo_conserva_ambas_contracciones():
    """La disociación AV no anula ninguna cámara: ambas laten, cada una a lo
    suyo. Es precisamente lo que el corazón 3D hace visible."""
    profile = get_rhythm("av_block_third").mechanical_profile
    assert profile.atrial_mode is ContractionMode.SYNCHRONOUS
    assert profile.ventricular_mode is ContractionMode.SYNCHRONOUS


def test_amplitudes_en_rango_unitario():
    for rhythm_id in RHYTHMS:
        profile = get_rhythm(rhythm_id).mechanical_profile
        assert 0.0 <= profile.atrial_amplitude <= 1.0
        assert 0.0 <= profile.ventricular_amplitude <= 1.0


def test_duraciones_positivas():
    for rhythm_id in RHYTHMS:
        profile = get_rhythm(rhythm_id).mechanical_profile
        assert profile.atrial_systole_s > 0
        assert 0.0 < profile.ventricular_systole_fraction <= 1.0


@pytest.mark.parametrize("chamber", list(Chamber))
def test_chamber_serializa_como_texto(chamber):
    """Viaja por JSON: el valor tiene que ser el texto, no el nombre."""
    assert isinstance(chamber.value, str)
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
cd packages/ecg-engine && python -m pytest tests/unit/test_mechanics.py -v
```

Esperado: FAIL con `ModuleNotFoundError: No module named 'ecg_engine.mechanics'`.

- [ ] **Step 3: Crear `mechanics.py`**

`packages/ecg-engine/src/ecg_engine/mechanics.py`:

```python
"""Hechos mecánicos de un ritmo.

El motor genera señal eléctrica; la mecánica que la acompaña no se deduce de
esa señal. Que una fibrilación auricular no produzca sístole auricular
efectiva es un hecho clínico, no una propiedad del trazado — igual que
`pr_is_measurable`, que ya vive en el catálogo por la misma razón.

Vive en `ecg-engine` y no en `heart-engine` porque es un atributo del ritmo, y
el catálogo de ritmos es de este paquete. `heart-engine` lo consume; no lo
posee.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Chamber(str, Enum):
    """Las dos unidades mecánicas que esta entrega distingue.

    No hay cavidades izquierda y derecha por separado: laten juntas y con la
    misma temporización. Separarlas hace falta el día que haya disincronía
    (bloqueo de rama, marcapasos), y ese día se añade sin romper el contrato
    porque el consumidor ya lee un enum, no un booleano.
    """

    ATRIA = "atria"
    VENTRICLES = "ventricles"


class ContractionMode(str, Enum):
    """Cómo se comporta mecánicamente una cámara en este ritmo."""

    SYNCHRONOUS = "synchronous"
    """Contracción organizada, disparada por eventos discretos."""

    FLUTTERING = "fluttering"
    """Contracción rápida, regular y de poca excursión. Sin eventos útiles:
    la cámara vibra a `flutter_hz`."""

    FIBRILLATING = "fibrillating"
    """Movimiento desorganizado y de excursión mínima. Sin eventos."""

    ABSENT = "absent"
    """Sin movimiento. Reservado para la asistolia, que aún no está en el
    catálogo; existe para que el consumidor no tenga que tratarla como un
    caso especial el día que llegue."""


@dataclass(frozen=True, slots=True)
class MechanicalProfile:
    """Perfil mecánico de un ritmo, por cámara."""

    atrial_mode: ContractionMode
    ventricular_mode: ContractionMode

    atrial_amplitude: float
    """Excursión auricular, 0 a 1, relativa a la sístole auricular normal."""

    ventricular_amplitude: float
    """Excursión ventricular, 0 a 1, relativa a la sístole ventricular normal."""

    atrial_systole_s: float = 0.11
    """Duración de la sístole auricular. Es sensiblemente constante y no
    escala con la frecuencia cardíaca, a diferencia de la ventricular."""

    ventricular_systole_fraction: float = 0.4
    """Fracción del intervalo RR que ocupa la sístole ventricular. A 60 lpm
    son unos 400 ms; al acelerar, la sístole se acorta menos que la diástole,
    pero para una representación visual la proporción constante basta y evita
    modelar la relación no lineal."""

    flutter_hz: float = 5.0
    """Frecuencia del temblor en modo `FLUTTERING` o `FIBRILLATING`. En el
    flutter auricular típico son unas 300 ondas por minuto."""


NORMAL_PROFILE = MechanicalProfile(
    atrial_mode=ContractionMode.SYNCHRONOUS,
    ventricular_mode=ContractionMode.SYNCHRONOUS,
    atrial_amplitude=1.0,
    ventricular_amplitude=1.0,
)
```

- [ ] **Step 4: Añadir el campo a `RhythmDefinition` y el perfil a los doce ritmos**

En `packages/ecg-engine/src/ecg_engine/catalog/definitions.py`, añadir el import al principio del fichero:

```python
from ..mechanics import ContractionMode, MechanicalProfile, NORMAL_PROFILE
```

Añadir el campo a `RhythmDefinition`, después de `allowed_overlays` (línea 101) para que siga siendo el último con valor por defecto:

```python
    mechanical_profile: MechanicalProfile = field(default=NORMAL_PROFILE)
```

El valor por defecto es deliberado: los ocho ritmos con mecánica normal no lo declaran, y solo los cuatro que se apartan escriben algo. Añadir a cada definición, dentro de la llamada correspondiente:

```python
# atrial_fibrillation (línea ~307): la aurícula no bombea, el ventrículo sí
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.FIBRILLATING,
            ventricular_mode=ContractionMode.SYNCHRONOUS,
            atrial_amplitude=0.06,
            ventricular_amplitude=1.0,
            flutter_hz=7.0,
        ),

# atrial_flutter (línea ~327): aurícula vibrando a 300/min, conducción parcial
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.FLUTTERING,
            ventricular_mode=ContractionMode.SYNCHRONOUS,
            atrial_amplitude=0.18,
            ventricular_amplitude=1.0,
            flutter_hz=5.0,
        ),

# ventricular_tachycardia (línea ~366): llenado incompleto, menos excursión
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.SYNCHRONOUS,
            ventricular_mode=ContractionMode.SYNCHRONOUS,
            atrial_amplitude=0.5,
            ventricular_amplitude=0.55,
        ),

# ventricular_fibrillation (línea ~384): no hay sístole, solo temblor
        mechanical_profile=MechanicalProfile(
            atrial_mode=ContractionMode.FIBRILLATING,
            ventricular_mode=ContractionMode.FIBRILLATING,
            atrial_amplitude=0.05,
            ventricular_amplitude=0.10,
            flutter_hz=6.0,
        ),
```

`ventricular_tachycardia` conserva `SYNCHRONOUS` en ambas cámaras: en una TV las aurículas siguen a lo suyo, no dejan de contraerse. Lo que cambia es la eficacia, y eso se expresa bajando la amplitud, no cambiando el modo.

- [ ] **Step 5: Exportar desde el paquete**

En `packages/ecg-engine/src/ecg_engine/__init__.py`, añadir a los imports y a `__all__`:

```python
from .mechanics import Chamber, ContractionMode, MechanicalProfile
```

- [ ] **Step 6: Ejecutar los tests**

```bash
cd packages/ecg-engine && python -m pytest tests/unit/test_mechanics.py tests/unit/test_catalog.py -v
```

Esperado: PASS en todos.

- [ ] **Step 7: Comprobar que no se ha roto nada**

```bash
cd packages/ecg-engine && python -m pytest -q
```

Esperado: la suite completa en verde.

- [ ] **Step 8: Commit**

```bash
git add packages/ecg-engine/src/ecg_engine/mechanics.py packages/ecg-engine/src/ecg_engine/catalog/definitions.py packages/ecg-engine/src/ecg_engine/__init__.py packages/ecg-engine/tests/unit/test_mechanics.py
git commit -m "feat(engine): perfil mecanico por ritmo en el catalogo"
```

---

### Task 2: Paquete `heart-engine` y derivación de eventos mecánicos

El corazón necesita saber cuándo empieza y acaba cada contracción. El motor ya produce `CardiacEvent` con el instante de referencia (pico de la P, pico de la R) y el `template_id`; de la plantilla sale la extensión temporal de cada onda. Traducir lo uno en lo otro es fisiología, y va en Python.

**Files:**
- Create: `packages/heart-engine/pyproject.toml`
- Create: `packages/heart-engine/src/heart_engine/__init__.py`
- Create: `packages/heart-engine/src/heart_engine/events.py`
- Test: `packages/heart-engine/tests/test_events.py`

**Interfaces:**
- Consumes: `CardiacEvent`, `EventKind`, `WaveTarget` de `ecg_engine.types`; `get_template`, `target_extent_s` de `ecg_engine.beat`; `Chamber`, `ContractionMode`, `MechanicalProfile` de `ecg_engine.mechanics` (Task 1).
- Produces: `MechanicalEvent(chamber, t_start_s, t_peak_s, t_end_s, amplitude, index)` y `derive_mechanical_events(events, profile, rr_s) -> list[MechanicalEvent]`.

- [ ] **Step 1: Crear el esqueleto del paquete**

`packages/heart-engine/pyproject.toml`:

```toml
[project]
name = "heart-engine"
version = "0.1.0"
description = "Traduccion de electrofisiologia a mecanica cardiaca"
requires-python = ">=3.13"
dependencies = ["ecg-engine"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/heart_engine"]
```

`packages/heart-engine/src/heart_engine/__init__.py`:

```python
"""Mecánica cardíaca derivada de la electrofisiología.

Este paquete no genera señal ni decide conducción: consume los eventos
eléctricos que produce `ecg-engine` y los traduce en ventanas de contracción
por cámara. No importa Three.js, ni NumPy, ni nada del servidor web — es
fisiología pura, testeable con listas de dataclasses.
"""

from .events import MechanicalEvent, derive_mechanical_events

__all__ = ["MechanicalEvent", "derive_mechanical_events"]
```

- [ ] **Step 2: Escribir el test que falla**

`packages/heart-engine/tests/test_events.py`:

```python
from ecg_engine.mechanics import Chamber, ContractionMode, MechanicalProfile, NORMAL_PROFILE
from ecg_engine.types import CardiacEvent, EventKind

from heart_engine.events import derive_mechanical_events

RR_S = 60.0 / 72.0


def _atrial(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.ATRIAL, t_s=t_s, template_id="sinus_p", index=index
    )


def _ventricular(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.VENTRICULAR, t_s=t_s, template_id="normal", index=index
    )


def test_evento_auricular_produce_contraccion_auricular():
    result = derive_mechanical_events([_atrial(1.0)], NORMAL_PROFILE, RR_S)

    assert len(result) == 1
    assert result[0].chamber is Chamber.ATRIA


def test_la_sistole_auricular_empieza_con_la_onda_p_no_en_su_pico():
    """El pico de la P es el instante de referencia del evento; la
    contracción arranca cuando arranca la onda, antes de ese pico."""
    result = derive_mechanical_events([_atrial(1.0)], NORMAL_PROFILE, RR_S)

    assert result[0].t_start_s < 1.0


def test_la_sistole_auricular_dura_lo_que_dice_el_perfil():
    result = derive_mechanical_events([_atrial(1.0)], NORMAL_PROFILE, RR_S)
    event = result[0]

    duration = event.t_end_s - event.t_start_s
    assert duration == NORMAL_PROFILE.atrial_systole_s


def test_la_sistole_ventricular_escala_con_el_intervalo_rr():
    lento = derive_mechanical_events([_ventricular(1.0)], NORMAL_PROFILE, 1.0)
    rapido = derive_mechanical_events([_ventricular(1.0)], NORMAL_PROFILE, 0.4)

    duracion_lenta = lento[0].t_end_s - lento[0].t_start_s
    duracion_rapida = rapido[0].t_end_s - rapido[0].t_start_s
    assert duracion_rapida < duracion_lenta


def test_el_pico_cae_dentro_de_la_ventana():
    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], NORMAL_PROFILE, RR_S
    )

    for event in result:
        assert event.t_start_s < event.t_peak_s < event.t_end_s


def test_la_amplitud_sale_del_perfil():
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.SYNCHRONOUS,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.5,
        ventricular_amplitude=0.7,
    )

    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], profile, RR_S
    )

    por_camara = {event.chamber: event.amplitude for event in result}
    assert por_camara[Chamber.ATRIA] == 0.5
    assert por_camara[Chamber.VENTRICLES] == 0.7


def test_una_camara_fibrilando_no_produce_eventos_discretos():
    """En fibrilación no hay contracción organizada que temporizar: el
    movimiento es temblor continuo, y ese lo genera el cliente a partir del
    modo y la frecuencia, no de eventos."""
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.FIBRILLATING,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.06,
        ventricular_amplitude=1.0,
    )

    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], profile, RR_S
    )

    assert all(event.chamber is Chamber.VENTRICLES for event in result)


def test_una_camara_ausente_no_produce_eventos():
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.ABSENT,
        ventricular_mode=ContractionMode.ABSENT,
        atrial_amplitude=0.0,
        ventricular_amplitude=0.0,
    )

    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], profile, RR_S
    )

    assert result == []


def test_la_disociacion_av_conserva_ambos_trenes_independientes():
    """Un bloqueo completo: cuatro Ps y dos QRS sin relación. Las seis
    contracciones tienen que salir, cada una en su instante."""
    events = [
        _atrial(0.0, 0), _atrial(0.8, 1), _atrial(1.6, 2), _atrial(2.4, 3),
        _ventricular(0.3, 0), _ventricular(1.9, 1),
    ]

    result = derive_mechanical_events(events, NORMAL_PROFILE, 1.6)

    auriculares = [e for e in result if e.chamber is Chamber.ATRIA]
    ventriculares = [e for e in result if e.chamber is Chamber.VENTRICLES]
    assert len(auriculares) == 4
    assert len(ventriculares) == 2


def test_el_resultado_sale_ordenado_por_tiempo_de_inicio():
    events = [_ventricular(2.0), _atrial(1.0), _ventricular(1.16)]

    result = derive_mechanical_events(events, NORMAL_PROFILE, RR_S)

    tiempos = [event.t_start_s for event in result]
    assert tiempos == sorted(tiempos)


def test_se_conserva_el_indice_del_evento_electrico():
    """El cliente deduplica por (cámara, índice): los eventos llegan en
    ventanas que pueden solaparse si un chunk se reenvía."""
    result = derive_mechanical_events([_atrial(1.0, index=42)], NORMAL_PROFILE, RR_S)

    assert result[0].index == 42
```

- [ ] **Step 3: Ejecutar el test y comprobar que falla**

```bash
cd packages/heart-engine && python -m pytest tests/test_events.py -v
```

Esperado: FAIL con `ModuleNotFoundError: No module named 'heart_engine.events'`.

- [ ] **Step 4: Implementar `events.py`**

`packages/heart-engine/src/heart_engine/events.py`:

```python
"""Eventos eléctricos discretos → ventanas de contracción por cámara.

La traducción no es un cambio de nombre: un `CardiacEvent` marca el pico de
una onda, y una contracción es un intervalo con inicio, máximo y final. El
inicio sale de la extensión temporal de la onda en la plantilla del latido;
la duración, del perfil mecánico del ritmo.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ecg_engine.beat import get_template, target_extent_s
from ecg_engine.mechanics import Chamber, ContractionMode, MechanicalProfile
from ecg_engine.types import CardiacEvent, EventKind, WaveTarget

_PEAK_FRACTION = 0.45
"""Dónde cae la contracción máxima dentro de la ventana. Antes de la mitad:
el corazón se contrae más deprisa de lo que se relaja."""


@dataclass(frozen=True, slots=True)
class MechanicalEvent:
    """Una contracción de una cámara, con su ventana temporal completa.

    `t_start_s` a `t_peak_s` es la contracción; `t_peak_s` a `t_end_s`, la
    relajación. El cliente interpola dentro de esa ventana; no calcula
    ninguno de los tres instantes.
    """

    chamber: Chamber
    t_start_s: float
    t_peak_s: float
    t_end_s: float
    amplitude: float
    index: int

    def as_payload(self) -> dict:
        """Forma serializable. Se redondea a milisegundos: el cliente
        interpola sobre esta ventana, y un microsegundo de precisión extra no
        cambia un solo píxel pero sí engorda cada mensaje."""
        return {
            "chamber": self.chamber.value,
            "t_start_s": round(self.t_start_s, 3),
            "t_peak_s": round(self.t_peak_s, 3),
            "t_end_s": round(self.t_end_s, 3),
            "amplitude": round(self.amplitude, 3),
            "index": self.index,
        }


def _produces_events(mode: ContractionMode) -> bool:
    """Solo la contracción organizada se temporiza con eventos. El temblor
    de una fibrilación o un flutter es continuo: el cliente lo genera del
    modo y la frecuencia, sin necesidad de que el servidor le mande nada."""
    return mode is ContractionMode.SYNCHRONOUS


def _atrial_window(event: CardiacEvent, profile: MechanicalProfile) -> tuple[float, float]:
    template = get_template(event.template_id)
    p_start, _ = target_extent_s(template, WaveTarget.P)
    start_s = event.t_s + p_start
    return start_s, start_s + profile.atrial_systole_s


def _ventricular_window(
    event: CardiacEvent, profile: MechanicalProfile, rr_s: float
) -> tuple[float, float]:
    template = get_template(event.template_id)
    qrs_start, _ = target_extent_s(template, WaveTarget.QRS)
    start_s = event.t_s + qrs_start
    return start_s, start_s + rr_s * profile.ventricular_systole_fraction


def derive_mechanical_events(
    events: Sequence[CardiacEvent],
    profile: MechanicalProfile,
    rr_s: float,
) -> list[MechanicalEvent]:
    """Traduce eventos eléctricos en contracciones, ordenadas por inicio.

    `rr_s` es el intervalo RR vigente: la sístole ventricular escala con él,
    la auricular no. Se pasa como parámetro y no se deduce de `events` porque
    en un bloqueo completo la distancia entre dos QRS de escape no es el RR
    que gobierna nada.
    """
    result: list[MechanicalEvent] = []

    for event in events:
        if event.kind is EventKind.ATRIAL:
            chamber = Chamber.ATRIA
            mode = profile.atrial_mode
            amplitude = profile.atrial_amplitude
            start_s, end_s = _atrial_window(event, profile)
        else:
            chamber = Chamber.VENTRICLES
            mode = profile.ventricular_mode
            amplitude = profile.ventricular_amplitude
            start_s, end_s = _ventricular_window(event, profile, rr_s)

        if not _produces_events(mode):
            continue

        result.append(
            MechanicalEvent(
                chamber=chamber,
                t_start_s=start_s,
                t_peak_s=start_s + (end_s - start_s) * _PEAK_FRACTION,
                t_end_s=end_s,
                amplitude=amplitude,
                index=event.index,
            )
        )

    result.sort(key=lambda item: item.t_start_s)
    return result
```

- [ ] **Step 5: Instalar el paquete en el entorno de la API y ejecutar los tests**

```bash
cd packages/heart-engine && pip install -e . && python -m pytest tests/ -v
```

Esperado: los 12 tests en PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/heart-engine
git commit -m "feat(heart-engine): derivacion de eventos mecanicos desde electricos"
```

---

### Task 3: `HeartState`

El estado que no son eventos: qué modo tiene cada cámara y a qué frecuencia. Es lo que permite al cliente animar una fibrilación, que no produce ningún evento.

**Files:**
- Create: `packages/heart-engine/src/heart_engine/heart_state.py`
- Modify: `packages/heart-engine/src/heart_engine/__init__.py`
- Test: `packages/heart-engine/tests/test_heart_state.py`

**Interfaces:**
- Consumes: `ContractionMode`, `MechanicalProfile` de `ecg_engine.mechanics`.
- Produces: `HeartState` con `from_profile(profile, rhythm_id, heart_rate_bpm)` y `as_payload()`.

- [ ] **Step 1: Escribir el test que falla**

`packages/heart-engine/tests/test_heart_state.py`:

```python
from ecg_engine.mechanics import ContractionMode, MechanicalProfile, NORMAL_PROFILE

from heart_engine.heart_state import HeartState


def test_recoge_los_modos_del_perfil():
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.FIBRILLATING,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.06,
        ventricular_amplitude=1.0,
    )

    state = HeartState.from_profile(profile, "atrial_fibrillation", 88.0)

    assert state.atrial_mode is ContractionMode.FIBRILLATING
    assert state.ventricular_mode is ContractionMode.SYNCHRONOUS


def test_el_payload_serializa_los_modos_como_texto():
    state = HeartState.from_profile(NORMAL_PROFILE, "sinus_normal", 72.0)

    payload = state.as_payload()

    assert payload["values"]["atrial_mode"] == "synchronous"
    assert payload["values"]["ventricular_mode"] == "synchronous"


def test_el_payload_lleva_el_tipo_del_mensaje():
    state = HeartState.from_profile(NORMAL_PROFILE, "sinus_normal", 72.0)

    assert state.as_payload()["type"] == "heart_state"


def test_el_payload_lleva_las_amplitudes_y_la_frecuencia_de_temblor():
    """El cliente las necesita para animar una cámara que no manda eventos."""
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.FLUTTERING,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.18,
        ventricular_amplitude=1.0,
        flutter_hz=5.0,
    )

    values = HeartState.from_profile(profile, "atrial_flutter", 75.0).as_payload()["values"]

    assert values["atrial_amplitude"] == 0.18
    assert values["flutter_hz"] == 5.0


def test_una_frecuencia_desconocida_viaja_como_null():
    """`None` y no un cero: cero latidos por minuto es una afirmación
    clínica, y aquí lo que pasa es que todavía no se ha medido."""
    state = HeartState.from_profile(NORMAL_PROFILE, "sinus_normal", None)

    assert state.as_payload()["values"]["heart_rate_bpm"] is None
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
cd packages/heart-engine && python -m pytest tests/test_heart_state.py -v
```

Esperado: FAIL con `ModuleNotFoundError: No module named 'heart_engine.heart_state'`.

- [ ] **Step 3: Implementar `heart_state.py`**

`packages/heart-engine/src/heart_engine/heart_state.py`:

```python
"""Estado mecánico vigente del corazón.

Lo que no cabe en un evento: el modo de cada cámara y los parámetros del
temblor. Un evento dice "contráete ahora"; el estado dice "esta aurícula no
va a contraerse en absoluto, va a fibrilar a 7 Hz".

`values` es un mapa abierto, igual que en `measurements`: cuando exista el
modelo hemodinámico, `stroke_volume` y `contractility` entran aquí sin
romper a ningún cliente anterior, que se limita a ignorar lo que no conoce.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ecg_engine.mechanics import ContractionMode, MechanicalProfile


@dataclass(frozen=True, slots=True)
class HeartState:
    rhythm_id: str
    heart_rate_bpm: float | None
    atrial_mode: ContractionMode
    ventricular_mode: ContractionMode
    atrial_amplitude: float
    ventricular_amplitude: float
    flutter_hz: float

    @classmethod
    def from_profile(
        cls,
        profile: MechanicalProfile,
        rhythm_id: str,
        heart_rate_bpm: float | None,
    ) -> HeartState:
        return cls(
            rhythm_id=rhythm_id,
            heart_rate_bpm=heart_rate_bpm,
            atrial_mode=profile.atrial_mode,
            ventricular_mode=profile.ventricular_mode,
            atrial_amplitude=profile.atrial_amplitude,
            ventricular_amplitude=profile.ventricular_amplitude,
            flutter_hz=profile.flutter_hz,
        )

    def as_payload(self) -> dict[str, Any]:
        return {
            "type": "heart_state",
            "values": {
                "rhythm_id": self.rhythm_id,
                "heart_rate_bpm": self.heart_rate_bpm,
                "atrial_mode": self.atrial_mode.value,
                "ventricular_mode": self.ventricular_mode.value,
                "atrial_amplitude": self.atrial_amplitude,
                "ventricular_amplitude": self.ventricular_amplitude,
                "flutter_hz": self.flutter_hz,
            },
        }
```

- [ ] **Step 4: Exportar desde el paquete**

En `packages/heart-engine/src/heart_engine/__init__.py`, sustituir el bloque de imports:

```python
from .events import MechanicalEvent, derive_mechanical_events
from .heart_state import HeartState

__all__ = ["HeartState", "MechanicalEvent", "derive_mechanical_events"]
```

- [ ] **Step 5: Ejecutar los tests**

```bash
cd packages/heart-engine && python -m pytest tests/ -v
```

Esperado: los 17 tests en PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/heart-engine
git commit -m "feat(heart-engine): HeartState con modo y amplitud por camara"
```

---

### Task 4: Publicación por WebSocket

Dos mensajes JSON nuevos junto a `measurements`, por el mismo canal y con la misma justificación: mezclarlos con el formato binario obligaría a versionarlo cada vez que se añada un campo.

**La invariante que hace que esto funcione:** los eventos se publican solo para señal **ya generada** (`[último publicado, engine.t_s]`), nunca mirando al futuro. Llegan a tiempo porque la reproducción del cliente va por detrás de la generación al menos lo que dure el pre-roll del buffer de jitter — 300 ms en el peor caso sano, 500 ms de objetivo. Publicar por adelantado obligaría a materializar el tren de eventos antes de renderizarlo, y un cambio de frecuencia a mitad haría sonar latidos a la frecuencia vieja.

**Files:**
- Create: `apps/api/src/ecg_api/cardiac.py`
- Modify: `apps/api/src/ecg_api/simulation.py`
- Modify: `apps/api/src/ecg_api/streaming.py`
- Modify: `apps/api/src/ecg_api/routers/simulation_ws.py`
- Test: `apps/api/tests/test_cardiac.py`

**Interfaces:**
- Consumes: `derive_mechanical_events`, `HeartState` de `heart_engine` (Tasks 2-3); `SimulationManager`, `SimulationState` de `.simulation`.
- Produces: `cardiac_events_payload(...)`, `CARDIAC_INTERVAL_S`; `SimulationManager.cardiac_events()` y `.heart_state()`; `stream_cardiac(manager, publish, interval_s)`.

- [ ] **Step 1: Escribir el test que falla**

`apps/api/tests/test_cardiac.py`:

```python
import pytest

from ecg_api.cardiac import cardiac_events_payload
from ecg_api.simulation import SimulationManager


def test_sin_sesion_no_hay_eventos():
    manager = SimulationManager()

    assert manager.cardiac_events() is None
    assert manager.heart_state() is None


def test_una_sesion_sinusal_produce_contracciones():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    # Cuatro segundos de señal: a 72 lpm son unas cinco contracciones.
    for _ in range(40):
        manager.next_chunk()

    payload = manager.cardiac_events()

    assert payload["type"] == "cardiac_events"
    assert len(payload["events"]) > 0


def test_los_eventos_no_se_repiten_entre_llamadas():
    """La ventana avanza: lo que ya se publicó no vuelve a salir. Sin esto,
    cada mensaje reenviaría toda la sesión y el ancho de banda crecería sin
    límite."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()
    primeros = manager.cardiac_events()["events"]

    for _ in range(40):
        manager.next_chunk()
    segundos = manager.cardiac_events()["events"]

    inicios_primeros = {e["t_start_s"] for e in primeros}
    inicios_segundos = {e["t_start_s"] for e in segundos}
    assert inicios_primeros.isdisjoint(inicios_segundos)


def test_los_eventos_publicados_son_de_senal_ya_generada():
    """La invariante que garantiza que lleguen a tiempo: nunca se mira al
    futuro."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    payload = manager.cardiac_events()

    for event in payload["events"]:
        assert event["t_start_s"] <= manager.duration_s


def test_la_fibrilacion_ventricular_no_produce_eventos_pero_si_estado():
    """Su fuente no implementa `events`. No es un fallo: una FV no tiene
    latidos que enumerar. El temblor lo anima el cliente desde el estado."""
    manager = SimulationManager()
    manager.start("ventricular_fibrillation", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    assert manager.cardiac_events()["events"] == []
    assert manager.heart_state()["values"]["ventricular_mode"] == "fibrillating"


def test_el_estado_lleva_el_ritmo_activo():
    manager = SimulationManager()
    manager.start("atrial_fibrillation", None, seed=1)

    values = manager.heart_state()["values"]

    assert values["rhythm_id"] == "atrial_fibrillation"
    assert values["atrial_mode"] == "fibrillating"


def test_arrancar_otro_ritmo_reinicia_la_ventana_de_publicacion():
    """Un `start` nuevo arranca un eje de tiempo nuevo. Sin reinicio, la
    marca de agua vieja se comería los primeros latidos del ritmo nuevo."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()
    manager.cardiac_events()

    manager.start("sinus_bradycardia", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    assert len(manager.cardiac_events()["events"]) > 0


def test_el_payload_declara_su_ventana():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(20):
        manager.next_chunk()

    payload = manager.cardiac_events()

    assert payload["t_start_s"] == 0.0
    assert payload["t_end_s"] == pytest.approx(manager.duration_s)
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
cd apps/api && python -m pytest tests/test_cardiac.py -v
```

Esperado: FAIL con `ModuleNotFoundError: No module named 'ecg_api.cardiac'`.

- [ ] **Step 3: Crear `cardiac.py`**

`apps/api/src/ecg_api/cardiac.py`:

```python
"""Mecánica cardíaca publicada durante el streaming.

La calcula `heart-engine`; aquí solo vive la ventana temporal de publicación
y la traducción al contrato que viaja por el WebSocket. Es el mismo reparto
de responsabilidades que `measuring.py` tiene con `ecg_engine.measure`.
"""

from __future__ import annotations

from typing import Any, Sequence

from ecg_engine.mechanics import MechanicalProfile
from ecg_engine.types import CardiacEvent
from heart_engine import derive_mechanical_events

CARDIAC_INTERVAL_S: float = 0.25
"""Cada cuánto se publica.

Cuatro veces por segundo. Más deprisa no aporta —los eventos llegan de todos
modos con la holgura del buffer de jitter— y más despacio acercaría el
mensaje al límite de esa holgura: a 1 Hz, un evento generado justo después de
publicar espera hasta un segundo, y el pre-roll del cliente son 500 ms.
"""


def cardiac_events_payload(
    *,
    events: Sequence[CardiacEvent],
    profile: MechanicalProfile,
    rr_s: float,
    t_start_s: float,
    t_end_s: float,
) -> dict[str, Any]:
    """Compone el mensaje de contracciones para la ventana dada."""
    mechanical = derive_mechanical_events(events, profile, rr_s)
    return {
        "type": "cardiac_events",
        "t_start_s": round(t_start_s, 3),
        "t_end_s": round(t_end_s, 3),
        "events": [event.as_payload() for event in mechanical],
    }
```

- [ ] **Step 4: Añadir los métodos al `SimulationManager`**

En `apps/api/src/ecg_api/simulation.py`, añadir a los imports:

```python
from heart_engine import HeartState

from .cardiac import cardiac_events_payload
```

En `__init__`, junto a `self._window`:

```python
        self._cardiac_published_until_s: float = 0.0
```

En `start()`, junto al reinicio de la ventana de medidas (después de `self._window = MeasurementWindow(...)`):

```python
        # Marca de agua nueva: un ritmo nuevo arranca en t=0, y conservar la
        # del ritmo anterior se comería sus primeros latidos.
        self._cardiac_published_until_s = 0.0
```

Y los dos métodos nuevos, después de `measurements()`:

```python
    def _profile(self) -> MechanicalProfile:
        return get_rhythm(self.rhythm_id).mechanical_profile

    def cardiac_events(self) -> dict | None:
        """Contracciones de la señal generada desde la última publicación.

        Nunca mira al futuro: solo traduce eventos de señal que el motor ya
        rindió. Llegan a tiempo al cliente porque su reproducción va por
        detrás de la generación lo que dure el pre-roll del buffer de jitter.
        """
        if self._engine is None:
            return None

        t_start_s = self._cardiac_published_until_s
        t_end_s = self._engine.t_s
        source = self._engine.source
        # Una FV no implementa `events`: no tiene latidos discretos que
        # enumerar. Sale una lista vacía, que es la respuesta correcta.
        events = (
            source.events(t_start_s, t_end_s)
            if hasattr(source, "events")
            else []
        )
        self._cardiac_published_until_s = t_end_s

        return cardiac_events_payload(
            events=events,
            profile=self._profile(),
            rr_s=1.0 / self._engine.params.heart_rate_hz,
            t_start_s=t_start_s,
            t_end_s=t_end_s,
        )

    def heart_state(self) -> dict | None:
        if self._engine is None:
            return None
        return HeartState.from_profile(
            self._profile(),
            self.rhythm_id,
            self._engine.params.heart_rate_hz * 60.0,
        ).as_payload()
```

Añadir `MechanicalProfile` al import de `ecg_engine`:

```python
from ecg_engine.mechanics import MechanicalProfile
```

- [ ] **Step 5: Ejecutar los tests de `cardiac`**

```bash
cd apps/api && python -m pytest tests/test_cardiac.py -v
```

Esperado: los 8 tests en PASS.

- [ ] **Step 6: Añadir el bucle de publicación**

En `apps/api/src/ecg_api/streaming.py`, añadir al import de `.cardiac`:

```python
from .cardiac import CARDIAC_INTERVAL_S
```

Y la corrutina, al final del fichero:

```python
async def stream_cardiac(
    manager: SimulationManager,
    publish: Callable[[dict], Awaitable[None]],
    *,
    interval_s: float = CARDIAC_INTERVAL_S,
) -> None:
    """Publica contracciones y estado mecánico a cadencia media.

    Su propio bucle, por el mismo motivo que las medidas tienen el suyo: son
    tres ritmos distintos —frames diez veces por segundo, contracciones
    cuatro, medidas una— y colgarlos del mismo temporizador obligaría al más
    lento a correr a la cadencia del más rápido.

    En pausa no publica. El reloj de simulación está detenido: no hay
    contracciones nuevas que anunciar, y el corazón del cliente se congela
    solo, porque su reloj es la cabeza de reproducción del buffer y esa
    tampoco avanza.
    """
    next_tick = asyncio.get_running_loop().time()
    while True:
        if manager.state is SimulationState.RUNNING:
            events = manager.cardiac_events()
            if events is not None and events["events"]:
                await publish(events)
            state = manager.heart_state()
            if state is not None:
                await publish(state)
        next_tick += interval_s
        await asyncio.sleep(max(0.0, next_tick - asyncio.get_running_loop().time()))
```

- [ ] **Step 7: Lanzar la tarea desde el handler del WebSocket**

En `apps/api/src/ecg_api/routers/simulation_ws.py`, cambiar el import de `..streaming`:

```python
from ..streaming import stream_cardiac, stream_chunks, stream_measurements
```

Después de crear `measurements_task` (línea ~244), añadir:

```python
                cardiac_task = asyncio.create_task(
                    stream_cardiac(manager, websocket.send_json)
                )
```

Y ampliar las dos líneas que registran las tareas:

```python
                for task in (
                    producer_task, sender_task, measurements_task, cardiac_task
                ):
                    task.add_done_callback(
                        functools.partial(
                            _on_background_task_done,
                            websocket=websocket,
                            manager=manager,
                            close_tasks=close_tasks,
                        )
                    )
                background_tasks = [
                    producer_task, sender_task, measurements_task, cardiac_task
                ]
```

- [ ] **Step 8: Ejecutar la suite de la API**

```bash
cd apps/api && python -m pytest -q
```

Esperado: toda la suite en verde, incluidos los tests del WebSocket que ya existían.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): publicacion de contracciones y estado mecanico por WS"
```

---

### Task 5: El reloj de reproducción

La pieza que la fase D exige y que hoy no existe: `simulation_time`. El `FrameBuffer` ya sabe exactamente dónde está la cabeza de reproducción —`pendingS` es la fracción consumida del trozo de cabeza— pero no lo publica.

Que el reloj salga de aquí y no de `performance.now()` resuelve gratis tres cosas que de otro modo habría que programar: el corazón se congela en una pausa, se congela en un underrun, y se salta al mismo sitio que el trazo cuando el buffer descarta por overrun.

**Files:**
- Modify: `apps/web/src/simulation-runtime/frame-buffer.ts`
- Test: `apps/web/src/simulation-runtime/frame-buffer.test.ts`

**Interfaces:**
- Consumes: `DecodedFrame` de `./frame-decoder`.
- Produces: `FrameBuffer.playbackTimeS: number | null`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `apps/web/src/simulation-runtime/frame-buffer.test.ts`, dentro del `describe` existente. Reutiliza `makeFrame(overrides: Partial<DecodedFrame>)`, que el fichero ya define en su línea 5:

```ts
describe("playbackTimeS", () => {
  it("es null antes del primer frame", () => {
    const buffer = new FrameBuffer();

    expect(buffer.playbackTimeS).toBeNull();
  });

  it("es el inicio del primer trozo mientras no se haya reproducido nada", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ tStartS: 4.2 }));

    expect(buffer.playbackTimeS).toBe(4.2);
  });

  it("no avanza antes del pre-roll", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ tStartS: 0 }));

    buffer.advance(0.05);

    expect(buffer.playbackTimeS).toBe(0);
  });

  it("avanza dentro del trozo de cabeza una vez hecho el pre-roll", () => {
    const buffer = new FrameBuffer();
    for (let i = 0; i < 6; i += 1) buffer.push(makeFrame({ tStartS: i * 0.1 }));

    buffer.advance(0.04);

    expect(buffer.playbackTimeS).toBeCloseTo(0.04, 5);
  });

  it("cruza la frontera entre trozos sin saltos", () => {
    const buffer = new FrameBuffer();
    for (let i = 0; i < 6; i += 1) buffer.push(makeFrame({ tStartS: i * 0.1 }));

    buffer.advance(0.25);

    expect(buffer.playbackTimeS).toBeCloseTo(0.25, 5);
  });

  it("se queda en el final de lo último reproducido durante un underrun", () => {
    const buffer = new FrameBuffer();
    for (let i = 0; i < 6; i += 1) buffer.push(makeFrame({ tStartS: i * 0.1 }));

    buffer.advance(10);

    expect(buffer.playbackTimeS).toBeCloseTo(0.6, 5);
  });

  it("es monótono creciente a lo largo de una reproducción normal", () => {
    const buffer = new FrameBuffer();
    for (let i = 0; i < 6; i += 1) buffer.push(makeFrame({ tStartS: i * 0.1 }));

    let previous = buffer.playbackTimeS!;
    for (let tick = 0; tick < 20; tick += 1) {
      buffer.advance(1 / 60);
      const current = buffer.playbackTimeS!;
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("vuelve a null tras clear()", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ tStartS: 1 }));

    buffer.clear();

    expect(buffer.playbackTimeS).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar los tests y comprobar que fallan**

```bash
cd apps/web && npx vitest run src/simulation-runtime/frame-buffer.test.ts
```

Esperado: FAIL — `playbackTimeS` es `undefined`, no `null` ni el número esperado.

- [ ] **Step 3: Implementar el getter**

En `apps/web/src/simulation-runtime/frame-buffer.ts`, añadir el campo junto a `justConsumed`:

```ts
  /** Final del último trozo consumido por completo. Es lo que mantiene la
   * cabeza de reproducción con un valor sensato durante un underrun, cuando
   * no queda ningún trozo del que leer `tStartS`. */
  private lastConsumedEndS: number | null = null;
```

Dentro de `advance()`, en el bucle que desaloja trozos, sustituir la línea del `shift`:

```ts
      const consumed = this.entries.shift()!;
      this.lastConsumedEndS = consumed.frame.tStartS + duration;
      this.justConsumed.push(consumed);
      remaining -= duration;
```

Añadir el getter, junto a `bufferedDurationS`:

```ts
  /** Cabeza de reproducción, en tiempo de simulación. `null` mientras no
   * haya llegado ningún frame.
   *
   * Es el reloj que comparten el trazado y el corazón 3D, y por eso no puede
   * ser `performance.now()`: este avanza solo cuando avanza la reproducción.
   * En pausa, en pre-roll y en underrun se queda quieto, y lo que dependa de
   * él se congela con el trazo en vez de seguir corriendo en el vacío.
   *
   * Con trozos en el buffer es el inicio del de cabeza más lo ya reproducido
   * de él (`pendingS`); sin trozos, el final del último consumido. */
  get playbackTimeS(): number | null {
    if (this.entries.length > 0) {
      return this.entries[0].frame.tStartS + this.pendingS;
    }
    return this.lastConsumedEndS;
  }
```

Y en `clear()`, añadir la línea:

```ts
    this.lastConsumedEndS = null;
```

- [ ] **Step 4: Ejecutar los tests**

```bash
cd apps/web && npx vitest run src/simulation-runtime/frame-buffer.test.ts
```

Esperado: PASS, incluidos los tests que ya existían.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/frame-buffer.ts apps/web/src/simulation-runtime/frame-buffer.test.ts
git commit -m "feat(runtime): cabeza de reproduccion expuesta por FrameBuffer"
```

---

### Task 6: Recepción del contrato nuevo

Espejo en TypeScript de lo que Task 4 publica, y dos eventos más en el `SessionRuntime`.

**Files:**
- Modify: `apps/web/src/types/ws-messages.ts`
- Modify: `apps/web/src/simulation-runtime/session-runtime.ts`
- Test: `apps/web/src/simulation-runtime/session-runtime.test.ts`

**Interfaces:**
- Consumes: el contrato JSON de Task 4.
- Produces: `MechanicalEventPayload`, `CardiacEventsMessage`, `HeartStateMessage`; eventos `cardiacEvents` y `heartState` en `SessionRuntimeEvents`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `apps/web/src/simulation-runtime/session-runtime.test.ts`, siguiendo el patrón que el fichero ya usa: `FakeWebSocket` (línea 5) construido a mano y `dispatch("message", { data })` para simular la llegada de un mensaje.

```ts
describe("mensajes de mecánica cardíaca", () => {
  it("emite cardiacEvents al recibir el mensaje", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onEvents = vi.fn();
    runtime.on("cardiacEvents", onEvents);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "cardiac_events",
        t_start_s: 1,
        t_end_s: 1.25,
        events: [
          {
            chamber: "ventricles",
            t_start_s: 1.05,
            t_peak_s: 1.19,
            t_end_s: 1.38,
            amplitude: 1,
            index: 3,
          },
        ],
      }),
    });

    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents.mock.calls[0][0].events[0].chamber).toBe("ventricles");
  });

  it("emite heartState al recibir el mensaje", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onState = vi.fn();
    runtime.on("heartState", onState);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "heart_state",
        values: {
          rhythm_id: "atrial_fibrillation",
          heart_rate_bpm: 88,
          atrial_mode: "fibrillating",
          ventricular_mode: "synchronous",
          atrial_amplitude: 0.06,
          ventricular_amplitude: 1,
          flutter_hz: 7,
        },
      }),
    });

    expect(onState.mock.calls[0][0].values.atrial_mode).toBe("fibrillating");
  });

  it("no altera el estado de la sesión", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();
    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "s",
        seed: 1,
        sample_rate_hz: 500,
        channels: 12,
      }),
    });

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "cardiac_events",
        t_start_s: 0,
        t_end_s: 1,
        events: [],
      }),
    });

    expect(runtime.state).toBe("running");
  });
});
```

- [ ] **Step 2: Ejecutar los tests y comprobar que fallan**

```bash
cd apps/web && npx vitest run src/simulation-runtime/session-runtime.test.ts
```

Esperado: FAIL de compilación de tipos — `CardiacEventsMessage` no existe.

- [ ] **Step 3: Añadir los tipos**

En `apps/web/src/types/ws-messages.ts`, antes de `ServerMessage`:

```ts
/** Espejo de `MechanicalEvent.as_payload()` en `heart-engine`.
 *
 * Se mantiene a mano, igual que la cabecera binaria de 40 bytes es espejo de
 * `frames.py`: es el patrón que este repositorio ya usa para los contratos
 * entre Python y TypeScript. Un cambio en el lado Python que no se refleje
 * aquí lo caza el test de contrato del runtime. */
export interface MechanicalEventPayload {
  chamber: "atria" | "ventricles";
  t_start_s: number;
  t_peak_s: number;
  t_end_s: number;
  amplitude: number;
  index: number;
}

export interface CardiacEventsMessage {
  type: "cardiac_events";
  t_start_s: number;
  t_end_s: number;
  events: MechanicalEventPayload[];
}

export type ContractionModeName =
  | "synchronous"
  | "fluttering"
  | "fibrillating"
  | "absent";

/** `values` es un mapa de campos conocidos y no `Record<string, unknown>`:
 * al contrario que `measurements`, aquí el cliente necesita cada campo con su
 * tipo para animar. Los campos hemodinámicos que llegarán después (volumen
 * sistólico, contractilidad) se añaden como opcionales cuando existan. */
export interface HeartStateMessage {
  type: "heart_state";
  values: {
    rhythm_id: string;
    heart_rate_bpm: number | null;
    atrial_mode: ContractionModeName;
    ventricular_mode: ContractionModeName;
    atrial_amplitude: number;
    ventricular_amplitude: number;
    flutter_hz: number;
  };
}
```

Y ampliar la unión:

```ts
export type ServerMessage =
  | StartedMessage
  | UpdatedMessage
  | PausedMessage
  | ResumedMessage
  | StoppedMessage
  | MeasurementsMessage
  | CardiacEventsMessage
  | HeartStateMessage
  | ErrorMessage;
```

- [ ] **Step 4: Emitirlos desde el `SessionRuntime`**

En `apps/web/src/simulation-runtime/session-runtime.ts`, añadir al import de tipos `CardiacEventsMessage` y `HeartStateMessage`, y a `SessionRuntimeEvents`:

```ts
  cardiacEvents: CardiacEventsMessage;
  heartState: HeartStateMessage;
```

Y dos casos al `switch` de `handleServerMessage`, junto al de `measurements`:

```ts
      case "cardiac_events":
        // No toca `state`, igual que las medidas: describen la mecánica, no
        // el ciclo de vida de la sesión.
        this.emit("cardiacEvents", message);
        break;
      case "heart_state":
        this.emit("heartState", message);
        break;
```

- [ ] **Step 5: Ejecutar los tests**

```bash
cd apps/web && npx vitest run src/simulation-runtime/
```

Esperado: PASS en toda la carpeta.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/types/ws-messages.ts apps/web/src/simulation-runtime/session-runtime.ts apps/web/src/simulation-runtime/session-runtime.test.ts
git commit -m "feat(runtime): recepcion de cardiac_events y heart_state"
```

---

### Task 7: `CardiacTimeline` — la fisiología del cliente

Una cola de contracciones que responde a una sola pregunta: *cuánto está contraída esta cámara en el instante t*. Sin React, sin Three.js, sin reloj propio. Es el componente más testeable del plan y el que sostiene toda la animación.

**Files:**
- Create: `apps/web/src/cardiac/contraction-curve.ts`
- Create: `apps/web/src/cardiac/tremor.ts`
- Create: `apps/web/src/cardiac/cardiac-timeline.ts`
- Test: `apps/web/src/cardiac/cardiac-timeline.test.ts`

**Interfaces:**
- Consumes: `MechanicalEventPayload` de `../types/ws-messages`.
- Produces: `contractionExcursion(event, tS): number`; `tremorExcursion(tS, hz, amplitude): number`; `CardiacTimeline` con `push(events)`, `excursionAt(chamber, tS)`, `prune(tS)`, `clear()`, `size`.

- [ ] **Step 1: Escribir el test que falla**

`apps/web/src/cardiac/cardiac-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CardiacTimeline } from "./cardiac-timeline";
import { contractionExcursion } from "./contraction-curve";
import { tremorExcursion } from "./tremor";
import type { MechanicalEventPayload } from "../types/ws-messages";

function beat(overrides: Partial<MechanicalEventPayload> = {}): MechanicalEventPayload {
  return {
    chamber: "ventricles",
    t_start_s: 1.0,
    t_peak_s: 1.15,
    t_end_s: 1.4,
    amplitude: 1,
    index: 0,
    ...overrides,
  };
}

describe("contractionExcursion", () => {
  it("es cero al empezar la contracción", () => {
    expect(contractionExcursion(beat(), 1.0)).toBeCloseTo(0, 5);
  });

  it("es la amplitud completa en el pico", () => {
    expect(contractionExcursion(beat(), 1.15)).toBeCloseTo(1, 5);
  });

  it("vuelve a cero al acabar la relajación", () => {
    expect(contractionExcursion(beat(), 1.4)).toBeCloseTo(0, 5);
  });

  it("escala con la amplitud del evento", () => {
    expect(contractionExcursion(beat({ amplitude: 0.5 }), 1.15)).toBeCloseTo(0.5, 5);
  });

  it("es cero fuera de la ventana", () => {
    expect(contractionExcursion(beat(), 0.5)).toBe(0);
    expect(contractionExcursion(beat(), 2.0)).toBe(0);
  });

  it("es continua: no da saltos entre muestras contiguas", () => {
    let previous = contractionExcursion(beat(), 1.0);
    for (let t = 1.0; t <= 1.4; t += 0.005) {
      const current = contractionExcursion(beat(), t);
      expect(Math.abs(current - previous)).toBeLessThan(0.1);
      previous = current;
    }
  });
});

describe("tremorExcursion", () => {
  it("es determinista: el mismo instante da el mismo valor", () => {
    expect(tremorExcursion(3.21, 7, 0.06)).toBe(tremorExcursion(3.21, 7, 0.06));
  });

  it("nunca supera la amplitud pedida", () => {
    for (let t = 0; t < 5; t += 0.01) {
      expect(Math.abs(tremorExcursion(t, 7, 0.06))).toBeLessThanOrEqual(0.06);
    }
  });

  it("no es constante: efectivamente tiembla", () => {
    const muestras = new Set<number>();
    for (let t = 0; t < 1; t += 0.02) {
      muestras.add(Math.round(tremorExcursion(t, 7, 0.06) * 1000));
    }
    expect(muestras.size).toBeGreaterThan(10);
  });
});

describe("CardiacTimeline", () => {
  it("sin eventos, la excursión es cero", () => {
    const timeline = new CardiacTimeline();

    expect(timeline.excursionAt("ventricles", 1.2)).toBe(0);
  });

  it("devuelve la excursión del evento vigente", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    expect(timeline.excursionAt("ventricles", 1.15)).toBeCloseTo(1, 5);
  });

  it("aísla las cámaras entre sí", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat({ chamber: "atria" })]);

    expect(timeline.excursionAt("ventricles", 1.15)).toBe(0);
    expect(timeline.excursionAt("atria", 1.15)).toBeCloseTo(1, 5);
  });

  it("deduplica por cámara e índice", () => {
    // Reenvío del mismo evento: puede pasar si un mensaje se repite.
    const timeline = new CardiacTimeline();
    timeline.push([beat({ index: 7 })]);
    timeline.push([beat({ index: 7 })]);

    expect(timeline.size).toBe(1);
  });

  it("no confunde el mismo índice en cámaras distintas", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat({ index: 7, chamber: "atria" })]);
    timeline.push([beat({ index: 7, chamber: "ventricles" })]);

    expect(timeline.size).toBe(2);
  });

  it("suma solapes en vez de quedarse con uno solo", () => {
    // Dos contracciones ventriculares solapadas no ocurren fisiológicamente,
    // pero si llegan, el resultado debe seguir acotado y sin discontinuidad.
    const timeline = new CardiacTimeline();
    timeline.push([
      beat({ index: 0 }),
      beat({ index: 1, t_start_s: 1.3, t_peak_s: 1.45, t_end_s: 1.7 }),
    ]);

    const valor = timeline.excursionAt("ventricles", 1.35);
    expect(valor).toBeGreaterThan(0);
    expect(valor).toBeLessThanOrEqual(1);
  });

  it("prune descarta lo ya pasado", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    timeline.prune(5.0);

    expect(timeline.size).toBe(0);
  });

  it("prune conserva lo que aún no ha terminado", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    timeline.prune(1.2);

    expect(timeline.size).toBe(1);
  });

  it("clear vacía la cola", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    timeline.clear();

    expect(timeline.size).toBe(0);
  });

  it("un evento futuro todavía no contrae nada", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat({ t_start_s: 10, t_peak_s: 10.15, t_end_s: 10.4 })]);

    expect(timeline.excursionAt("ventricles", 1.0)).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
cd apps/web && npx vitest run src/cardiac/
```

Esperado: FAIL — no existe el módulo `./cardiac-timeline`.

- [ ] **Step 3: Implementar la curva**

`apps/web/src/cardiac/contraction-curve.ts`:

```ts
import type { MechanicalEventPayload } from "../types/ws-messages";

/** Excursión de una contracción en el instante `tS`: 0 en reposo, `amplitude`
 * en el pico.
 *
 * La forma es un coseno alzado por tramos, no una interpolación lineal ni un
 * `smoothstep`: el coseno tiene derivada nula en los tres puntos de anclaje
 * (inicio, pico, final), así que la contracción arranca y se detiene sin
 * tirón. Con rampas lineales el ventrículo daría un golpe seco en el pico,
 * que es exactamente el aspecto de "animación de programador" que el spec
 * quiere evitar.
 *
 * La curva es presentación, no fisiología: cuándo y cuánto lo decide el
 * servidor (`MechanicalEvent`), y cómo transcurre entre esos puntos, este
 * fichero. Por eso vive en TypeScript y se evalúa 60 veces por segundo aquí,
 * sin viajar por la red. */
export function contractionExcursion(
  event: MechanicalEventPayload,
  tS: number
): number {
  if (tS <= event.t_start_s || tS >= event.t_end_s) {
    return 0;
  }

  if (tS <= event.t_peak_s) {
    const span = event.t_peak_s - event.t_start_s;
    if (span <= 0) return event.amplitude;
    const u = (tS - event.t_start_s) / span;
    return event.amplitude * 0.5 * (1 - Math.cos(Math.PI * u));
  }

  const span = event.t_end_s - event.t_peak_s;
  if (span <= 0) return 0;
  const v = (tS - event.t_peak_s) / span;
  return event.amplitude * 0.5 * (1 + Math.cos(Math.PI * v));
}
```

`apps/web/src/cardiac/tremor.ts`:

```ts
/** Temblor continuo de una cámara que fibrila o aletea.
 *
 * Suma de tres senoides en relación no armónica: el resultado no se repite en
 * una escala visible pero es determinista, y determinista importa porque el
 * reloj puede retroceder —al reiniciar una sesión— y un ruido con estado
 * daría un salto visible al hacerlo.
 *
 * No es un modelo de nada. Una fibrilación no se anima con eventos porque no
 * los tiene: lo que se ve es una masa que tiembla, y esto es lo que produce
 * ese aspecto sin fingir una fisiología que el motor no calcula. */
export function tremorExcursion(tS: number, hz: number, amplitude: number): number {
  const raw =
    Math.sin(2 * Math.PI * hz * tS) * 0.55 +
    Math.sin(2 * Math.PI * hz * 1.73 * tS + 1.1) * 0.3 +
    Math.sin(2 * Math.PI * hz * 2.41 * tS + 2.7) * 0.15;
  return raw * amplitude;
}
```

- [ ] **Step 4: Implementar la timeline**

`apps/web/src/cardiac/cardiac-timeline.ts`:

```ts
import { contractionExcursion } from "./contraction-curve";
import type { MechanicalEventPayload } from "../types/ws-messages";

export type ChamberName = MechanicalEventPayload["chamber"];

/** Cola de contracciones pendientes y en curso, consultable por instante.
 *
 * No tiene reloj: se le pregunta por un `tS` que siempre viene de
 * `FrameBuffer.playbackTimeS`. Esa es toda la sincronización que hay, y es
 * suficiente: si la reproducción se congela, las consultas se repiten con el
 * mismo `tS` y el corazón se queda donde estaba.
 *
 * Sin React ni Three.js a propósito: es la única parte de la animación con
 * lógica que merezca un test, y así lo tiene sin necesitar WebGL. */
export class CardiacTimeline {
  private events: MechanicalEventPayload[] = [];
  private readonly seen = new Set<string>();

  get size(): number {
    return this.events.length;
  }

  /** Añade contracciones, descartando las ya conocidas.
   *
   * La deduplicación es por cámara e índice y no por instante: el índice del
   * evento eléctrico es estable y el instante es un flotante redondeado, que
   * no es una clave con la que uno quiera comparar por igualdad. */
  push(incoming: readonly MechanicalEventPayload[]): void {
    for (const event of incoming) {
      const key = `${event.chamber}:${event.index}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.events.push(event);
    }
  }

  /** Excursión total de una cámara en `tS`, acotada a [0, 1].
   *
   * Se suman los eventos vigentes en vez de tomar el primero: dos
   * contracciones solapadas no son fisiológicas, pero si el catálogo
   * llegara a producirlas, quedarse con una daría un salto en el trazo del
   * movimiento. El acotado impide que la suma se dispare. */
  excursionAt(chamber: ChamberName, tS: number): number {
    let total = 0;
    for (const event of this.events) {
      if (event.chamber !== chamber) continue;
      if (tS <= event.t_start_s || tS >= event.t_end_s) continue;
      total += contractionExcursion(event, tS);
    }
    return Math.min(1, total);
  }

  /** Descarta lo que terminó antes de `tS`.
   *
   * Sin esto, una guardia de ocho horas a 72 lpm acumularía del orden de
   * 70.000 eventos que `excursionAt` recorrería sesenta veces por segundo. */
  prune(tS: number): void {
    this.events = this.events.filter((event) => event.t_end_s >= tS);
  }

  clear(): void {
    this.events = [];
    this.seen.clear();
  }
}
```

- [ ] **Step 5: Ejecutar los tests**

```bash
cd apps/web && npx vitest run src/cardiac/
```

Esperado: los 21 tests en PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/cardiac
git commit -m "feat(cardiac): timeline de contracciones y curvas de excursion"
```

---

### Task 8: El modelo anatómico

El único artefacto de esta entrega que no se escribe: se exporta. Va antes de la escena porque los nombres de malla son el contrato que la escena consume, y descubrir a mitad de la Task 9 que el modelo trae una sola malla fusionada obligaría a rehacerla.

**Files:**
- Create: `apps/web/public/models/heart.glb`
- Create: `apps/web/public/models/ATTRIBUTION.md`
- Create: `apps/web/src/ui/Cardiac3D/heart-nodes.ts`
- Test: `apps/web/src/ui/Cardiac3D/heart-nodes.test.ts`

**Interfaces:**
- Consumes: nada del código anterior.
- Produces: `HEART_NODE_NAMES`, `HeartNodeName`, `HeartNodes` (mapa de nombre a `Object3DLike`), `bindHeartNodes(root): HeartNodes`.

- [ ] **Step 1: Exportar el modelo desde Z-Anatomy**

En Blender, con el proyecto Z-Anatomy abierto:

1. Aislar las diez estructuras cardíacas y renombrar cada objeto **exactamente** así — el binding falla, a propósito y con un mensaje claro, si falta uno: `LeftAtrium`, `RightAtrium`, `LeftVentricle`, `RightVentricle`, `Septum`, `Aorta`, `PulmonaryArtery`, `PulmonaryVeins`, `SuperiorVenaCava`, `InferiorVenaCava`.
2. Emparentar los diez a un vacío llamado `Heart`, que será la raíz.
3. Aplicar todas las transformaciones (`Object > Apply > All Transforms`): un objeto con escala no unitaria hace que la animación por escala del animador se componga con esa escala previa y las cavidades se contraigan desigual.
4. Centrar el origen de cada objeto en su propio centro geométrico (`Object > Set Origin > Origin to Geometry`). Es lo que hace que escalar una cavidad la contraiga hacia dentro en vez de arrastrarla hacia el origen de la escena.
5. Decimar hasta quedar por debajo de 3M de triángulos en total (`Decimate` modifier, ratio a ojo, comprobando en las estadísticas del viewport).
6. Exportar: `File > Export > glTF 2.0 (.glb)`, formato **glTF Binary**, con `Include > Selected Objects`, `Transform > +Y Up` activado, `Data > Mesh > Apply Modifiers` activado, y compresión Draco desactivada (el loader la soporta pero añade una dependencia de descompresión que esta entrega no necesita).
7. Guardar en `apps/web/public/models/heart.glb`.

- [ ] **Step 2: Registrar la licencia**

Z-Anatomy deriva de BodyParts3D y se distribuye bajo Creative Commons Attribution-ShareAlike. **Verificar los términos exactos en el repositorio de Z-Anatomy antes de dar por cerrada la tarea**: la cláusula ShareAlike obliga a que el modelo derivado —el `heart.glb` exportado— se distribuya bajo la misma licencia, y la de atribución, a acreditar el origen de forma visible.

`apps/web/public/models/ATTRIBUTION.md`:

```markdown
# heart.glb

Modelo anatómico derivado de **Z-Anatomy** (https://www.z-anatomy.com/),
a su vez derivado de **BodyParts3D** (The Database Center for Life Science).

Licencia: Creative Commons Attribution-ShareAlike. Este fichero es una obra
derivada —selección de estructuras cardíacas, renombrado de mallas,
decimación y exportación a glTF 2.0— y se distribuye bajo la misma licencia.

La atribución debe aparecer también en la interfaz, no solo en este fichero:
un usuario que ve el modelo tiene que poder saber de dónde viene sin
inspeccionar el repositorio.
```

- [ ] **Step 3: Escribir el test que falla**

`apps/web/src/ui/Cardiac3D/heart-nodes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HEART_NODE_NAMES, bindHeartNodes } from "./heart-nodes";

/** Un árbol mínimo con la misma forma que expone Three.js. No se usa un
 * `Object3D` real: el binding solo recorre `name` e `children`, y traer
 * Three.js entero a un test de recorrido de árbol lo haría más lento sin
 * comprobar nada más. */
function node(name: string, children: unknown[] = []) {
  return { name, children, scale: { x: 1, y: 1, z: 1 } };
}

function fullHeart() {
  return node("Heart", HEART_NODE_NAMES.map((name) => node(name)));
}

describe("bindHeartNodes", () => {
  it("encuentra las diez estructuras", () => {
    const nodes = bindHeartNodes(fullHeart() as never);

    for (const name of HEART_NODE_NAMES) {
      expect(nodes[name]).toBeDefined();
    }
  });

  it("las busca en profundidad, no solo entre los hijos directos", () => {
    const anidado = node("Heart", [
      node("Chambers", HEART_NODE_NAMES.map((name) => node(name))),
    ]);

    const nodes = bindHeartNodes(anidado as never);

    expect(nodes.LeftVentricle).toBeDefined();
  });

  it("falla con un mensaje que nombra lo que falta", () => {
    const incompleto = node(
      "Heart",
      HEART_NODE_NAMES.filter((name) => name !== "Septum").map((name) => node(name))
    );

    expect(() => bindHeartNodes(incompleto as never)).toThrow(/Septum/);
  });

  it("enumera todo lo que falta, no solo lo primero", () => {
    const vacio = node("Heart", []);

    expect(() => bindHeartNodes(vacio as never)).toThrow(/LeftAtrium.*Aorta/s);
  });

  it("ignora mallas que no están en el contrato", () => {
    const conExtras = node("Heart", [
      ...HEART_NODE_NAMES.map((name) => node(name)),
      node("Pericardium"),
    ]);

    const nodes = bindHeartNodes(conExtras as never);

    expect(Object.keys(nodes)).toHaveLength(HEART_NODE_NAMES.length);
  });
});
```

- [ ] **Step 4: Ejecutar el test y comprobar que falla**

```bash
cd apps/web && npx vitest run src/ui/Cardiac3D/heart-nodes.test.ts
```

Esperado: FAIL — no existe `./heart-nodes`.

- [ ] **Step 5: Implementar el binding**

`apps/web/src/ui/Cardiac3D/heart-nodes.ts`:

```ts
/** Estructuras del modelo, por nombre. El contrato con Blender.
 *
 * Nunca por índice: el orden de los nodos de un GLB cambia al reexportar, y
 * el fallo sería silencioso —el ventrículo latiendo y la aorta encogiéndose—
 * en vez de un error. Aquí, si falta un nombre, la carga falla con un
 * mensaje que dice cuál. */
export const HEART_NODE_NAMES = [
  "LeftAtrium",
  "RightAtrium",
  "LeftVentricle",
  "RightVentricle",
  "Septum",
  "Aorta",
  "PulmonaryArtery",
  "PulmonaryVeins",
  "SuperiorVenaCava",
  "InferiorVenaCava",
] as const;

export type HeartNodeName = (typeof HEART_NODE_NAMES)[number];

/** Lo mínimo que el animador necesita de un `Object3D`. Tiparlo así en vez de
 * contra `THREE.Object3D` mantiene `HeartAnimator` y este módulo testeables
 * sin instanciar Three.js. */
export interface Object3DLike {
  name: string;
  children: Object3DLike[];
  scale: { x: number; y: number; z: number };
}

export type HeartNodes = Record<HeartNodeName, Object3DLike>;

export function bindHeartNodes(root: Object3DLike): HeartNodes {
  const wanted = new Set<string>(HEART_NODE_NAMES);
  const found: Partial<HeartNodes> = {};

  const visit = (node: Object3DLike): void => {
    if (wanted.has(node.name)) {
      found[node.name as HeartNodeName] = node;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);

  const missing = HEART_NODE_NAMES.filter((name) => found[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `El modelo no trae estas estructuras: ${missing.join(", ")}. ` +
        "Comprueba los nombres de objeto en Blender antes de exportar."
    );
  }

  return found as HeartNodes;
}
```

- [ ] **Step 6: Ejecutar los tests**

```bash
cd apps/web && npx vitest run src/ui/Cardiac3D/heart-nodes.test.ts
```

Esperado: los 5 tests en PASS.

- [ ] **Step 7: Verificar el modelo real**

```bash
cd apps/web && ls -la public/models/heart.glb
```

Esperado: el fichero existe. Si supera unos 25 MB, volver al paso 1 y decimar más: el spec pide carga en menos de 2 segundos.

- [ ] **Step 8: Commit**

```bash
git add apps/web/public/models apps/web/src/ui/Cardiac3D/heart-nodes.ts apps/web/src/ui/Cardiac3D/heart-nodes.test.ts
git commit -m "feat(cardiac3d): modelo anatomico y binding de nodos por nombre"
```

---

### Task 9: `HeartAnimator` — excursión a deformación

Traduce un número de 0 a 1 en la escala de cada nodo. Puro y sin Three.js: recibe objetos con `scale` y los muta.

**Files:**
- Create: `apps/web/src/ui/Cardiac3D/HeartAnimator.ts`
- Test: `apps/web/src/ui/Cardiac3D/HeartAnimator.test.ts`

**Interfaces:**
- Consumes: `HeartNodes`, `Object3DLike` de `./heart-nodes` (Task 8).
- Produces: `applyExcursion(nodes, { atria, ventricles })`.

- [ ] **Step 1: Escribir el test que falla**

`apps/web/src/ui/Cardiac3D/HeartAnimator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyExcursion } from "./HeartAnimator";
import { HEART_NODE_NAMES, type HeartNodes } from "./heart-nodes";

function nodes(): HeartNodes {
  const result = {} as HeartNodes;
  for (const name of HEART_NODE_NAMES) {
    result[name] = { name, children: [], scale: { x: 1, y: 1, z: 1 } };
  }
  return result;
}

describe("applyExcursion", () => {
  it("en reposo deja todo a escala unidad", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 0 });

    for (const name of HEART_NODE_NAMES) {
      expect(heart[name].scale.y).toBeCloseTo(1, 5);
    }
  });

  it("acorta el ventrículo en el eje largo al contraerse", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.LeftVentricle.scale.y).toBeLessThan(1);
  });

  it("engorda el ventrículo en el eje radial al contraerse", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.LeftVentricle.scale.x).toBeGreaterThan(1);
    expect(heart.LeftVentricle.scale.z).toBeGreaterThan(1);
  });

  it("la aurícula se deforma menos que el ventrículo", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 1, ventricles: 1 });

    const auricula = 1 - heart.LeftAtrium.scale.y;
    const ventriculo = 1 - heart.LeftVentricle.scale.y;
    expect(auricula).toBeLessThan(ventriculo);
  });

  it("la contracción auricular no mueve los ventrículos", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 1, ventricles: 0 });

    expect(heart.LeftVentricle.scale.y).toBeCloseTo(1, 5);
    expect(heart.RightVentricle.scale.y).toBeCloseTo(1, 5);
  });

  it("los grandes vasos apenas se mueven", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 1, ventricles: 1 });

    expect(Math.abs(1 - heart.Aorta.scale.y)).toBeLessThan(0.02);
  });

  it("el septo sigue a los ventrículos", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.Septum.scale.y).toBeLessThan(1);
  });

  it("es idempotente: aplicar dos veces el mismo valor no acumula", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });
    const primera = heart.LeftVentricle.scale.y;
    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.LeftVentricle.scale.y).toBeCloseTo(primera, 6);
  });

  it("acepta excursión negativa sin invertir la geometría", () => {
    // El temblor de una fibrilación oscila en torno a cero.
    const heart = nodes();

    applyExcursion(heart, { atria: -0.06, ventricles: 0 });

    expect(heart.LeftAtrium.scale.y).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
cd apps/web && npx vitest run src/ui/Cardiac3D/HeartAnimator.test.ts
```

Esperado: FAIL — no existe `./HeartAnimator`.

- [ ] **Step 3: Implementar el animador**

`apps/web/src/ui/Cardiac3D/HeartAnimator.ts`:

```ts
import { HEART_NODE_NAMES, type HeartNodeName, type HeartNodes } from "./heart-nodes";

export interface Excursions {
  atria: number;
  ventricles: number;
}

/** Cuánto se deforma cada estructura por unidad de excursión.
 *
 * `longitudinal` es negativo porque contraerse es acortarse; `radial` es
 * positivo porque el volumen que sale por el eje largo entra por el corto.
 * Los valores salen del spec (escala longitudinal 0,96 y radial 1,04 para el
 * ventrículo) y se atenúan para el resto: una aurícula se mueve bastante
 * menos que un ventrículo, y un gran vaso apenas pulsa.
 *
 * Es una tabla, no una cadena de condicionales, y por eso añadir una
 * estructura al modelo es añadir una fila. */
const DEFORMATION: Record<
  HeartNodeName,
  { driver: keyof Excursions; longitudinal: number; radial: number }
> = {
  LeftVentricle: { driver: "ventricles", longitudinal: -0.04, radial: 0.04 },
  RightVentricle: { driver: "ventricles", longitudinal: -0.04, radial: 0.04 },
  Septum: { driver: "ventricles", longitudinal: -0.03, radial: 0.02 },
  LeftAtrium: { driver: "atria", longitudinal: -0.02, radial: 0.02 },
  RightAtrium: { driver: "atria", longitudinal: -0.02, radial: 0.02 },
  Aorta: { driver: "ventricles", longitudinal: 0.004, radial: 0.008 },
  PulmonaryArtery: { driver: "ventricles", longitudinal: 0.004, radial: 0.008 },
  PulmonaryVeins: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  SuperiorVenaCava: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  InferiorVenaCava: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
};

/** Escala mínima admisible. Con excursiones acotadas a [-1, 1] y factores por
 * debajo de 0,05 no se alcanza nunca, pero una escala nula o negativa
 * invierte las normales de la malla y el modelo se vería del revés: más vale
 * que sea imposible por construcción. */
const MIN_SCALE = 0.5;

/** Escribe la deformación en los nodos. Muta a propósito: corre en cada
 * fotograma y asignar tres números es más barato que construir objetos.
 *
 * Idempotente: la escala se calcula siempre desde 1, nunca multiplicando la
 * anterior. Acumular sería una deriva lenta e invisible en una sesión corta y
 * un corazón encogido a la nada en una larga. */
export function applyExcursion(nodes: HeartNodes, excursions: Excursions): void {
  for (const name of HEART_NODE_NAMES) {
    const rule = DEFORMATION[name];
    const value = excursions[rule.driver];
    const node = nodes[name];
    node.scale.y = Math.max(MIN_SCALE, 1 + rule.longitudinal * value);
    const radial = Math.max(MIN_SCALE, 1 + rule.radial * value);
    node.scale.x = radial;
    node.scale.z = radial;
  }
}
```

- [ ] **Step 4: Ejecutar los tests**

```bash
cd apps/web && npx vitest run src/ui/Cardiac3D/
```

Esperado: los 14 tests en PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/Cardiac3D/HeartAnimator.ts apps/web/src/ui/Cardiac3D/HeartAnimator.test.ts
git commit -m "feat(cardiac3d): animador de cavidades por excursion"
```

---

### Task 10: Puente runtime → timeline

El hook que alimenta la `CardiacTimeline` desde los eventos del `SessionRuntime` y guarda el `HeartState` vigente. Sin Three.js: es React puro y se testea con `renderHook`.

**Files:**
- Create: `apps/web/src/ui/Cardiac3D/useCardiacTimeline.ts`
- Test: `apps/web/src/ui/Cardiac3D/useCardiacTimeline.test.ts`

**Interfaces:**
- Consumes: `SessionRuntime` (Task 6), `CardiacTimeline` (Task 7).
- Produces: `useCardiacTimeline(runtime) -> { timeline, heartState }`, donde `timeline` es una `MutableRefObject<CardiacTimeline>` y `heartState` el último `HeartStateMessage["values"]` o `null`.

- [ ] **Step 1: Escribir el test que falla**

`apps/web/src/ui/Cardiac3D/useCardiacTimeline.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCardiacTimeline } from "./useCardiacTimeline";
import { SessionRuntime } from "../../simulation-runtime/session-runtime";
import type {
  CardiacEventsMessage,
  HeartStateMessage,
} from "../../types/ws-messages";

function makeRuntime(): SessionRuntime {
  // No se conecta: los tests emiten a mano sobre el emisor, que es la
  // superficie que el hook consume.
  return new SessionRuntime("ws://localhost:0", () => ({}) as WebSocket);
}

const EVENTS: CardiacEventsMessage = {
  type: "cardiac_events",
  t_start_s: 1,
  t_end_s: 1.25,
  events: [
    {
      chamber: "ventricles",
      t_start_s: 1.0,
      t_peak_s: 1.15,
      t_end_s: 1.4,
      amplitude: 1,
      index: 0,
    },
  ],
};

const STATE: HeartStateMessage = {
  type: "heart_state",
  values: {
    rhythm_id: "sinus_normal",
    heart_rate_bpm: 72,
    atrial_mode: "synchronous",
    ventricular_mode: "synchronous",
    atrial_amplitude: 1,
    ventricular_amplitude: 1,
    flutter_hz: 5,
  },
};

describe("useCardiacTimeline", () => {
  it("empieza con la timeline vacía y sin estado", () => {
    const runtime = makeRuntime();

    const { result } = renderHook(() => useCardiacTimeline(runtime));

    expect(result.current.timeline.current.size).toBe(0);
    expect(result.current.heartState).toBeNull();
  });

  it("encola los eventos que llegan", () => {
    const runtime = makeRuntime();
    const { result } = renderHook(() => useCardiacTimeline(runtime));

    act(() => runtime.emit("cardiacEvents", EVENTS));

    expect(result.current.timeline.current.size).toBe(1);
  });

  it("guarda el último estado recibido", () => {
    const runtime = makeRuntime();
    const { result } = renderHook(() => useCardiacTimeline(runtime));

    act(() => runtime.emit("heartState", STATE));

    expect(result.current.heartState?.rhythm_id).toBe("sinus_normal");
  });

  it("vacía la timeline al arrancar una sesión nueva", () => {
    const runtime = makeRuntime();
    const { result } = renderHook(() => useCardiacTimeline(runtime));
    act(() => runtime.emit("cardiacEvents", EVENTS));

    act(() =>
      runtime.emit("started", {
        type: "started",
        session_id: "s",
        seed: 1,
        sample_rate_hz: 500,
        channels: 12,
      })
    );

    expect(result.current.timeline.current.size).toBe(0);
  });

  it("se desuscribe al desmontar", () => {
    const runtime = makeRuntime();
    const { result, unmount } = renderHook(() => useCardiacTimeline(runtime));
    const timeline = result.current.timeline.current;

    unmount();
    runtime.emit("cardiacEvents", EVENTS);

    expect(timeline.size).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
cd apps/web && npx vitest run src/ui/Cardiac3D/useCardiacTimeline.test.ts
```

Esperado: FAIL — no existe `./useCardiacTimeline`.

- [ ] **Step 3: Implementar el hook**

`apps/web/src/ui/Cardiac3D/useCardiacTimeline.ts`:

```ts
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { CardiacTimeline } from "../../cardiac/cardiac-timeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import type {
  CardiacEventsMessage,
  HeartStateMessage,
} from "../../types/ws-messages";

export type HeartStateValues = HeartStateMessage["values"];

export interface UseCardiacTimelineResult {
  /** En una ref y no en estado: la escribe el WebSocket y la lee el bucle de
   * dibujo sesenta veces por segundo. Guardarla en `useState` provocaría un
   * re-render de React por cada mensaje del servidor sin que cambie un solo
   * píxel del árbol, que es exactamente lo que la arquitectura de la fase C
   * excluye del camino caliente. */
  timeline: MutableRefObject<CardiacTimeline>;
  /** En estado sí: cambia cuatro veces por segundo como mucho, y hay
   * interfaz —modo de cada cámara— que depende de él. */
  heartState: HeartStateValues | null;
}

export function useCardiacTimeline(runtime: SessionRuntime): UseCardiacTimelineResult {
  const timeline = useRef(new CardiacTimeline());
  const [heartState, setHeartState] = useState<HeartStateValues | null>(null);

  useEffect(() => {
    const onEvents = (message: CardiacEventsMessage) => {
      timeline.current.push(message.events);
    };
    const onState = (message: HeartStateMessage) => setHeartState(message.values);
    // Un ritmo nuevo arranca en t=0: sin vaciar, las contracciones del ritmo
    // anterior seguirían en cola con instantes que el reloj nuevo va a
    // recorrer otra vez, y el corazón latiría al ritmo viejo un rato.
    const onStarted = () => {
      timeline.current.clear();
      setHeartState(null);
    };

    runtime.on("cardiacEvents", onEvents);
    runtime.on("heartState", onState);
    runtime.on("started", onStarted);
    return () => {
      runtime.off("cardiacEvents", onEvents);
      runtime.off("heartState", onState);
      runtime.off("started", onStarted);
    };
  }, [runtime]);

  return { timeline, heartState };
}
```

- [ ] **Step 4: Ejecutar los tests**

```bash
cd apps/web && npx vitest run src/ui/Cardiac3D/
```

Esperado: los 19 tests en PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/Cardiac3D/useCardiacTimeline.ts apps/web/src/ui/Cardiac3D/useCardiacTimeline.test.ts
git commit -m "feat(cardiac3d): puente entre el runtime y la timeline"
```

---

### Task 11: La escena

Aquí entra Three.js. Todo lo que se podía testear ya está testeado y fuera de este fichero: lo que queda es cableado.

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/ui/Cardiac3D/HeartCamera.ts`
- Create: `apps/web/src/ui/Cardiac3D/HeartModel.tsx`
- Create: `apps/web/src/ui/Cardiac3D/HeartScene.tsx`
- Create: `apps/web/src/ui/Cardiac3D/HeartScene.module.css`

**Interfaces:**
- Consumes: `bindHeartNodes` (Task 8), `applyExcursion` (Task 9), `useCardiacTimeline` (Task 10), `tremorExcursion` (Task 7), `FrameBuffer.playbackTimeS` (Task 5).
- Produces: `<HeartScene runtime={...} />`, `CAMERA_PRESETS`.

- [ ] **Step 1: Instalar las dependencias**

```bash
cd apps/web && npm install three@^0.171.0 @react-three/fiber@^8.17.10 @react-three/drei@^9.117.3 && npm install --save-dev @types/three@^0.171.0
```

`@react-three/fiber` v8 es la línea compatible con React 18; la v9 exige React 19. Verificar que `npm ls react` sigue mostrando una sola copia de React 18.

- [ ] **Step 2: Definir los presets de cámara**

`apps/web/src/ui/Cardiac3D/HeartCamera.ts`:

```ts
/** Vistas anatómicas estándar.
 *
 * El spec descarta la cámara libre: en una herramienta clínica, una vista sin
 * nombre no se puede comunicar ni reproducir. Se orbita desde un preset, y el
 * preset siempre se puede recuperar.
 *
 * Coordenadas en el sistema del modelo tras exportar con `+Y Up`: Y hacia la
 * cabeza, Z hacia el frente del paciente, X hacia su izquierda. */
export const CAMERA_PRESETS = {
  anterior: [0, 0, 1],
  posterior: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  superior: [0, 1, 0.001],
  inferior: [0, -1, 0.001],
} as const satisfies Record<string, readonly [number, number, number]>;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

export const DEFAULT_PRESET: CameraPreset = "anterior";

/** Distancia de la cámara al centro del modelo, en unidades de escena. */
export const CAMERA_DISTANCE = 0.32;

/** Las vistas superior e inferior llevan un Z mínimo a propósito: una cámara
 * exactamente sobre el eje Y mirando hacia abajo tiene su vector "arriba"
 * paralelo a su dirección de vista, y la matriz de orientación degenera —la
 * escena aparece rotada al azar o directamente en negro. */
export function presetPosition(
  preset: CameraPreset
): [number, number, number] {
  const [x, y, z] = CAMERA_PRESETS[preset];
  return [x * CAMERA_DISTANCE, y * CAMERA_DISTANCE, z * CAMERA_DISTANCE];
}
```

- [ ] **Step 3: Implementar el modelo**

`apps/web/src/ui/Cardiac3D/HeartModel.tsx`:

```tsx
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { applyExcursion } from "./HeartAnimator";
import { bindHeartNodes, type Object3DLike } from "./heart-nodes";
import type { CardiacTimeline } from "../../cardiac/cardiac-timeline";
import { tremorExcursion } from "../../cardiac/tremor";
import type { HeartStateValues } from "./useCardiacTimeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

export const HEART_MODEL_URL = "/models/heart.glb";

export interface HeartModelProps {
  runtime: SessionRuntime;
  timeline: React.MutableRefObject<CardiacTimeline>;
  heartState: HeartStateValues | null;
}

/** Cuánto se descarta de la cola por detrás de la cabeza de reproducción. Un
 * segundo cubre de sobra la contracción más larga en curso. */
const PRUNE_MARGIN_S = 1;

/** Cada cuántos fotogramas se poda. Filtrar un array en cada uno de los 60
 * ticks por segundo es trabajo tirado: la cola crece a unos dos eventos por
 * segundo. */
const PRUNE_EVERY_FRAMES = 120;

export function HeartModel({ runtime, timeline, heartState }: HeartModelProps) {
  const { scene } = useGLTF(HEART_MODEL_URL);
  const nodes = useMemo(
    () => bindHeartNodes(scene as unknown as Object3DLike),
    [scene]
  );
  const frameCount = useRef(0);

  useFrame(() => {
    // El reloj es la cabeza de reproducción del buffer, NUNCA el reloj de
    // rAF ni `Date.now()`. Es lo que hace que el corazón y el trazado vayan
    // sincronizados por construcción: en pausa, en pre-roll y en underrun
    // este valor se queda quieto, y el corazón se congela con el trazo.
    //
    // `advance()` no se llama aquí: la llama `useSweepRenderer`, una sola vez
    // por tick. Llamarla también aquí consumiría trozos que el ECG nunca
    // llegaría a dibujar.
    const tS = runtime.buffer.playbackTimeS;
    if (tS === null) return;

    frameCount.current += 1;
    if (frameCount.current % PRUNE_EVERY_FRAMES === 0) {
      timeline.current.prune(tS - PRUNE_MARGIN_S);
    }

    applyExcursion(nodes, {
      atria: excursionFor("atria", tS, timeline.current, heartState),
      ventricles: excursionFor("ventricles", tS, timeline.current, heartState),
    });
  });

  return <primitive object={scene} />;
}

/** Contracción organizada y temblor son excluyentes por cámara, y quien
 * decide cuál toca es el servidor: una cámara que fibrila no manda eventos,
 * así que consultar la timeline devolvería cero y el corazón se quedaría
 * quieto en una FV. Nótese que aquí no se pregunta por el ritmo, solo por el
 * modo — es lo que mantiene el cliente libre de casos especiales. */
function excursionFor(
  chamber: ChamberName,
  tS: number,
  timeline: CardiacTimeline,
  heartState: HeartStateValues | null
): number {
  // Sin estado todavía: lo único razonable es reproducir los eventos que
  // hayan llegado. El estado llega como muy tarde 250 ms después del primero.
  if (heartState === null) return timeline.excursionAt(chamber, tS);

  const mode =
    chamber === "atria" ? heartState.atrial_mode : heartState.ventricular_mode;
  const amplitude =
    chamber === "atria"
      ? heartState.atrial_amplitude
      : heartState.ventricular_amplitude;

  switch (mode) {
    case "synchronous":
      return timeline.excursionAt(chamber, tS);
    case "fluttering":
    case "fibrillating":
      return tremorExcursion(tS, heartState.flutter_hz, amplitude);
    case "absent":
      return 0;
  }
}

useGLTF.preload(HEART_MODEL_URL);
```

El import de `HeartModel.tsx` necesita `ChamberName`, que exporta `cardiac-timeline.ts`:

```tsx
import type { CardiacTimeline, ChamberName } from "../../cardiac/cardiac-timeline";
```

(sustituye la línea `import type { CardiacTimeline } from "../../cardiac/cardiac-timeline";`)

- [ ] **Step 4: Implementar la escena**

`apps/web/src/ui/Cardiac3D/HeartScene.module.css`:

```css
.scene {
  /* Fondo ligeramente distinto del panel: la escena es una pantalla dentro
     de la consola, igual que el area de ECG. */
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
  background: var(--panel-background);
  overflow: hidden;
}

.presets {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 1;
  display: flex;
  gap: var(--space-1);
}

.attribution {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-3);
  z-index: 1;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
}
```

`apps/web/src/ui/Cardiac3D/HeartScene.tsx`:

```tsx
import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { SegmentedControl } from "@ui-system";
import { CAMERA_PRESETS, DEFAULT_PRESET, presetPosition, type CameraPreset } from "./HeartCamera";
import { HeartModel } from "./HeartModel";
import { useCardiacTimeline } from "./useCardiacTimeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import styles from "./HeartScene.module.css";

const PRESET_LABELS: Record<CameraPreset, string> = {
  anterior: "Anterior",
  posterior: "Posterior",
  left: "Izq.",
  right: "Der.",
  superior: "Sup.",
  inferior: "Inf.",
};

const PRESET_OPTIONS = (Object.keys(CAMERA_PRESETS) as CameraPreset[]).map(
  (value) => ({ value, label: PRESET_LABELS[value] })
);

export interface HeartSceneProps {
  runtime: SessionRuntime;
}

export function HeartScene({ runtime }: HeartSceneProps) {
  const { timeline, heartState } = useCardiacTimeline(runtime);
  const [preset, setPreset] = useState<CameraPreset>(DEFAULT_PRESET);

  return (
    <section className={styles.scene} aria-label="Corazón 3D">
      <div className={styles.presets}>
        <SegmentedControl
          label="Vista"
          value={preset}
          options={PRESET_OPTIONS}
          onChange={setPreset}
        />
      </div>

      <Canvas
        // `key`: cambiar de preset reposiciona la cámara. Sin remontar, los
        // OrbitControls conservan su objetivo y la vista nueva sale torcida.
        key={preset}
        camera={{ position: presetPosition(preset), fov: 35, near: 0.01, far: 10 }}
        // `powerPreference: high-performance` pide la GPU dedicada en
        // portátiles con gráficos híbridos, donde la integrada no sostiene 60
        // fps con este número de triángulos.
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        {/* Tres luces suaves y un entorno, como pide el spec. Nada de luces
            duras: una sombra marcada sobre un modelo anatómico se lee como
            relieve que no existe. */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 3, 4]} intensity={1.1} />
        <directionalLight position={[-3, 1, -2]} intensity={0.5} />

        <Suspense fallback={null}>
          <Environment preset="studio" />
          <HeartModel runtime={runtime} timeline={timeline} heartState={heartState} />
        </Suspense>

        {/* Nunca autoRotate: el spec lo descarta, y con razón — un modelo que
            gira solo impide fijar la vista para comparar dos latidos. */}
        <OrbitControls
          enablePan
          enableZoom
          autoRotate={false}
          minDistance={0.12}
          maxDistance={1.2}
        />
      </Canvas>

      {/* La licencia del modelo es CC BY-SA: la atribución tiene que estar
          donde se ve el modelo, no solo en el repositorio. */}
      <p className={styles.attribution}>Modelo: Z-Anatomy (CC BY-SA)</p>
    </section>
  );
}
```

- [ ] **Step 5: Comprobar que compila y que la suite sigue verde**

```bash
cd apps/web && npx tsc -b --noEmit && npx vitest run
```

Esperado: sin errores de tipos, y toda la suite en PASS. Los componentes con `<Canvas>` no tienen test: jsdom no da contexto WebGL.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/ui/Cardiac3D
git commit -m "feat(cardiac3d): escena, camara y modelo animado"
```

---

### Task 12: Layout partido con divisor arrastrable

El corazón bajo el ECG, en la misma columna, con el divisor que pediste. No toca el `AppShell`: la partición ocurre dentro del área `ecg`, que ya está acotada en alto por el grid.

**Files:**
- Create: `packages/ui-system/components/layout/SplitPane.tsx`
- Create: `packages/ui-system/components/layout/SplitPane.module.css`
- Modify: `packages/ui-system/components/layout/index.ts`
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`
- Test: `packages/ui-system/components/layout/layout.test.tsx`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `<SplitPane top={...} bottom={...} defaultTopFraction={0.65} minTopFraction={0.3} maxTopFraction={0.85} label="..." />`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `packages/ui-system/components/layout/layout.test.tsx`:

```tsx
describe("SplitPane", () => {
  it("pinta las dos zonas", () => {
    render(<SplitPane top={<p>arriba</p>} bottom={<p>abajo</p>} label="ECG y corazón" />);

    expect(screen.getByText("arriba")).toBeInTheDocument();
    expect(screen.getByText("abajo")).toBeInTheDocument();
  });

  it("el divisor se anuncia como separador con nombre", () => {
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);

    const separator = screen.getByRole("separator", { name: "ECG y corazón" });
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("el divisor es alcanzable con el teclado", () => {
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);

    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");
  });

  it("la flecha abajo da más espacio al ECG", async () => {
    const user = userEvent.setup();
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);
    const separator = screen.getByRole("separator");
    const antes = Number(separator.getAttribute("aria-valuenow"));

    separator.focus();
    await user.keyboard("{ArrowDown}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(antes);
  });

  it("la flecha arriba da más espacio al corazón", async () => {
    const user = userEvent.setup();
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);
    const separator = screen.getByRole("separator");
    const antes = Number(separator.getAttribute("aria-valuenow"));

    separator.focus();
    await user.keyboard("{ArrowUp}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeLessThan(antes);
  });

  it("no baja del mínimo por mucho que se insista", async () => {
    const user = userEvent.setup();
    render(
      <SplitPane
        top={<p>a</p>}
        bottom={<p>b</p>}
        label="ECG y corazón"
        minTopFraction={0.3}
      />
    );
    const separator = screen.getByRole("separator");

    separator.focus();
    await user.keyboard("{ArrowUp>20/}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(30);
  });

  it("no sube del máximo", async () => {
    const user = userEvent.setup();
    render(
      <SplitPane
        top={<p>a</p>}
        bottom={<p>b</p>}
        label="ECG y corazón"
        maxTopFraction={0.85}
      />
    );
    const separator = screen.getByRole("separator");

    separator.focus();
    await user.keyboard("{ArrowDown>20/}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(85);
  });

  it("arranca en la fracción pedida", () => {
    render(
      <SplitPane
        top={<p>a</p>}
        bottom={<p>b</p>}
        label="ECG y corazón"
        defaultTopFraction={0.7}
      />
    );

    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "70");
  });
});
```

Añadir `SplitPane` al import de `@ui-system` que el fichero de test ya tiene.

- [ ] **Step 2: Ejecutar los tests y comprobar que fallan**

```bash
cd apps/web && npx vitest run ../../packages/ui-system/components/layout/layout.test.tsx
```

Esperado: FAIL — `SplitPane` no está exportado.

- [ ] **Step 3: Implementar el CSS**

`packages/ui-system/components/layout/SplitPane.module.css`:

```css
.split {
  display: flex;
  flex-direction: column;
  /* Sin `min-height: 0`, un hijo con contenido empuja el contenedor mas alla
     del alto que le da el grid y reaparece el scroll que el spec descarta.
     Es el mismo fallo clasico de Flexbox que ya documenta AppShell. */
  min-height: 0;
  height: 100%;
}

.pane {
  min-height: 0;
  overflow: hidden;
}

.divider {
  /* Alto visual pequeno, zona de agarre mayor: 4px es imposible de acertar
     con el raton y 12px de banda separaria demasiado las dos zonas. */
  flex: 0 0 auto;
  height: var(--space-3);
  position: relative;
  cursor: row-resize;
  background: transparent;
  border: none;
  padding: 0;
}

.divider::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  border-radius: 1px;
  background: var(--panel-border);
  transition: background var(--motion-fast) ease;
}

.divider:hover::after,
.divider:focus-visible::after {
  background: var(--text-muted);
}

.divider:focus-visible {
  outline: 2px solid var(--text-primary);
  outline-offset: -2px;
}

/* Mientras se arrastra, el puntero puede salirse del divisor: sin esto, el
   texto de las dos zonas se selecciona y el arrastre se siente roto. */
.dragging {
  user-select: none;
}
```

- [ ] **Step 4: Implementar el componente**

`packages/ui-system/components/layout/SplitPane.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./SplitPane.module.css";

export interface SplitPaneProps {
  top: ReactNode;
  bottom: ReactNode;
  /** Nombre del separador para lectores de pantalla. Sin él, el divisor se
   * anuncia como "separador" a secas y no hay forma de saber qué separa. */
  label: string;
  defaultTopFraction?: number;
  minTopFraction?: number;
  maxTopFraction?: number;
}

const KEYBOARD_STEP = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Dos zonas apiladas con un divisor arrastrable.
 *
 * Vive en el `ui-system` y no en la app porque no sabe nada de ECG ni de
 * corazones: reparte el alto de su contenedor entre dos hijos, y eso vale
 * igual para el día que haya que partir el inspector.
 *
 * El reparto es una fracción, no píxeles: al redimensionar la ventana, la
 * proporción se conserva sin necesidad de recalcular nada. */
export function SplitPane({
  top,
  bottom,
  label,
  defaultTopFraction = 0.65,
  minTopFraction = 0.3,
  maxTopFraction = 0.85,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(defaultTopFraction);
  const [isDragging, setIsDragging] = useState(false);

  const apply = useCallback(
    (next: number) => setFraction(clamp(next, minTopFraction, maxTopFraction)),
    [minTopFraction, maxTopFraction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height === 0) return;
      apply((event.clientY - rect.top) / rect.height);
    };
    const onUp = () => setIsDragging(false);

    // En `window` y no en el divisor: al arrastrar deprisa el puntero se sale
    // del elemento, y con los listeners colgados de él el arrastre se
    // interrumpiría a mitad.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, apply]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      apply(fraction - KEYBOARD_STEP);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      apply(fraction + KEYBOARD_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      apply(defaultTopFraction);
    }
  };

  const percent = Math.round(fraction * 100);

  return (
    <div
      ref={containerRef}
      className={`${styles.split} ${isDragging ? styles.dragging : ""}`}
    >
      <div className={styles.pane} style={{ flex: `${fraction} 1 0` }}>
        {top}
      </div>

      <div
        className={styles.divider}
        role="separator"
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuenow={percent}
        aria-valuemin={Math.round(minTopFraction * 100)}
        aria-valuemax={Math.round(maxTopFraction * 100)}
        tabIndex={0}
        onPointerDown={() => setIsDragging(true)}
        onKeyDown={onKeyDown}
      />

      <div className={styles.pane} style={{ flex: `${1 - fraction} 1 0` }}>
        {bottom}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Exportar el componente**

En `packages/ui-system/components/layout/index.ts`, añadir:

```ts
export { SplitPane } from "./SplitPane";
export type { SplitPaneProps } from "./SplitPane";
```

- [ ] **Step 6: Montar el corazón en el workspace**

En `apps/web/src/ui/ECGWorkspace.tsx`, añadir `SplitPane` al import de `@ui-system` y el de la escena:

```tsx
import { HeartScene } from "./Cardiac3D/HeartScene";
```

Y sustituir la prop `ecg` del `AppShell` (líneas 281-289) por:

```tsx
      ecg={
        <SplitPane
          label="Reparto entre ECG y corazón"
          defaultTopFraction={0.65}
          minTopFraction={0.3}
          maxTopFraction={0.85}
          top={
            <EcgDisplay
              containerRef={containerRef}
              leadColumns={leadColumns}
              metrics={metrics}
              registerTrace={registerTrace}
              registerGrid={registerGrid}
            />
          }
          bottom={<HeartScene runtime={runtime} />}
        />
      }
```

El `useLayoutMetrics` que alimenta `containerRef` mide el contenedor real, así que las tiras se recalculan solas al mover el divisor — sin cablear nada entre ambos componentes.

- [ ] **Step 7: Ejecutar toda la suite**

```bash
cd apps/web && npx vitest run
```

Esperado: PASS, incluidos `ECGWorkspace.test.tsx` y `accessibility-contract.test.tsx`. Si alguno de los dos falla por no encontrar el área de ECG, es porque busca un ancestro directo: adaptar el selector, no el `SplitPane`.

- [ ] **Step 8: Comprobación manual contra el backend real**

```bash
cd apps/api && python -m uvicorn ecg_api.main:app --reload
```

Y en otra terminal:

```bash
cd apps/web && npm run dev
```

Verificar, ritmo a ritmo:

| Ritmo | Qué tiene que verse |
|---|---|
| `sinus_normal` | Aurículas contrayéndose y, un instante después, ventrículos. Sincronía evidente. |
| `av_block_third` | Aurículas y ventrículos a ritmos distintos, sin relación entre sí. |
| `atrial_fibrillation` | Aurículas temblando sin contraerse; ventrículos latiendo irregular. |
| `atrial_flutter` | Aurículas vibrando rápido y regular; ventrículos normales. |
| `ventricular_fibrillation` | Todo temblando, sin una sola sístole. |

Y las dos comprobaciones de sincronía, que son las que justifican todo el plan:

1. Congelar con el botón de pausa: el corazón tiene que detenerse **en el mismo instante** que el trazo.
2. Cambiar la frecuencia con el stepper: el corazón tiene que acelerar o frenar con el trazado, sin desfase acumulado tras un par de minutos.

- [ ] **Step 9: Commit**

```bash
git add packages/ui-system/components/layout apps/web/src/ui/ECGWorkspace.tsx
git commit -m "feat(ui): corazon 3D bajo el ECG con divisor redimensionable"
```

---

## Cierre del plan

Al terminar la Task 12 existe un corazón anatómico latiendo bajo el ECG, gobernado por el mismo reloj, con la mecánica calculada en el servidor y la interpolación en el cliente. Las cinco costuras que la fase D necesitaba están abiertas y probadas:

- **`MechanicalProfile`** en el catálogo: un ritmo nuevo trae su mecánica como dato, sin tocar código.
- **`heart-engine`**: la fisiología mecánica tiene su paquete, aislado de la red y del render.
- **`playbackTimeS`**: el reloj compartido. Cualquier módulo futuro —constantes vitales, capnografía— se sincroniza leyendo esa propiedad.
- **`CardiacTimeline`**: cola de eventos consultable por instante, sin dependencias.
- **`SplitPane`**: el layout ya se reparte; añadir una tercera zona no es un rediseño.

**Lo que queda pendiente y dónde:**

| Pendiente | Entrega |
|---|---|
| Materiales PBR con clearcoat y aproximación de subsuperficie; postprocesado medido | 2 |
| Contractilidad regional y overlays de infarto con materiales dinámicos de perfusión | 2 |
| Pestañas en tablet y layout responsive completo | 2 |
| Conducción eléctrica visible (SA → AV → His → Purkinje) | 3 |
| Corte anatómico y capas conmutables | 3 |
| Hemodinámica: volumen sistólico, contractilidad, precarga, poscarga | Cuando exista el modelo |

**Antes de dar la entrega por cerrada:**

1. Medir de verdad los objetivos del spec — 60 fps, < 3M triángulos, < 250 MB de GPU, carga < 2 s — con el modelo real cargado y una sesión corriendo. El benchmark de Playwright de la fase C (`docs/superpowers/plans/2026-07-28-ecg-frontend.md`, Task 19) ya mide fps y memoria vía CDP: ampliarlo para que corra con la escena montada es la forma barata de tener esa cifra en CI y no de oídas.
2. Confirmar los términos exactos de la licencia de Z-Anatomy y que la atribución en pantalla los cumple.
3. Revisión clínica del movimiento, igual que se hizo con los doce trazados: que un ventrículo se contraiga a destiempo es un error que ningún test unitario va a cazar.
