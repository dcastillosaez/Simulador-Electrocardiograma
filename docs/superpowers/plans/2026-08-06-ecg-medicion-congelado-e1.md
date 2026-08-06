# Medición sobre el ECG congelado — Plan de implementación (fase E1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el trazado congelado en algo medible: índice de muestras, sesión de medición única, cursor sincronizado, calibrador con Δt/ΔV/lpm/cuadros, snap, zoom por velocidad de papel, lupa y exportación con marcas — todo en `apps/web`, sin tocar el motor ni la API.

**Architecture:** Dos piezas nuevas sostienen todo lo demás. **`SampleIndexRing`** es un anillo paralelo a los `SweepBuffer` con el número de muestra absoluto de cada posición: convierte la imagen en un sistema de coordenadas píxel ↔ muestra ↔ instante ↔ voltaje. **`MeasurementSession`** es un estado único, mutado por un reductor puro, que todas las herramientas comparten; una herramienta es un descriptor declarativo (`markerCount`, `defaultSnap`, `compute`), no una clase. Encima va un **único canvas de overlay** sobre toda la rejilla de tiras —no uno por derivación— donde se dibuja cursor, marcas y lupa. El congelado es del cliente y ocurre en el mismo frame que el clic.

**Tech Stack:** React 18 + TypeScript 5.6 + Zustand 4 (`apps/web`), Vitest 3 + jsdom + Testing Library, Canvas 2D. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-08-06-ecg-medicion-congelado-design.md`

## Global Constraints

- **La coordenada canónica es la muestra, no el segundo.** Δt se calcula restando `sampleIndex` enteros, nunca timestamps. El tiempo se deriva con `sampleIndex / sampleRateHz`.
- **Unidades SI en los módulos de cálculo** (voltios, segundos). La conversión a mV y ms ocurre en los formateadores, en un solo sitio (`measure/formulas.ts`), que consumen tanto el canvas como el DOM para que muestren cadenas idénticas.
- **Regresión cero en `computeLayoutMetrics` a 25 mm/s.** Ninguna aserción numérica de `layout-engine.test.ts` puede cambiar de valor. Solo cambia cómo se define la constante local del fichero de test.
- **`hover` nunca entra en el estado de React.** Vive en una `ref`. React solo recibe cambios de `tool`, `snapMode`, `markers` y `result`.
- **Nada nuevo en el camino caliente del barrido.** El overlay tiene su propio `requestAnimationFrame`.
- **Sin componentes nuevos en `packages/ui-system`.** `SegmentedControl`, `IconButton`, `Metric`, `MetricGrid`, `Badge` y `Tooltip` cubren toda la interfaz.
- **Comentarios y textos de interfaz en español, con acentos correctos.** Identificadores en inglés, como el resto del repositorio.
- **Todos los comandos se ejecutan desde `Simulador_Electrocardiograma/apps/web`.**
- **Los mensajes de commit no llevan coautoría ni menciones a herramientas.**

---

### Task 1: `SampleIndexRing` — el índice de muestras

**Files:**
- Create: `apps/web/src/render/sample-index.ts`
- Test: `apps/web/src/render/sample-index.test.ts`

**Interfaces:**
- Produces: `SamplePoint { sampleIndex: number; timestampS: number }`; `class SampleIndexRing` con `capacity`, `writeCursor`, `writtenCount`, `push(indices: Float64Array): void`, `at(ringPos: number): number`, `findRingPos(sampleIndex: number): number | null`, `reset(): void`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/render/sample-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SampleIndexRing } from "./sample-index";

describe("SampleIndexRing", () => {
  it("empieza vacio, con el cursor en 0", () => {
    const ring = new SampleIndexRing(8);
    expect(ring.capacity).toBe(8);
    expect(ring.writeCursor).toBe(0);
    expect(ring.writtenCount).toBe(0);
  });

  it("guarda el indice absoluto de cada posicion y avanza el cursor", () => {
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([100, 101, 102]));

    expect(ring.writeCursor).toBe(3);
    expect(ring.writtenCount).toBe(3);
    expect(ring.at(0)).toBe(100);
    expect(ring.at(2)).toBe(102);
  });

  it("el cursor envuelve y sobrescribe lo mas antiguo", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([0, 1, 2, 3]));
    ring.push(new Float64Array([4, 5]));

    expect(ring.writeCursor).toBe(2);
    expect(ring.at(0)).toBe(4);
    expect(ring.at(2)).toBe(2);
  });

  it("at() envuelve indices fuera de rango, tambien negativos", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([10, 11, 12, 13]));

    expect(ring.at(4)).toBe(10);
    expect(ring.at(-1)).toBe(13);
  });

  it("findRingPos localiza el mas viejo, el mas nuevo y uno intermedio", () => {
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([50, 51, 52, 53, 54]));

    expect(ring.findRingPos(50)).toBe(0);
    expect(ring.findRingPos(52)).toBe(2);
    expect(ring.findRingPos(54)).toBe(4);
  });

  it("findRingPos funciona con el anillo envuelto", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([0, 1, 2, 3]));
    ring.push(new Float64Array([4, 5]));
    // Contenido fisico: [4, 5, 2, 3]; el mas viejo es el 2, en la posicion 2.
    expect(ring.findRingPos(2)).toBe(2);
    expect(ring.findRingPos(5)).toBe(1);
    expect(ring.findRingPos(0)).toBeNull(); // sobrescrito
  });

  it("findRingPos devuelve null para un indice perdido en un hueco", () => {
    // Los huecos de red hacen que los indices salten: las posiciones del anillo
    // siguen siendo contiguas, los indices absolutos no.
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([10, 11, 12]));
    ring.push(new Float64Array([40, 41]));

    expect(ring.findRingPos(12)).toBe(2);
    expect(ring.findRingPos(40)).toBe(3);
    expect(ring.findRingPos(25)).toBeNull();
  });

  it("findRingPos devuelve null con el anillo vacio", () => {
    expect(new SampleIndexRing(4).findRingPos(0)).toBeNull();
  });

  it("reset vacia el anillo", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([1, 2]));
    ring.reset();

    expect(ring.writeCursor).toBe(0);
    expect(ring.writtenCount).toBe(0);
    expect(ring.findRingPos(1)).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
npx vitest run src/render/sample-index.test.ts
```

Esperado: FAIL — `Failed to resolve import "./sample-index"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/web/src/render/sample-index.ts`:

```ts
/** Una muestra identificada. `timestampS` es derivado, no almacenado: guardar
 * los dos serían dos sitios donde el mismo hecho puede desincronizarse. */
export interface SamplePoint {
  /** Absoluto desde el inicio de la sesión. */
  sampleIndex: number;
  timestampS: number;
}

/** Anillo paralelo a los `SweepBuffer` con el índice absoluto de cada posición.
 *
 * La coordenada canónica del renderer es la muestra, no el segundo: el anillo,
 * el trazo y la banda de borrado ya trabajan así. Poner el segundo en el centro
 * obligaría a redondear en cada conversión y a arrastrar error de coma flotante
 * hasta el píxel.
 *
 * **Uno solo, no doce.** Las doce derivaciones se escriben en el mismo tick
 * desde el mismo trozo multicanal: comparten índice por construcción.
 *
 * `Float64Array` y no `Int32Array`: a 500 Hz un entero de 32 bits desborda a
 * los 49 días de sesión, y `Float64` representa enteros exactos hasta 2^53. */
export class SampleIndexRing {
  readonly capacity: number;

  private readonly indices: Float64Array;
  private cursor = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.indices = new Float64Array(this.capacity);
  }

  get writeCursor(): number {
    return this.cursor;
  }

  get writtenCount(): number {
    return this.count;
  }

  push(indices: Float64Array): void {
    if (indices.length === 0) {
      return;
    }
    for (let i = 0; i < indices.length; i++) {
      this.indices[this.cursor] = indices[i];
      this.cursor = this.cursor + 1 === this.capacity ? 0 : this.cursor + 1;
    }
    this.count = Math.min(this.capacity, this.count + indices.length);
  }

  at(ringPos: number): number {
    return this.indices[this.wrap(ringPos)];
  }

  /** Posición del anillo que contiene esa muestra, o `null` si ya se
   * sobrescribió o se perdió en un hueco.
   *
   * Es la dirección lenta —búsqueda binaria— y la que menos se usa: la
   * consumirá F2 para colocar una anotación, una vez por latido. La dirección
   * del camino caliente, `at()`, es una lectura directa.
   *
   * El anillo está ordenado de forma ascendente en orden LÓGICO (del más viejo
   * al más nuevo), no físico: la búsqueda va sobre `k`, la distancia desde el
   * más viejo, y se traduce a posición física al leer. */
  findRingPos(sampleIndex: number): number | null {
    if (this.count === 0) {
      return null;
    }
    let lo = 0;
    let hi = this.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const value = this.indices[this.ringPosForK(mid)];
      if (value === sampleIndex) return this.ringPosForK(mid);
      if (value < sampleIndex) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  reset(): void {
    this.indices.fill(0);
    this.cursor = 0;
    this.count = 0;
  }

  /** Posición física de la k-ésima muestra contando desde la más antigua. */
  private ringPosForK(k: number): number {
    return this.wrap(this.cursor - this.count + k);
  }

  private wrap(index: number): number {
    return ((index % this.capacity) + this.capacity) % this.capacity;
  }
}
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

```bash
npx vitest run src/render/sample-index.test.ts
```

Esperado: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/sample-index.ts src/render/sample-index.test.ts
git commit -m "feat(web): anillo de indices de muestra para la capa de medicion"
```

---

### Task 2: `FrameBuffer.consumedSampleIndices()`

**Files:**
- Modify: `apps/web/src/simulation-runtime/frame-buffer.ts`
- Test: `apps/web/src/simulation-runtime/frame-buffer.test.ts`

**Interfaces:**
- Produces: `FrameBuffer.consumedSampleIndices(): Float64Array`, misma longitud y orden que `consumeNewSamples(leadIndex)`.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `apps/web/src/simulation-runtime/frame-buffer.test.ts`, dentro del `describe("FrameBuffer", ...)` existente (reutiliza el `makeFrame` que ya hay en el fichero):

```ts
  it("consumedSampleIndices numera las muestras desde el inicio de la sesion", () => {
    // Invariante del backend: el motor genera de forma contigua desde t=0 en
    // trozos de tamano fijo, asi que tStartS * sampleRateHz es exactamente el
    // indice de la primera muestra del trozo.
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ tStartS: 0 }));
    buffer.push(makeFrame({ tStartS: 0.1, sequenceNumber: 1 }));
    buffer.push(makeFrame({ tStartS: 0.2, sequenceNumber: 2 }));
    buffer.push(makeFrame({ tStartS: 0.3, sequenceNumber: 3 }));
    buffer.push(makeFrame({ tStartS: 0.4, sequenceNumber: 4 }));
    buffer.push(makeFrame({ tStartS: 0.5, sequenceNumber: 5 }));
    buffer.advance(0.2);

    const indices = buffer.consumedSampleIndices();

    expect(indices.length).toBe(100);
    expect(indices[0]).toBe(0);
    expect(indices[49]).toBe(49);
    expect(indices[50]).toBe(50);
    expect(indices[99]).toBe(99);
  });

  it("consumedSampleIndices tiene la misma longitud que consumeNewSamples", () => {
    const buffer = new FrameBuffer();
    for (let i = 0; i < 6; i++) {
      buffer.push(makeFrame({ tStartS: i * 0.1, sequenceNumber: i }));
    }
    buffer.advance(0.3);

    expect(buffer.consumedSampleIndices().length).toBe(
      buffer.consumeNewSamples(0).length
    );
  });

  it("los indices saltan cuando hay un hueco, en vez de seguir contando", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ tStartS: 0 }));
    buffer.push(makeFrame({ tStartS: 0.1, sequenceNumber: 1 }));
    buffer.push(makeFrame({ tStartS: 0.2, sequenceNumber: 2 }));
    buffer.push(makeFrame({ tStartS: 0.3, sequenceNumber: 3 }));
    buffer.push(makeFrame({ tStartS: 0.4, sequenceNumber: 4 }));
    // Se pierden los frames de 0.5 y 0.6: el siguiente empieza en 0.7.
    buffer.push(makeFrame({ tStartS: 0.7, sequenceNumber: 7 }), { gapBefore: true });
    buffer.advance(0.6);

    const indices = buffer.consumedSampleIndices();

    expect(indices[249]).toBe(249);
    expect(indices[250]).toBe(350);
  });

  it("consumedSampleIndices esta vacio si advance no libero nada", () => {
    const buffer = new FrameBuffer();
    expect(buffer.consumedSampleIndices().length).toBe(0);
  });
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

```bash
npx vitest run src/simulation-runtime/frame-buffer.test.ts
```

Esperado: FAIL — `buffer.consumedSampleIndices is not a function`.

- [ ] **Step 3: Escribir la implementación**

En `apps/web/src/simulation-runtime/frame-buffer.ts`, junto a `NO_SAMPLES`:

```ts
/** Igual que `NO_SAMPLES`, para la lista de índices. */
const NO_INDICES = new Float64Array(0);
```

Y después de `consumeNewSamples`:

```ts
  /** Índices absolutos de las muestras desalojadas por el último `advance()`,
   * en el mismo orden y con la misma longitud que `consumeNewSamples()`.
   *
   * Se apoya en un invariante del backend: el motor genera de forma contigua
   * desde `t = 0` en trozos de tamaño fijo (`simulation.py:117`), así que
   * `tStartS * sampleRateHz` es exactamente el índice de la primera muestra
   * del trozo. Con un hueco de red los índices SALTAN, que es justo lo que
   * ocurrió: seguir contando fingiría una continuidad que no existe.
   *
   * Se lee una vez por tick, no una por derivación: las doce comparten eje. */
  consumedSampleIndices(): Float64Array {
    if (this.justConsumed.length === 0) {
      return NO_INDICES;
    }
    const totalSamples = this.justConsumed.reduce(
      (sum, entry) => sum + entry.frame.nSamplesPerChannel,
      0
    );
    const result = new Float64Array(totalSamples);
    let offset = 0;
    for (const entry of this.justConsumed) {
      const frame = entry.frame;
      const base = Math.round(frame.tStartS * frame.sampleRateHz);
      for (let i = 0; i < frame.nSamplesPerChannel; i++) {
        result[offset + i] = base + i;
      }
      offset += frame.nSamplesPerChannel;
    }
    return result;
  }
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

```bash
npx vitest run src/simulation-runtime/frame-buffer.test.ts
```

Esperado: PASS, todos los tests del fichero.

- [ ] **Step 5: Commit**

```bash
git add src/simulation-runtime/frame-buffer.ts src/simulation-runtime/frame-buffer.test.ts
git commit -m "feat(web): el buffer de frames publica los indices de muestra consumidos"
```

---

### Task 3: La velocidad de papel gobierna los segundos visibles

**Files:**
- Modify: `apps/web/src/render/layout-engine.ts:47-53` (constante) y `:166-180` (derivación)
- Test: `apps/web/src/render/layout-engine.test.ts:1-19` (import y constante local) y añadir un `describe` nuevo

**Interfaces:**
- Consumes: nada.
- Produces: `VIEWPORT_WIDTH_MM = 250`, `REFERENCE_PAPER_SPEED_MM_S = 25`. Desaparece `SCREEN_SECONDS`. `LayoutMetrics.stripSeconds` pasa a derivarse de `paperSpeedMmS`.

- [ ] **Step 1: Adaptar el fichero de test sin cambiar ni una aserción**

En `apps/web/src/render/layout-engine.test.ts`, sustituir la línea 6 del bloque de import (`SCREEN_SECONDS,`) por `VIEWPORT_WIDTH_MM,` y sustituir las líneas 16-19 por:

```ts
const SPEED = 25;
/** Los mismos diez segundos de antes, ahora derivados: la constante del
 * sistema es el ancho de papel y los segundos salen de dividirlo por la
 * velocidad. Ninguna asercion numerica de este fichero cambia de valor. */
const SCREEN_SECONDS = VIEWPORT_WIDTH_MM / SPEED;
/** Ancho que hace que un milimetro mida PX_PER_MM, para que los tests puedan
 * seguir razonando en la escala fisica de referencia. */
const WIDTH = SCREEN_SECONDS * SPEED * PX_PER_MM;
```

- [ ] **Step 2: Escribir los tests nuevos del zoom**

Añadir al final de `apps/web/src/render/layout-engine.test.ts`:

```ts
describe("velocidad de papel", () => {
  it("a 25mm/s la tira muestra los diez segundos de siempre", () => {
    const metrics = metricsFor(600, 6, "auto");
    expect(metrics.stripSeconds).toBe(10);
  });

  it("al doblar la velocidad se ve la mitad de tiempo", () => {
    const metrics = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 50,
    });
    expect(metrics.stripSeconds).toBe(5);
  });

  it("a 100mm/s se ven 2,5 segundos", () => {
    const metrics = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 100,
    });
    expect(metrics.stripSeconds).toBe(2.5);
  });

  it("el cuadro pequeno conserva su tamano fisico al cambiar la velocidad", () => {
    // Es la diferencia entre velocidad de papel y zoom optico, y la razon de
    // ser de todo el diseno: contar cuadros tiene que seguir siendo exacto.
    const lenta = metricsFor(600, 6, "auto");
    const rapida = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 100,
    });
    expect(rapida.viewportScalePxPerMm).toBeCloseTo(lenta.viewportScalePxPerMm);
    expect(rapida.pixelsPerMillivolt).toBeCloseTo(lenta.pixelsPerMillivolt);
  });

  it("al cuadruplicar la velocidad, un segundo ocupa cuatro veces mas pixeles", () => {
    const lenta = metricsFor(600, 6, "auto");
    const rapida = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 100,
    });
    expect(rapida.pixelsPerSecond).toBeCloseTo(lenta.pixelsPerSecond * 4);
  });
});
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

```bash
npx vitest run src/render/layout-engine.test.ts
```

Esperado: FAIL — `VIEWPORT_WIDTH_MM` no existe en `./layout-engine`.

- [ ] **Step 4: Escribir la implementación**

En `apps/web/src/render/layout-engine.ts`, sustituir el bloque de `SCREEN_SECONDS` (líneas 47-53) por:

```ts
/** Velocidad de papel de referencia: la estándar de un electrocardiógrafo.
 *
 * Es la que fija la escala de la pantalla. El zoom temporal la sube a 50 o 100
 * sin que la rejilla cambie de tamaño: lo que cambia es cuánto tiempo cabe. */
export const REFERENCE_PAPER_SPEED_MM_S = 25;

/** Ancho de papel que muestra la pantalla completa, en milímetros.
 *
 * Antes esta constante eran diez segundos. Que fueran segundos era un
 * accidente: en un electrocardiógrafo la constante es el papel y los segundos
 * salen de dividirlo por la velocidad. 250 mm son exactamente los mismos diez
 * segundos a 25 mm/s, dichos en las unidades correctas — y así el zoom
 * temporal es una división más, no un caso especial.
 *
 * Fijarlo —en vez de dejar que dependa del ancho de la ventana— hace que dos
 * personas con monitores distintos vean lo mismo. */
export const VIEWPORT_WIDTH_MM = 250;
```

Y sustituir las líneas 166-180 (desde `const stripSeconds = ...` hasta `const viewportScalePxPerMm = ...`) por:

```ts
  // El ancho de papel por tira es la constante; los segundos son consecuencia
  // de la velocidad. A la velocidad de referencia esto da exactamente lo mismo
  // que la formulación anterior en segundos fijos: regresión cero.
  const viewportWidthMm = VIEWPORT_WIDTH_MM / columns;

  // LA ESCALA SALE DEL ANCHO, no de una suposición de 96dpi, y **no depende de
  // la velocidad de papel**: subirla no agranda la rejilla, muestra menos
  // tiempo. Lo importante —y lo que arregló el defecto de la cuadrícula— es
  // que esta misma escala gobierne los DOS ejes: mientras eso se cumpla, la
  // celda es cuadrada, un segundo son cinco cuadros grandes y medir contando
  // cuadros es exacto, valga lo que valga el milímetro en píxeles.
  //
  // Como el ancho de columna y el ancho de papel se dividen los dos entre el
  // número de columnas, la escala es la MISMA en una columna que en dos: el
  // formato partido no comprime el trazado, solo enseña menos tiempo.
  const viewportScalePxPerMm = stripWidthPx / viewportWidthMm;
  const stripSeconds = viewportWidthMm / paperSpeedMmS;
```

- [ ] **Step 5: Ejecutar los tests y comprobar que pasan**

```bash
npx vitest run src/render/layout-engine.test.ts
```

Esperado: PASS. **Ninguna aserción numérica preexistente ha cambiado de valor**; si alguna falla, la refactorización está mal, no el test.

- [ ] **Step 6: Ejecutar la suite entera**

```bash
npm test
```

Esperado: PASS. `SCREEN_SECONDS` no se importaba en ningún otro sitio (verificado con `grep`), así que no debe haber roturas.

- [ ] **Step 7: Commit**

```bash
git add src/render/layout-engine.ts src/render/layout-engine.test.ts
git commit -m "refactor(web): el ancho de papel sustituye a los segundos fijos de pantalla"
```

---

### Task 4: Geometría de medida

**Files:**
- Create: `apps/web/src/render/measure-geometry.ts`
- Test: `apps/web/src/render/measure-geometry.test.ts`

**Interfaces:**
- Consumes: `LayoutMetrics`, `COLUMN_GAP_PX`, `STRIP_GAP_PX` de `./layout-engine`; `LeadName` de `./layout`.
- Produces: `TraceView { startRingPos, visibleSamples }`; `StripHit { lead, column, row, xInStrip, yInStrip }`; `pxPerSample(metrics, sampleRateHz)`, `ringPosToPx(ringPos, view, pxPerSample, capacity)`, `pxToRingPos(xPx, view, pxPerSample, capacity)`, `pxToVoltage(yInStrip, stripHeightPx, metrics)`, `fullView(capacity)`, `hitTest(xPx, yPx, layout)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/render/measure-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeLayoutMetrics } from "./layout-engine";
import { voltageToPx, PX_PER_MM } from "./grid-layer";
import {
  fullView,
  hitTest,
  pxPerSample,
  pxToRingPos,
  pxToVoltage,
  ringPosToPx,
} from "./measure-geometry";

const SAMPLE_RATE_HZ = 500;
const WIDTH = 10 * 25 * PX_PER_MM;

function metricsFor(columnCount: number, paperSpeedMmS = 25) {
  return computeLayoutMetrics({
    availableWidthPx: WIDTH,
    availableHeightPx: 600,
    rowCount: 6,
    columnCount,
    gain: 10,
    paperSpeedMmS,
  });
}

describe("conversiones de tiempo", () => {
  it("la posicion 0 del anillo cae en x = 0 con la vista completa", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    expect(ringPosToPx(0, fullView(5000), pps, 5000)).toBe(0);
  });

  it("pixel y muestra son inversos entre si", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    const view = fullView(5000);
    for (const ringPos of [0, 1, 137, 2500, 4999]) {
      const x = ringPosToPx(ringPos, view, pps, 5000);
      expect(pxToRingPos(x, view, pps, 5000)).toBe(ringPos);
    }
  });

  it("con una vista desplazada, el inicio de la ventana cae en x = 0", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    const view = { startRingPos: 1000, visibleSamples: 1250 };
    expect(ringPosToPx(1000, view, pps, 5000)).toBe(0);
    expect(pxToRingPos(0, view, pps, 5000)).toBe(1000);
  });

  it("una vista desplazada envuelve por el final del anillo", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    const view = { startRingPos: 4900, visibleSamples: 200 };
    expect(pxToRingPos(200 * pps, view, pps, 5000)).toBe(100);
  });
});

describe("conversiones de voltaje", () => {
  it("la linea media de la tira son cero milivoltios", () => {
    const metrics = metricsFor(1);
    expect(pxToVoltage(metrics.stripHeightPx / 2, metrics.stripHeightPx, metrics)).toBe(0);
  });

  it("es la inversa exacta de voltageToPx", () => {
    const metrics = metricsFor(1);
    const height = metrics.stripHeightPx;
    for (const mv of [-1.5, -0.2, 0, 0.84, 1.21]) {
      const volts = mv / 1000;
      const y = height / 2 - voltageToPx(volts, metrics);
      expect(pxToVoltage(y, height, metrics) * 1000).toBeCloseTo(mv, 9);
    }
  });

  it("arriba es positivo", () => {
    const metrics = metricsFor(1);
    expect(pxToVoltage(0, metrics.stripHeightPx, metrics)).toBeGreaterThan(0);
  });
});

describe("hitTest", () => {
  const leadColumns = [
    ["I", "II", "III"],
    ["aVR", "aVL", "aVF"],
  ] as const;

  it("localiza derivacion, columna y fila", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    const hit = hitTest(5, metrics.stripHeightPx + 4 + 3, layout);

    expect(hit).not.toBeNull();
    expect(hit!.lead).toBe("II");
    expect(hit!.column).toBe(0);
    expect(hit!.row).toBe(1);
    expect(hit!.xInStrip).toBeCloseTo(5);
    expect(hit!.yInStrip).toBeCloseTo(3);
  });

  it("la segunda columna empieza tras el hueco", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    const hit = hitTest(metrics.stripWidthPx + 8 + 2, 1, layout);

    expect(hit!.lead).toBe("aVR");
    expect(hit!.column).toBe(1);
    expect(hit!.xInStrip).toBeCloseTo(2);
  });

  it("devuelve null dentro del hueco entre columnas", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    expect(hitTest(metrics.stripWidthPx + 2, 1, layout)).toBeNull();
  });

  it("devuelve null dentro del hueco entre tiras", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    expect(hitTest(5, metrics.stripHeightPx + 1, layout)).toBeNull();
  });

  it("devuelve null fuera del area", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    expect(hitTest(-1, 1, layout)).toBeNull();
    expect(hitTest(5, 100000, layout)).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/render/measure-geometry.test.ts
```

Esperado: FAIL — `Failed to resolve import "./measure-geometry"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/web/src/render/measure-geometry.ts`:

```ts
import { COLUMN_GAP_PX, STRIP_GAP_PX, type LayoutMetrics } from "./layout-engine";
import type { LeadName } from "./layout";

/** Qué trozo del anillo se está viendo.
 *
 * Con el zoom a la velocidad de referencia la ventana es el anillo entero. Al
 * subir la velocidad de papel el anillo no cambia de tamaño: se enseña menos.
 * Por eso la ventana es una vista y no una recaptura. */
export interface TraceView {
  /** Posición del anillo que se dibuja en x = 0. */
  startRingPos: number;
  /** Muestras que caben a lo ancho de la tira. */
  visibleSamples: number;
}

export interface StripLayout {
  leadColumns: readonly (readonly LeadName[])[];
  metrics: LayoutMetrics;
}

export interface StripHit {
  lead: LeadName;
  column: number;
  row: number;
  /** Coordenadas relativas a la esquina de la tira, no al display. */
  xInStrip: number;
  yInStrip: number;
}

export function fullView(capacity: number): TraceView {
  return { startRingPos: 0, visibleSamples: capacity };
}

/** Píxeles que ocupa una muestra. Se calcula una vez y se pasa: derivarlo en
 * cada conversión es cómo se acaban teniendo dos escalas en la misma pantalla. */
export function pxPerSample(metrics: LayoutMetrics, sampleRateHz: number): number {
  return metrics.pixelsPerSecond / sampleRateHz;
}

export function ringPosToPx(
  ringPos: number,
  view: TraceView,
  pxPerSampleValue: number,
  capacity: number
): number {
  return wrap(ringPos - view.startRingPos, capacity) * pxPerSampleValue;
}

/** Muestra más cercana a esa columna de píxeles.
 *
 * Es un redondeo con consecuencias: a la escala de referencia cada píxel
 * contiene unas seis muestras, así que la pantalla no puede distinguirlas y
 * hay que elegir una. Se elige la del centro del píxel. */
export function pxToRingPos(
  xPx: number,
  view: TraceView,
  pxPerSampleValue: number,
  capacity: number
): number {
  return wrap(view.startRingPos + Math.round(xPx / pxPerSampleValue), capacity);
}

/** Voltios en esa altura de la tira, respecto a la línea de 0 mV.
 *
 * En voltios y no en milivoltios: los módulos de cálculo trabajan en SI, como
 * el motor, y la conversión ocurre en un solo sitio, al formatear. */
export function pxToVoltage(
  yInStrip: number,
  stripHeightPx: number,
  metrics: LayoutMetrics
): number {
  return (stripHeightPx / 2 - yInStrip) / metrics.pixelsPerMillivolt / 1000;
}

/** Qué tira hay bajo ese punto del canvas de overlay, o `null` si es un hueco.
 *
 * Los huecos devuelven `null` a propósito: colocar una marca en la separación
 * entre dos derivaciones no significa nada, y asignarla a la de al lado sería
 * medir en una derivación distinta de la que el usuario está mirando. */
export function hitTest(
  xPx: number,
  yPx: number,
  layout: StripLayout
): StripHit | null {
  const { stripWidthPx, stripHeightPx } = layout.metrics;

  const columnPitch = stripWidthPx + COLUMN_GAP_PX;
  const column = Math.floor(xPx / columnPitch);
  const xInStrip = xPx - column * columnPitch;
  if (column < 0 || column >= layout.leadColumns.length) return null;
  if (xInStrip < 0 || xInStrip >= stripWidthPx) return null;

  const rowPitch = stripHeightPx + STRIP_GAP_PX;
  const row = Math.floor(yPx / rowPitch);
  const yInStrip = yPx - row * rowPitch;
  const leads = layout.leadColumns[column];
  if (row < 0 || row >= leads.length) return null;
  if (yInStrip < 0 || yInStrip >= stripHeightPx) return null;

  return { lead: leads[row], column, row, xInStrip, yInStrip };
}

function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/render/measure-geometry.test.ts
```

Esperado: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/measure-geometry.ts src/render/measure-geometry.test.ts
git commit -m "feat(web): conversiones pixel-muestra-voltaje y localizacion de tira"
```

---

### Task 5: Repintado por ventana

**Files:**
- Modify: `apps/web/src/render/sweep-rebuilder.ts:19-86`
- Test: `apps/web/src/render/sweep-rebuilder.test.ts`

**Interfaces:**
- Consumes: `TraceView`, `fullView` de `./measure-geometry`.
- Produces: `SweepRebuilder.rebuild(ctx, sweep, sampleRateHz, options, heightPx, view?)`. Sin `view` se comporta exactamente como hasta ahora.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `apps/web/src/render/sweep-rebuilder.test.ts`:

```ts
describe("repintado por ventana", () => {
  it("sin ventana pinta lo mismo que con la ventana completa", () => {
    // Es la garantia de regresion: el camino existente es un caso particular
    // del nuevo, no una rama distinta.
    const sweep = new SweepBuffer(64);
    const samples = new Float32Array(64);
    for (let i = 0; i < 64; i++) samples[i] = Math.sin(i / 4) / 1000;
    sweep.push(samples);

    const sinVentana = makeCtx();
    const conVentana = makeCtx();
    new SweepRebuilder().rebuild(sinVentana, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);
    new SweepRebuilder().rebuild(conVentana, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX, {
      startRingPos: 0,
      visibleSamples: 64,
    });

    expect((conVentana.lineTo as ReturnType<typeof vi.fn>).mock.calls).toEqual(
      (sinVentana.lineTo as ReturnType<typeof vi.fn>).mock.calls
    );
  });

  it("una ventana de la mitad pinta la mitad de puntos", () => {
    const sweep = new SweepBuffer(64);
    sweep.push(new Float32Array(64));

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX, {
      startRingPos: 0,
      visibleSamples: 32,
    });

    const puntos =
      (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls.length +
      (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(puntos).toBe(32);
  });

  it("una ventana desplazada empieza a dibujar en x = 0", () => {
    const sweep = new SweepBuffer(64);
    sweep.push(new Float32Array(64));

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX, {
      startRingPos: 32,
      visibleSamples: 16,
    });

    const primerPunto = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(primerPunto[0]).toBe(0);
  });
});
```

Añadir `vi` al import de vitest de ese fichero si no está, y `SweepBuffer` / `SweepRebuilder` ya lo están.

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/render/sweep-rebuilder.test.ts
```

Esperado: FAIL — la ventana se ignora y los tres tests nuevos no cuadran.

- [ ] **Step 3: Escribir la implementación**

Sustituir el cuerpo de `rebuild` en `apps/web/src/render/sweep-rebuilder.ts` por:

```ts
  rebuild(
    ctx: CanvasRenderingContext2D,
    sweep: SweepBuffer,
    sampleRateHz: number,
    options: LeadCanvasOptions,
    heightPx: number,
    view?: TraceView
  ): void {
    const pxPerSampleValue = options.metrics.pixelsPerSecond / sampleRateHz;
    const capacity = sweep.capacity;
    const window = view ?? fullView(capacity);
    const sweepWidthPx = window.visibleSamples * pxPerSampleValue;
    const baselineY = heightPx / 2;

    ctx.clearRect(0, 0, sweepWidthPx, heightPx);
    if (!sweep.hasSamples) {
      return;
    }

    const isFull = sweep.writtenCount >= capacity;
    const cursor = sweep.writeCursor;

    ctx.strokeStyle = options.theme.trace;
    ctx.lineWidth = 1;
    ctx.beginPath();

    let penDown = false;
    for (let k = 0; k < window.visibleSamples; k++) {
      const ringIndex = (window.startRingPos + k) % capacity;
      // Antes de dar la vuelta, solo [0, cursor) tiene señal escrita: el resto
      // son los ceros de relleno del Float32Array, y pintarlos sería una línea
      // plana en la parte de la tira que nunca se ha usado.
      if (!isFull && ringIndex >= cursor) {
        break;
      }

      const x = k * pxPerSampleValue;
      const y = baselineY - voltageToPx(sweep.at(ringIndex), options.metrics);

      // Se levanta el lápiz en tres sitios, y ninguno es negociable:
      //   - k = 0, el borde izquierdo de la ventana;
      //   - una discontinuidad marcada en el anillo (pérdida de frame o
      //     descarte por overrun), que no se interpola jamás;
      //   - la frontera del cursor con el anillo lleno, donde lo anterior es
      //     lo más nuevo y esta posición lo más viejo.
      const lift =
        k === 0 ||
        sweep.isDiscontinuityAt(ringIndex) ||
        (isFull && ringIndex === cursor);

      if (penDown && !lift) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        penDown = true;
      }
    }

    ctx.stroke();

    // El hueco de barrido por delante del cursor forma parte de la imagen: sin
    // reproducirlo, tras un redimensionado el trazo aparecería cerrado en
    // círculo y se perdería la referencia de dónde está escribiendo.
    eraseBandAhead(
      ctx,
      ((cursor - window.startRingPos + capacity) % capacity) * pxPerSampleValue,
      ERASE_BAND_MM * options.metrics.viewportScalePxPerMm,
      sweepWidthPx,
      heightPx
    );
  }
```

Y añadir el import al principio del fichero:

```ts
import { fullView, type TraceView } from "./measure-geometry";
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/render/sweep-rebuilder.test.ts
```

Esperado: PASS, incluidos todos los tests preexistentes del fichero sin modificar.

- [ ] **Step 5: Commit**

```bash
git add src/render/sweep-rebuilder.ts src/render/sweep-rebuilder.test.ts
git commit -m "feat(web): el repintado completo acepta una ventana del anillo"
```

---

### Task 6: Aritmética y formato de las medidas

**Files:**
- Create: `apps/web/src/measure/formulas.ts`
- Test: `apps/web/src/measure/formulas.test.ts`

**Interfaces:**
- Produces: `MeasureContext { sampleRateHz, paperSpeedMmS, clinicalGainMmPerMv }`; `CaliperReadout { deltaMs, deltaMv, equivalentBpm, smallSquares, largeSquares, amplitudeSquares }`; `caliperReadout(aSampleIndex, aVoltageV, bSampleIndex, bVoltageV, ctx): CaliperReadout`; formateadores `formatMs`, `formatMv`, `formatBpm`, `formatSquares`, `formatSeconds`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/measure/formulas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  caliperReadout,
  formatBpm,
  formatMs,
  formatMv,
  formatSeconds,
  formatSquares,
} from "./formulas";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

describe("caliperReadout", () => {
  it("reproduce el ejemplo de la especificacion", () => {
    // 82 muestras a 500Hz son 164ms. A 25mm/s eso son 4,1mm de papel.
    const r = caliperReadout(1000, 0, 1082, 1.21 / 1000, CTX);

    expect(r.deltaMs).toBeCloseTo(164, 9);
    expect(r.deltaMv).toBeCloseTo(1.21, 9);
    expect(r.equivalentBpm).toBeCloseTo(365.8537, 4);
    expect(r.smallSquares).toBeCloseTo(4.1, 9);
    expect(r.largeSquares).toBeCloseTo(0.82, 9);
  });

  it("reproduce el ejemplo de RR", () => {
    const r = caliperReadout(0, 0, 430, 0, CTX);
    expect(r.deltaMs).toBeCloseTo(860, 9);
    expect(r.equivalentBpm).toBeCloseTo(69.7674, 4);
  });

  it("Delta t es siempre positivo, sea cual sea el orden de las marcas", () => {
    const ida = caliperReadout(1082, 0, 1000, 0, CTX);
    expect(ida.deltaMs).toBeCloseTo(164, 9);
  });

  it("Delta V conserva el signo", () => {
    const r = caliperReadout(0, 0.5 / 1000, 10, -0.3 / 1000, CTX);
    expect(r.deltaMv).toBeCloseTo(-0.8, 9);
  });

  it("la altura en cuadros usa la ganancia y es una magnitud", () => {
    const r = caliperReadout(0, 0, 10, -1.5 / 1000, CTX);
    expect(r.amplitudeSquares).toBeCloseTo(15, 9);
  });

  it("al doblar la velocidad de papel el mismo intervalo ocupa el doble de cuadros", () => {
    const rapido = caliperReadout(1000, 0, 1082, 0, { ...CTX, paperSpeedMmS: 50 });
    expect(rapido.deltaMs).toBeCloseTo(164, 9);
    expect(rapido.smallSquares).toBeCloseTo(8.2, 9);
  });

  it("dos marcas en la misma muestra no producen una frecuencia infinita", () => {
    const r = caliperReadout(1000, 0, 1000, 0, CTX);
    expect(r.deltaMs).toBe(0);
    expect(r.equivalentBpm).toBeNull();
  });
});

describe("formateadores", () => {
  it("dan las cadenas del ejemplo de la especificacion", () => {
    expect(formatMs(164)).toBe("164 ms");
    expect(formatMv(1.21)).toBe("+1.21 mV");
    expect(formatMv(-0.8)).toBe("-0.80 mV");
    expect(formatBpm(365.853)).toBe("366 lpm");
    expect(formatBpm(69.767)).toBe("69.8 lpm");
    expect(formatBpm(null)).toBe("—");
    expect(formatSquares(4.1)).toBe("4.1");
    expect(formatSquares(0.82)).toBe("0.82");
    expect(formatSeconds(2.314)).toBe("2.314 s");
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/measure/formulas.test.ts
```

Esperado: FAIL — `Failed to resolve import "./formulas"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/web/src/measure/formulas.ts`:

```ts
/** Lo que hace falta saber de la pantalla para traducir una distancia a
 * unidades clínicas. La velocidad de papel es la VIGENTE, no la de referencia:
 * con el zoom a 50 mm/s el mismo intervalo ocupa el doble de cuadros, y decir
 * lo contrario sería mentir sobre lo que se está viendo. */
export interface MeasureContext {
  sampleRateHz: number;
  paperSpeedMmS: number;
  clinicalGainMmPerMv: number;
}

export interface CaliperReadout {
  deltaMs: number;
  /** Con signo: una depresión del ST no es lo mismo que una elevación. */
  deltaMv: number;
  /** `null` cuando las dos marcas caen en la misma muestra. Dividir entre cero
   * daría Infinity, que se pintaría como un número y no lo es. */
  equivalentBpm: number | null;
  smallSquares: number;
  largeSquares: number;
  /** Altura en cuadros pequeños. Magnitud, sin signo: es una altura. */
  amplitudeSquares: number;
}

/** Distancia entre dos marcas, en las unidades en que se lee un ECG.
 *
 * Δt se calcula restando ÍNDICES DE MUESTRA, no timestamps: es aritmética
 * entera y el resultado es exacto. Restar dos flotantes de segundos arrastraría
 * el error de la conversión hasta el número que se enseña. */
export function caliperReadout(
  aSampleIndex: number,
  aVoltageV: number,
  bSampleIndex: number,
  bVoltageV: number,
  ctx: MeasureContext
): CaliperReadout {
  const deltaSamples = Math.abs(bSampleIndex - aSampleIndex);
  const deltaS = deltaSamples / ctx.sampleRateHz;
  const deltaMv = (bVoltageV - aVoltageV) * 1000;
  const smallSquares = deltaS * ctx.paperSpeedMmS;

  return {
    deltaMs: deltaS * 1000,
    deltaMv,
    equivalentBpm: deltaS === 0 ? null : 60 / deltaS,
    smallSquares,
    largeSquares: smallSquares / 5,
    amplitudeSquares: Math.abs(deltaMv) * ctx.clinicalGainMmPerMv,
  };
}

/** Los formateadores viven aquí y no en cada consumidor porque hay dos: el
 * rótulo que se dibuja en el canvas y el panel del inspector que lee el lector
 * de pantalla. Si divergen, la interfaz y la accesibilidad dicen cosas
 * distintas sobre la misma medida. */
const NO_VALUE = "—";

export function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

export function formatMv(mv: number): string {
  const sign = mv < 0 ? "-" : "+";
  return `${sign}${Math.abs(mv).toFixed(2)} mV`;
}

export function formatBpm(bpm: number | null): string {
  if (bpm === null) return NO_VALUE;
  // Un decimal por debajo de 100, entero por encima: a 366 lpm la décima es
  // ruido, a 69,8 distingue dos ritmos.
  return bpm >= 100 ? `${Math.round(bpm)} lpm` : `${bpm.toFixed(1)} lpm`;
}

export function formatSquares(squares: number): string {
  return squares.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(3)} s`;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/measure/formulas.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/measure/formulas.ts src/measure/formulas.test.ts
git commit -m "feat(web): aritmetica y formato de las medidas sobre el trazado"
```

---

### Task 7: Snap

**Files:**
- Create: `apps/web/src/measure/snap.ts`
- Test: `apps/web/src/measure/snap.test.ts`

**Interfaces:**
- Consumes: `SweepBuffer`, `TraceView`, `LayoutMetrics`.
- Produces: `SnapMode = "signal" | "grid" | "rpeak"`; `SnapInput { rawRingPos, rawVoltageV }`; `SnapContext { sweep, sampleRateHz, metrics, view, capacity }`; `SnapResult { ringPos, voltageV, snapped }`; `snap(input, mode, ctx): SnapResult`; constantes `RPEAK_WINDOW_S = 0.15`, `RPEAK_MIN_MV = 0.25`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/measure/snap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SweepBuffer } from "../render/sweep-buffer";
import { computeLayoutMetrics } from "../render/layout-engine";
import { PX_PER_MM } from "../render/grid-layer";
import { snap } from "./snap";

const SAMPLE_RATE_HZ = 500;
const CAPACITY = 1000;

const METRICS = computeLayoutMetrics({
  availableWidthPx: 10 * 25 * PX_PER_MM,
  availableHeightPx: 600,
  rowCount: 6,
  columnCount: 1,
  gain: 10,
  paperSpeedMmS: 25,
});

/** Una linea plana con una R de `peakMv` en la muestra `peakAt`. */
function sweepWithPeak(peakAt: number, peakMv: number): SweepBuffer {
  const sweep = new SweepBuffer(CAPACITY);
  const samples = new Float32Array(CAPACITY);
  samples[peakAt] = peakMv / 1000;
  sweep.push(samples);
  return sweep;
}

function ctxFor(sweep: SweepBuffer) {
  return {
    sweep,
    sampleRateHz: SAMPLE_RATE_HZ,
    metrics: METRICS,
    view: { startRingPos: 0, visibleSamples: CAPACITY },
    capacity: CAPACITY,
  };
}

describe("modo señal", () => {
  it("el voltaje sale del trazo, no de donde esta el puntero", () => {
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 500, rawVoltageV: -0.9 / 1000 }, "signal", ctxFor(sweep));

    expect(r.ringPos).toBe(500);
    expect(r.voltageV * 1000).toBeCloseTo(1.2, 6);
    expect(r.snapped).toBe(true);
  });
});

describe("modo rejilla", () => {
  it("la marca cae en un multiplo exacto de milimetro", () => {
    // A 500Hz y 25mm/s, un milimetro son 20 muestras.
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 507, rawVoltageV: 0 }, "grid", ctxFor(sweep));
    expect(r.ringPos).toBe(500);
  });

  it("redondea hacia arriba cuando toca", () => {
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 513, rawVoltageV: 0 }, "grid", ctxFor(sweep));
    expect(r.ringPos).toBe(520);
  });

  it("el voltaje tambien cae en la rejilla", () => {
    // Con ganancia 10mm/mV, un milimetro son 0,1mV.
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 500, rawVoltageV: 0.83 / 1000 }, "grid", ctxFor(sweep));
    expect(r.voltageV * 1000).toBeCloseTo(0.8, 6);
  });
});

describe("modo pico R", () => {
  it("engancha en la R cuando el cursor cae cerca", () => {
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 530, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(500);
    expect(r.snapped).toBe(true);
  });

  it("engancha en una R negativa: manda el valor absoluto", () => {
    // En aVR la deflexion principal es negativa y sigue siendo la R del latido.
    const sweep = sweepWithPeak(500, -1.4);
    const r = snap({ rawRingPos: 520, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(500);
    expect(r.snapped).toBe(true);
  });

  it("NO engancha si nada supera el umbral: cae al modo señal y lo declara", () => {
    const sweep = sweepWithPeak(500, 0.1);
    const r = snap({ rawRingPos: 520, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(520);
    expect(r.snapped).toBe(false);
  });

  it("NO engancha si la R esta fuera de la ventana de busqueda", () => {
    // 150ms a 500Hz son 75 muestras: la R en 500 queda fuera desde la 600.
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 600, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(600);
    expect(r.snapped).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/measure/snap.test.ts
```

Esperado: FAIL — `Failed to resolve import "./snap"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/web/src/measure/snap.ts`:

```ts
import type { LayoutMetrics } from "../render/layout-engine";
import type { TraceView } from "../render/measure-geometry";
import type { SweepBuffer } from "../render/sweep-buffer";

export type SnapMode = "signal" | "grid" | "rpeak";

/** Media ventana de búsqueda del pico R, en segundos. 150 ms a cada lado cubre
 * el QRS más ancho sin llegar a la T del latido anterior. */
export const RPEAK_WINDOW_S = 0.15;

/** Amplitud mínima para considerar que hay una R. Por debajo no se engancha:
 * es preferible no enganchar a enganchar en un artefacto. */
export const RPEAK_MIN_MV = 0.25;

export interface SnapInput {
  rawRingPos: number;
  rawVoltageV: number;
}

export interface SnapContext {
  sweep: SweepBuffer;
  sampleRateHz: number;
  metrics: LayoutMetrics;
  view: TraceView;
  capacity: number;
}

export interface SnapResult {
  ringPos: number;
  voltageV: number;
  /** `false` cuando el modo pedía enganchar y no había dónde. La interfaz lo
   * muestra: un snap que falla en silencio hace creer que se midió una R
   * cuando se midió un punto cualquiera. */
  snapped: boolean;
}

/** Dónde cae realmente la marca.
 *
 * El modo `rpeak` de esta fase es una AYUDA A LA INTERACCIÓN, no una detección
 * de QRS: busca el máximo en valor absoluto de una ventana. En la fase F2 pasa
 * a usar el fiducial que publica el motor y deja de ser una heurística; la
 * interfaz no cambia, cambia de dónde sale el número. */
export function snap(input: SnapInput, mode: SnapMode, ctx: SnapContext): SnapResult {
  switch (mode) {
    case "grid":
      return snapToGrid(input, ctx);
    case "rpeak":
      return snapToRPeak(input, ctx);
    default:
      return snapToSignal(input.rawRingPos, ctx, true);
  }
}

/** El voltaje sale del trazo, nunca del puntero: así no se mide el fondo. */
function snapToSignal(ringPos: number, ctx: SnapContext, snapped: boolean): SnapResult {
  return { ringPos, voltageV: ctx.sweep.at(ringPos), snapped };
}

function snapToGrid(input: SnapInput, ctx: SnapContext): SnapResult {
  const samplesPerMm = ctx.sampleRateHz / paperSpeedOf(ctx.metrics);
  const offset = wrap(input.rawRingPos - ctx.view.startRingPos, ctx.capacity);
  const snappedOffset = Math.round(offset / samplesPerMm) * samplesPerMm;

  const mvPerMm = 1 / ctx.metrics.clinicalGainMmPerMv;
  const mv = input.rawVoltageV * 1000;

  return {
    ringPos: wrap(ctx.view.startRingPos + Math.round(snappedOffset), ctx.capacity),
    voltageV: (Math.round(mv / mvPerMm) * mvPerMm) / 1000,
    snapped: true,
  };
}

function snapToRPeak(input: SnapInput, ctx: SnapContext): SnapResult {
  const halfWindow = Math.round(RPEAK_WINDOW_S * ctx.sampleRateHz);
  const threshold = RPEAK_MIN_MV / 1000;

  let bestPos = -1;
  let bestAbs = 0;
  for (let offset = -halfWindow; offset <= halfWindow; offset++) {
    const pos = wrap(input.rawRingPos + offset, ctx.capacity);
    const abs = Math.abs(ctx.sweep.at(pos));
    if (abs > bestAbs) {
      bestAbs = abs;
      bestPos = pos;
    }
  }

  const isLocalMax =
    bestPos >= 0 &&
    bestAbs >= Math.abs(ctx.sweep.at(wrap(bestPos - 1, ctx.capacity))) &&
    bestAbs >= Math.abs(ctx.sweep.at(wrap(bestPos + 1, ctx.capacity)));

  if (bestAbs < threshold || !isLocalMax) {
    return snapToSignal(input.rawRingPos, ctx, false);
  }
  return snapToSignal(bestPos, ctx, true);
}

/** La velocidad vigente, recuperada de las métricas: `pixelsPerSecond` son
 * milímetros por segundo multiplicados por la escala. */
function paperSpeedOf(metrics: LayoutMetrics): number {
  return metrics.pixelsPerSecond / metrics.viewportScalePxPerMm;
}

function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/measure/snap.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/measure/snap.ts src/measure/snap.test.ts
git commit -m "feat(web): snap a señal, a rejilla y a pico R"
```

---

### Task 8: Herramientas declarativas y sesión de medición

**Files:**
- Create: `apps/web/src/measure/tools.ts`
- Create: `apps/web/src/measure/session.ts`
- Test: `apps/web/src/measure/session.test.ts`

**Interfaces:**
- Consumes: `caliperReadout`, `MeasureContext` de `./formulas`; `SnapMode` de `./snap`; `SamplePoint` de `../render/sample-index`; `LeadName` de `../render/layout`.
- Produces: `ToolId = "ruler" | "caliper" | "rr"`; `MeasurePoint`; `MeasurementResult`; `MeasurementTool`; `TOOLS`; `MeasurementSession`; `createSession(tool)`; `apply(session, event, ctx)`; `isColdChange(before, after)`; `SessionEvent`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/measure/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { apply, createSession, isColdChange } from "./session";
import type { MeasurePoint } from "./tools";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

function point(sampleIndex: number, mv = 0): MeasurePoint {
  return {
    ringPos: sampleIndex % 1000,
    sampleIndex,
    timestampS: sampleIndex / 500,
    voltageV: mv / 1000,
    lead: "II",
  };
}

describe("sesion de medicion", () => {
  it("arranca sin marcas ni resultado, con el snap por defecto de la herramienta", () => {
    const s = createSession("caliper");
    expect(s.markers).toEqual([]);
    expect(s.result).toBeNull();
    expect(s.snapMode).toBe("signal");
  });

  it("la herramienta RR arranca con snap a pico R", () => {
    expect(createSession("rr").snapMode).toBe("rpeak");
  });

  it("hover no toca marcas ni resultado", () => {
    // Es la propiedad que mantiene a React fuera del camino del puntero.
    const s = apply(createSession("caliper"), { type: "hover", point: point(10) }, CTX);
    expect(s.hover).not.toBeNull();
    expect(s.markers).toEqual([]);
    expect(s.result).toBeNull();
  });

  it("hover NO es un cambio frio", () => {
    const antes = createSession("caliper");
    const despues = apply(antes, { type: "hover", point: point(10) }, CTX);
    expect(isColdChange(antes, despues)).toBe(false);
  });

  it("la regla produce resultado con una sola marca", () => {
    const s = apply(createSession("ruler"), { type: "place", point: point(1157, 0.84) }, CTX);

    expect(s.markers).toHaveLength(1);
    expect(s.result).toEqual({
      kind: "cursor",
      lead: "II",
      timestampS: 1157 / 500,
      voltageV: 0.84 / 1000,
    });
  });

  it("el calibrador no produce resultado hasta la segunda marca", () => {
    let s = apply(createSession("caliper"), { type: "place", point: point(1000) }, CTX);
    expect(s.result).toBeNull();

    s = apply(s, { type: "place", point: point(1082, 1.21) }, CTX);
    expect(s.result?.kind).toBe("caliper");
    if (s.result?.kind !== "caliper") throw new Error("resultado inesperado");
    expect(s.result.readout.deltaMs).toBeCloseTo(164, 9);
  });

  it("una tercera marca empieza una medida nueva", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    s = apply(s, { type: "place", point: point(2000) }, CTX);

    expect(s.markers).toHaveLength(1);
    expect(s.markers[0].sampleIndex).toBe(2000);
    expect(s.result).toBeNull();
  });

  it("anchor es siempre la ultima marca puesta", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    expect(s.anchor?.sampleIndex).toBe(1000);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    expect(s.anchor?.sampleIndex).toBe(1082);
  });

  it("arrastrar una marca recalcula el resultado", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    s = apply(s, { type: "dragMarker", index: 1, point: point(1430) }, CTX);

    if (s.result?.kind !== "caliper") throw new Error("resultado inesperado");
    expect(s.result.readout.deltaMs).toBeCloseTo(860, 9);
  });

  it("clear vacia marcas, ancla y resultado pero conserva herramienta y snap", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "setSnap", snapMode: "grid" }, CTX);
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "clear" }, CTX);

    expect(s.markers).toEqual([]);
    expect(s.anchor).toBeNull();
    expect(s.result).toBeNull();
    expect(s.tool).toBe("caliper");
    expect(s.snapMode).toBe("grid");
  });

  it("cambiar de herramienta descarta las marcas de la anterior", () => {
    // Dos marcas de calibrador no significan lo mismo bajo la regla: heredarlas
    // dejaria en pantalla un resultado que ya nadie sabe de que herramienta es.
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "setTool", tool: "ruler" }, CTX);

    expect(s.tool).toBe("ruler");
    expect(s.markers).toEqual([]);
    expect(s.snapMode).toBe("signal");
  });

  it("cambiar el snap NO mueve las marcas ya puestas", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    const antes = s.result;
    s = apply(s, { type: "setSnap", snapMode: "grid" }, CTX);

    expect(s.result).toEqual(antes);
  });

  it("colocar SI es un cambio frio", () => {
    const antes = createSession("ruler");
    const despues = apply(antes, { type: "place", point: point(10) }, CTX);
    expect(isColdChange(antes, despues)).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/measure/session.test.ts
```

Esperado: FAIL — `Failed to resolve import "./session"`.

- [ ] **Step 3: Escribir los descriptores de herramienta**

Crear `apps/web/src/measure/tools.ts`:

```ts
import type { LeadName } from "../render/layout";
import type { SamplePoint } from "../render/sample-index";
import { caliperReadout, type CaliperReadout, type MeasureContext } from "./formulas";
import type { SnapMode } from "./snap";

/** Un punto medido sobre el trazado. Extiende `SamplePoint` con lo que una
 * medida necesita además de la identidad de la muestra. */
export interface MeasurePoint extends SamplePoint {
  /** Posición en el anillo. Es lo que se dibuja; `sampleIndex` es lo que se
   * mide. Se guardan las dos porque el anillo se sobrescribe y el índice no. */
  ringPos: number;
  voltageV: number;
  lead: LeadName;
}

export type MeasurementResult =
  | { kind: "cursor"; lead: LeadName; timestampS: number; voltageV: number }
  | { kind: "caliper"; readout: CaliperReadout };

export type ToolId = "ruler" | "caliper" | "rr";

/** Una herramienta es un descriptor, no una clase.
 *
 * Todas hacen lo mismo —fijar puntos, aplicar snap, producir un resultado—, así
 * que lo único que las distingue son estos cuatro campos. Añadir la undécima
 * herramienta es añadir una entrada a `TOOLS`; las de la fase F2 (PR, QT,
 * resaltado de onda) serán exactamente eso. */
export interface MeasurementTool {
  id: ToolId;
  label: string;
  markerCount: number;
  defaultSnap: SnapMode;
  /** `null` mientras falten marcas. No se calcula sobre `hover`: la lectura
   * viva del cursor la dibuja el overlay y nunca entra en el estado. */
  compute(markers: readonly MeasurePoint[], ctx: MeasureContext): MeasurementResult | null;
}

export const TOOLS: Record<ToolId, MeasurementTool> = {
  ruler: {
    id: "ruler",
    label: "Regla",
    markerCount: 1,
    defaultSnap: "signal",
    compute(markers) {
      if (markers.length < 1) return null;
      const point = markers[0];
      return {
        kind: "cursor",
        lead: point.lead,
        timestampS: point.timestampS,
        voltageV: point.voltageV,
      };
    },
  },
  caliper: {
    id: "caliper",
    label: "Calibrador",
    markerCount: 2,
    defaultSnap: "signal",
    compute(markers, ctx) {
      if (markers.length < 2) return null;
      const [a, b] = markers;
      return {
        kind: "caliper",
        readout: caliperReadout(a.sampleIndex, a.voltageV, b.sampleIndex, b.voltageV, ctx),
      };
    },
  },
  // El RR no es una herramienta nueva: es el calibrador con snap a pico R. Se
  // declara aparte porque el usuario piensa en "medir el RR", no en "cambiar
  // el modo de enganche del calibrador".
  rr: {
    id: "rr",
    label: "RR",
    markerCount: 2,
    defaultSnap: "rpeak",
    compute(markers, ctx) {
      if (markers.length < 2) return null;
      const [a, b] = markers;
      return {
        kind: "caliper",
        readout: caliperReadout(a.sampleIndex, a.voltageV, b.sampleIndex, b.voltageV, ctx),
      };
    },
  },
};
```

- [ ] **Step 4: Escribir la sesión**

Crear `apps/web/src/measure/session.ts`:

```ts
import type { MeasureContext } from "./formulas";
import type { SnapMode } from "./snap";
import { TOOLS, type MeasurePoint, type MeasurementResult, type ToolId } from "./tools";

/** El estado único que comparten todas las herramientas de medición.
 *
 * Si cada herramienta trajese su propia máquina de estados, la undécima
 * costaría lo mismo que la primera y las once se solaparían en un 80%.
 *
 * Vive en una `ref`, no en el store: `hover` cambia a la cadencia del puntero y
 * no puede disparar renders. Solo los campos «fríos» —`tool`, `snapMode`,
 * `markers`, `result`— se publican a React. */
export interface MeasurementSession {
  tool: ToolId;
  snapMode: SnapMode;
  markers: readonly MeasurePoint[];
  /** La última marca puesta: la referencia de la medida en curso. */
  anchor: MeasurePoint | null;
  /** Dónde está el puntero ahora. Nunca entra en el estado de React. */
  hover: MeasurePoint | null;
  result: MeasurementResult | null;
}

export type SessionEvent =
  | { type: "hover"; point: MeasurePoint | null }
  | { type: "place"; point: MeasurePoint }
  | { type: "dragMarker"; index: number; point: MeasurePoint }
  | { type: "clear" }
  | { type: "setTool"; tool: ToolId }
  | { type: "setSnap"; snapMode: SnapMode };

export function createSession(tool: ToolId): MeasurementSession {
  return {
    tool,
    snapMode: TOOLS[tool].defaultSnap,
    markers: [],
    anchor: null,
    hover: null,
    result: null,
  };
}

/** Reductor puro. Sin DOM y sin canvas: se prueba entero con tablas. */
export function apply(
  session: MeasurementSession,
  event: SessionEvent,
  ctx: MeasureContext
): MeasurementSession {
  switch (event.type) {
    case "hover":
      // No recalcula nada. La lectura viva del cursor la dibuja el overlay
      // leyendo `hover`; meterla en `result` obligaría a publicar a React
      // sesenta veces por segundo.
      return { ...session, hover: event.point };

    case "place": {
      const tool = TOOLS[session.tool];
      // Completar la cuenta y volver a pulsar empieza una medida nueva. La
      // alternativa —ignorar el clic— deja al usuario sin forma de medir otra
      // cosa sin buscar antes el botón de limpiar.
      const markers =
        session.markers.length >= tool.markerCount
          ? [event.point]
          : [...session.markers, event.point];
      return withResult({ ...session, markers, anchor: event.point }, ctx);
    }

    case "dragMarker": {
      const markers = session.markers.map((marker, index) =>
        index === event.index ? event.point : marker
      );
      return withResult({ ...session, markers, anchor: event.point }, ctx);
    }

    case "clear":
      return { ...session, markers: [], anchor: null, result: null };

    case "setTool":
      // Las marcas no se heredan: dos puntos de calibrador no significan lo
      // mismo bajo otra herramienta, y arrastrarlos dejaría en pantalla un
      // resultado del que ya nadie sabe de dónde salió.
      return { ...createSession(event.tool), hover: session.hover };

    case "setSnap":
      // No recoloca las marcas ya puestas: el snap decide dónde cae la
      // siguiente, no reinterpreta las anteriores.
      return { ...session, snapMode: event.snapMode };
  }
}

/** `true` si algo que React debe ver ha cambiado. `hover` nunca lo es. */
export function isColdChange(
  before: MeasurementSession,
  after: MeasurementSession
): boolean {
  return (
    before.tool !== after.tool ||
    before.snapMode !== after.snapMode ||
    before.markers !== after.markers ||
    before.result !== after.result
  );
}

function withResult(
  session: MeasurementSession,
  ctx: MeasureContext
): MeasurementSession {
  return { ...session, result: TOOLS[session.tool].compute(session.markers, ctx) };
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/measure/session.test.ts
```

Esperado: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add src/measure/tools.ts src/measure/session.ts src/measure/session.test.ts
git commit -m "feat(web): sesion de medicion unica con herramientas declarativas"
```

---

### Task 9: Dejar habitable `ECGWorkspace`

**Files:**
- Create: `apps/web/src/ui/WorkspaceHeader.tsx`
- Create: `apps/web/src/ui/WorkspaceInspector.tsx`
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`

**Interfaces:**
- Produces: `WorkspaceHeader(props)` y `WorkspaceInspector(props)`. Refactorización sin cambio de comportamiento: `ECGWorkspace.test.tsx` y `accessibility-contract.test.tsx` deben pasar **sin tocarse**.

- [ ] **Step 1: Comprobar el punto de partida en verde**

```bash
npx vitest run src/ui/ECGWorkspace.test.tsx src/ui/accessibility-contract.test.tsx
```

Esperado: PASS. Anota el número de tests: es el mismo que debe salir al final.

- [ ] **Step 2: Extraer la cabecera**

Crear `apps/web/src/ui/WorkspaceHeader.tsx` moviendo **literalmente** el contenido del `<Header>` de `ECGWorkspace.tsx:222-257`, junto con las constantes `THEME_OPTIONS`, `GAIN_OPTIONS`, `parseGain` y `GAIN_HINT` (líneas 64-86), a un componente con esta firma:

```tsx
export interface WorkspaceHeaderProps {
  layout: LayoutId;
  onLayoutChange: (layout: LayoutId) => void;
  themeName: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  gain: GainSetting;
  onGainChange: (gain: GainSetting) => void;
  isFrozen: boolean;
  onToggleFreeze: () => void;
  freezeDisabled: boolean;
  onExportPng: () => void;
  isRecording: boolean;
  onToggleRecording: () => void;
}
```

El JSX es el mismo, con `isPaused` → `isFrozen`, `togglePause` → `onToggleFreeze`, `!hasSession` → `freezeDisabled`, `exportPng` → `onExportPng`, `toggleRecording` → `onToggleRecording`, `setLayout` → `onLayoutChange`, `setThemeName` → `onThemeChange` y `setGain` → `onGainChange`.

- [ ] **Step 3: Extraer el inspector**

Crear `apps/web/src/ui/WorkspaceInspector.tsx` moviendo el contenido del `<Inspector>` de `ECGWorkspace.tsx:319-374`, junto con `GAIN_CLIPPING_HINT` (líneas 87-89) y el helper `measured` (líneas 212-217):

```tsx
export interface WorkspaceInspectorProps {
  lastError: { code: string; detail: string } | null;
  connectionState: SessionState;
  hasConnectedOnce: boolean;
  isAwaitingSignal: boolean;
  isFrozen: boolean;
  gainFits: boolean;
  exportError: string | null;
  rhythmName: string | null;
  bpm: number | null;
  axisDeg: number | null;
  measurements: Record<string, number | null> | null;
}
```

- [ ] **Step 4: Cablear `ECGWorkspace`**

Sustituir los bloques `header={...}` e `inspector={...}` de `ECGWorkspace.tsx` por `<WorkspaceHeader ... />` y `<WorkspaceInspector ... />` con los props de arriba, y borrar de `ECGWorkspace.tsx` las constantes y el helper que se han movido, junto con los imports que queden sin uso.

- [ ] **Step 5: Comprobar que no ha cambiado nada**

```bash
npx vitest run src/ui/ECGWorkspace.test.tsx src/ui/accessibility-contract.test.tsx
```

Esperado: PASS, exactamente el mismo número de tests que en el Step 1, sin haber tocado ningún fichero de test.

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/WorkspaceHeader.tsx src/ui/WorkspaceInspector.tsx src/ui/ECGWorkspace.tsx
git commit -m "refactor(web): separa cabecera e inspector del puesto de simulacion"
```

---

### Task 10: Congelar en el mismo frame

**Files:**
- Create: `apps/web/src/render/sweep-clock.ts`
- Test: `apps/web/src/render/sweep-clock.test.ts`
- Modify: `apps/web/src/ui/hooks/useSweepRenderer.ts:136-174`
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `advanceClock(frozen, previousS, nowS): { elapsedS, nextPreviousS }`; `UseSweepRendererParams.frozen: boolean`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/render/sweep-clock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { advanceClock } from "./sweep-clock";

describe("advanceClock", () => {
  it("el primer tick no consume nada: no hay contra que medir", () => {
    expect(advanceClock(false, undefined, 100)).toEqual({
      elapsedS: 0,
      nextPreviousS: 100,
    });
  });

  it("en marcha devuelve el tiempo transcurrido desde el tick anterior", () => {
    const tick = advanceClock(false, 100, 100.016);
    // La resta de dos instantes de reloj no es exacta en coma flotante, y
    // tampoco necesita serlo: son segundos de reproduccion, no una medida.
    expect(tick.elapsedS).toBeCloseTo(0.016, 9);
    expect(tick.nextPreviousS).toBe(100.016);
  });

  it("congelado no consume nada", () => {
    expect(advanceClock(true, 100, 100.016).elapsedS).toBe(0);
  });

  it("congelado olvida el reloj, para que al reanudar no se coma el buffer", () => {
    // Sin esto, tras treinta segundos congelado el primer tick pediria treinta
    // segundos de señal y vaciaria el buffer entero sin llegar a dibujarlo.
    expect(advanceClock(true, 100, 130).nextPreviousS).toBeUndefined();
  });

  it("el primer tick tras reanudar consume cero", () => {
    const congelado = advanceClock(true, 100, 130);
    const reanudado = advanceClock(false, congelado.nextPreviousS, 130.016);
    expect(reanudado.elapsedS).toBe(0);
    expect(reanudado.nextPreviousS).toBe(130.016);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/render/sweep-clock.test.ts
```

Esperado: FAIL — `Failed to resolve import "./sweep-clock"`.

- [ ] **Step 3: Escribir el reloj**

Crear `apps/web/src/render/sweep-clock.ts`:

```ts
export interface ClockTick {
  /** Segundos de señal a consumir en este tick. */
  elapsedS: number;
  /** Instante que el siguiente tick debe usar como referencia. `undefined`
   * significa «no hay referencia»: el siguiente tick consumirá cero. */
  nextPreviousS: number | undefined;
}

/** Cuánto avanza la reproducción en este frame.
 *
 * Congelar es del CLIENTE y ocurre en el mismo frame que el clic. Esperar a
 * que el servidor confirme la pausa y a que se vacíe el buffer de red
 * significaría hasta 0,7 s de trazado moviéndose después de pulsar, que se lee
 * como retardo de la herramienta.
 *
 * Congelado no se drena nada: el motor congela también su reloj, así que lo
 * que quedó en el buffer es contiguo con lo que llegará al reanudar y tirarlo
 * abriría un hueco artificial en el trazo.
 *
 * Olvidar la referencia temporal mientras se está congelado es lo que evita
 * que el primer tick tras reanudar pida de golpe todos los segundos que duró
 * la pausa. */
export function advanceClock(
  frozen: boolean,
  previousS: number | undefined,
  nowS: number
): ClockTick {
  if (frozen) {
    return { elapsedS: 0, nextPreviousS: undefined };
  }
  return {
    elapsedS: previousS === undefined ? 0 : nowS - previousS,
    nextPreviousS: nowS,
  };
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/render/sweep-clock.test.ts
```

Esperado: PASS, 5 tests.

- [ ] **Step 5: Usar el reloj en el renderer**

En `apps/web/src/ui/hooks/useSweepRenderer.ts`, añadir `frozen: boolean;` a `UseSweepRendererParams`, recibirlo en la desestructuración de la función, y añadir junto al resto de refs:

```ts
  // En una `ref` y no en las dependencias del efecto: congelar no debe
  // desmontar y remontar el bucle de dibujo.
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
```

Sustituir el cuerpo del `tick` (líneas 140-170) por:

```ts
    const tick = (nowMs: number) => {
      const { elapsedS, nextPreviousS } = advanceClock(
        frozenRef.current,
        lastS,
        nowMs / 1000
      );
      lastS = nextPreviousS;

      if (!frozenRef.current) {
        runtime.buffer.advance(elapsedS);
        // Se dibuja lo que advance() haya liberado ESTE tick, aunque el buffer
        // haya quedado vacío al hacerlo: si no, el último trozo consumido antes
        // de un underrun se perdería sin llegar a pintarse. Con cero muestras
        // nuevas, drawSweepSegment no toca el canvas y el trazo se congela en la
        // última muestra, sin interpolar jamás.
        //
        // El hueco es el mismo para las doce derivaciones (viene del mismo trozo
        // multicanal), así que se lee una vez por tick y no por derivación.
        const hadGap = runtime.buffer.justConsumedHadGap;
        for (const lead of leads) {
          const canvas = traceCanvases.current.get(lead);
          const ctx = canvas?.getContext("2d");
          const sweep = sweeps.current.get(lead);
          if (!canvas || !ctx || !sweep) continue;
          const samples = runtime.buffer.consumeNewSamples(leadIndex(lead));
          drawSweepSegment(
            ctx, sweep, samples, sampleRateHz, options, canvas.height, hadGap
          );
        }

        // "Esperando señal" cubre los dos motivos opuestos de no reproducir: no
        // queda nada (underrun) o aún no hay reserva suficiente (pre-roll).
        setIsAwaitingSignal(runtime.buffer.isUnderrun || !runtime.buffer.isPreRolled);
      }

      frameId = requestAnimationFrame(tick);
    };
```

Añadir el import: `import { advanceClock } from "../../render/sweep-clock";`

- [ ] **Step 6: Cablear el congelado inmediato**

En `apps/web/src/ui/ECGWorkspace.tsx`:

```tsx
  // El congelado es LOCAL y no espera al servidor: el usuario ve el trazado
  // parado en el mismo frame en que pulsa. El `pause` viaja en paralelo para
  // que el motor deje de generar.
  const [isFrozen, setIsFrozen] = useState(false);

  const toggleFreeze = () => {
    if (isFrozen) {
      setIsFrozen(false);
      runtime.resume();
    } else {
      setIsFrozen(true);
      runtime.pause();
    }
  };
```

Pasar `frozen: isFrozen` a `useSweepRenderer`, `isFrozen` y `onToggleFreeze={toggleFreeze}` a `WorkspaceHeader`, e `isFrozen` a `WorkspaceInspector`. En `handleRhythmSelect`, añadir `setIsFrozen(false)` antes de `runtime.start(...)`: un ritmo nuevo arranca un trazado nuevo y dejarlo congelado mostraría el ritmo anterior detenido.

En `WorkspaceInspector.tsx`, sustituir la condición del indicador por `isFrozen` en lugar de `isPaused`.

- [ ] **Step 7: Escribir el test de comportamiento**

Añadir a `apps/web/src/ui/ECGWorkspace.test.tsx`:

```tsx
  it("el indicador de congelado aparece al pulsar, sin esperar al servidor", async () => {
    // Es la diferencia entre una herramienta que responde y una que parece
    // tener medio segundo de retardo. El socket falso NUNCA devuelve el
    // mensaje `paused`: si el indicador dependiese del servidor, este test
    // no pasaria jamas.
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
    // Sin el `started` la sesion no esta en marcha y el boton sigue
    // deshabilitado: `freezeDisabled` depende de `connectionState`.
    act(() => {
      fakeSocket.dispatch("message", {
        data: JSON.stringify({
          type: "started",
          session_id: "11111111-1111-1111-1111-111111111111",
          seed: 1,
          sample_rate_hz: 500,
          channels: 12,
        }),
      });
    });

    await userEvent.click(screen.getByRole("button", { name: /congelar/i }));

    expect(screen.getByText(/trazado congelado/i)).toBeInTheDocument();
    // Y el `pause` sale hacia el motor de todas formas: congelar el cliente no
    // debe dejar al servidor generando señal que nadie va a ver.
    expect(fakeSocket.sentMessages.some((m) => m.includes('"pause"'))).toBe(true);
  });
```

- [ ] **Step 8: Ejecutar la suite entera**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/render/sweep-clock.ts src/render/sweep-clock.test.ts src/ui/hooks/useSweepRenderer.ts src/ui/ECGWorkspace.tsx src/ui/WorkspaceHeader.tsx src/ui/WorkspaceInspector.tsx src/ui/ECGWorkspace.test.tsx
git commit -m "feat(web): congelar el trazado en el mismo frame que el clic"
```

---

### Task 11: Alimentar el índice y exponer la fuente de medida

**Files:**
- Modify: `apps/web/src/ui/hooks/useSweepRenderer.ts`

**Interfaces:**
- Consumes: `SampleIndexRing`, `FrameBuffer.consumedSampleIndices()`.
- Produces: `UseSweepRendererResult.getMeasureSource(): MeasureSource | null`, con `MeasureSource { sweeps: ReadonlyMap<LeadName, SweepBuffer>; indexRing: SampleIndexRing; capacity: number }`.

- [ ] **Step 1: Escribir el índice junto a las muestras**

En `apps/web/src/ui/hooks/useSweepRenderer.ts`:

```ts
  // Uno solo para las doce derivaciones: se escriben en el mismo tick desde el
  // mismo trozo multicanal, así que comparten eje por construcción.
  const indexRing = useRef(new SampleIndexRing(1));
```

Dentro del efecto que recrea los anillos (líneas 78-83), añadir tras construir `next`:

```ts
    indexRing.current = new SampleIndexRing(capacity);
```

Dentro del efecto de `started` (líneas 88-97), añadir junto a los `sweep.reset()`:

```ts
      indexRing.current.reset();
```

Y en el `tick`, dentro de la rama `if (!frozenRef.current)`, justo después de `runtime.buffer.advance(elapsedS)`:

```ts
        // Se lee una vez por tick y no por derivación: el eje es el mismo para
        // las doce.
        indexRing.current.push(runtime.buffer.consumedSampleIndices());
```

Añadir el import: `import { SampleIndexRing } from "../../render/sample-index";`

- [ ] **Step 2: Exponer la fuente de medida**

Añadir a `UseSweepRendererResult`:

```ts
  /** Los anillos que la capa de medición necesita leer.
   *
   * Se entrega como función y no como valor para que el consumidor lea el
   * estado del momento sin que el hook tenga que volver a renderizar cuando los
   * anillos se recrean. */
  getMeasureSource: () => MeasureSource | null;
```

Y la interfaz, junto a las demás del fichero:

```ts
export interface MeasureSource {
  sweeps: ReadonlyMap<LeadName, SweepBuffer>;
  indexRing: SampleIndexRing;
  capacity: number;
}
```

En el `return` del hook:

```ts
  const getMeasureSource = useCallback((): MeasureSource | null => {
    const capacity = indexRing.current.capacity;
    if (indexRing.current.writtenCount === 0) return null;
    return { sweeps: sweeps.current, indexRing: indexRing.current, capacity };
  }, []);
```

y añadir `getMeasureSource` al objeto devuelto.

- [ ] **Step 3: Comprobar que nada se ha roto**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/useSweepRenderer.ts
git commit -m "feat(web): el renderer alimenta el indice de muestras y publica la fuente de medida"
```

---

### Task 12: Dibujo del overlay

**Files:**
- Create: `apps/web/src/render/overlay-layer.ts`
- Test: `apps/web/src/render/overlay-layer.test.ts`

**Interfaces:**
- Consumes: `MeasurementSession`, `StripLayout`, `TraceView`, `EcgTheme`, formateadores de `measure/formulas`.
- Produces: `OverlayFrame { session, layout, view, sampleRateHz, capacity, writtenCount, theme, magnifier }`; `drawOverlay(ctx, frame): void`; `CURSOR_LABEL_PX`, `MARKER_HANDLE_PX`.

**Color:** `EcgTheme` ya reserva un rol `cursor` (`themes/types.ts:13`) para exactamente esto. Se usa ese, no `trace`. El cursor vivo se dibuja con trazo discontinuo y las marcas fijadas con trazo continuo: distingue de un vistazo «dónde está el puntero» de «dónde he dejado una marca», sin añadir un segundo color.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/render/overlay-layer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getTheme } from "@ui-system/themes/index";
import { computeLayoutMetrics } from "./layout-engine";
import { PX_PER_MM } from "./grid-layer";
import { drawOverlay } from "./overlay-layer";
import { createSession } from "../measure/session";
import type { MeasurePoint } from "../measure/tools";

const CAPACITY = 1000;
const SAMPLE_RATE_HZ = 500;

function makeCtx() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;
}

const METRICS = computeLayoutMetrics({
  availableWidthPx: 10 * 25 * PX_PER_MM,
  availableHeightPx: 600,
  rowCount: 6,
  columnCount: 2,
  gain: 10,
  paperSpeedMmS: 25,
});

const LAYOUT = {
  leadColumns: [
    ["I", "II", "III", "aVR", "aVL", "aVF"],
    ["V1", "V2", "V3", "V4", "V5", "V6"],
  ],
  metrics: METRICS,
} as const;

function point(ringPos: number, lead = "II"): MeasurePoint {
  return {
    ringPos,
    sampleIndex: ringPos,
    timestampS: ringPos / SAMPLE_RATE_HZ,
    voltageV: 0.00084,
    lead: lead as MeasurePoint["lead"],
  };
}

function frameWith(session: ReturnType<typeof createSession>) {
  return {
    session,
    layout: LAYOUT,
    view: { startRingPos: 0, visibleSamples: CAPACITY },
    sampleRateHz: SAMPLE_RATE_HZ,
    capacity: CAPACITY,
    theme: getTheme("dark").ecg,
    magnifier: false,
  };
}

describe("drawOverlay", () => {
  it("limpia el canvas y no dibuja nada sin cursor ni marcas", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, frameWith(createSession("caliper")));

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("la linea de tiempo cruza TODAS las columnas", () => {
    // Es la razon de que el overlay sea uno solo y no doce: un cursor
    // sincronizado es una linea, no doce dibujos coordinados.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, frameWith(session));

    // Una vertical por columna, mas la horizontal de voltaje.
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("las dos columnas dibujan la linea al mismo desplazamiento dentro de su tira", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, frameWith(session));

    const xs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const enPrimera = xs.find((x) => x < METRICS.stripWidthPx)!;
    const enSegunda = xs.find((x) => x > METRICS.stripWidthPx)!;
    expect(enSegunda - enPrimera).toBeCloseTo(METRICS.stripWidthPx + 8, 6);
  });

  it("escribe la lectura del cursor con derivacion, tiempo y voltaje", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(1157) };
    drawOverlay(ctx, frameWith(session));

    const textos = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(textos).toContain("II");
    expect(textos).toContain("2.314 s");
    expect(textos).toContain("+0.84 mV");
  });

  it("dibuja una marca por cada punto fijado", () => {
    const ctx = makeCtx();
    const session = {
      ...createSession("caliper"),
      markers: [point(200), point(400)],
    };
    drawOverlay(ctx, frameWith(session));

    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("no dibuja el cursor fuera de la region medible", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: null };
    drawOverlay(ctx, frameWith(session));

    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/render/overlay-layer.test.ts
```

Esperado: FAIL — `Failed to resolve import "./overlay-layer"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/web/src/render/overlay-layer.ts`:

```ts
import type { EcgTheme } from "@ui-system/themes/types";
import { formatMv, formatSeconds } from "../measure/formulas";
import type { MeasurementSession } from "../measure/session";
import type { MeasurePoint } from "../measure/tools";
import { COLUMN_GAP_PX, STRIP_GAP_PX } from "./layout-engine";
import { pxPerSample, ringPosToPx, type StripLayout, type TraceView } from "./measure-geometry";
import { voltageToPx } from "./grid-layer";

export const CURSOR_LABEL_PX = 11;
const LABEL_LINE_HEIGHT_PX = 13;
const LABEL_MARGIN_PX = 8;
export const MARKER_HANDLE_PX = 5;

export interface OverlayFrame {
  session: MeasurementSession;
  layout: StripLayout;
  view: TraceView;
  sampleRateHz: number;
  capacity: number;
  theme: EcgTheme;
  magnifier: boolean;
}

/** Pinta cursor, marcas y rótulos sobre TODA la rejilla de tiras.
 *
 * Un solo canvas y no uno por derivación: la línea de tiempo cruza las doce, y
 * con doce canvas habría que coordinar doce dibujos para pintar una línea.
 * Aquí vivirán también los brackets, las anotaciones y el resaltado de ondas de
 * la fase F2, compartiendo este mismo sistema de coordenadas. */
export function drawOverlay(ctx: CanvasRenderingContext2D, frame: OverlayFrame): void {
  const { metrics } = frame.layout;
  const columns = frame.layout.leadColumns.length;
  const rows = Math.max(...frame.layout.leadColumns.map((column) => column.length));
  const widthPx = metrics.stripWidthPx * columns + COLUMN_GAP_PX * (columns - 1);
  const heightPx = metrics.stripHeightPx * rows + STRIP_GAP_PX * (rows - 1);

  ctx.clearRect(0, 0, widthPx, heightPx);

  const pps = pxPerSample(metrics, frame.sampleRateHz);

  for (const marker of frame.session.markers) {
    drawTimeLine(ctx, marker.ringPos, frame, pps, heightPx, frame.theme.gridMajor);
    drawHandle(ctx, marker, frame, pps);
  }

  const hover = frame.session.hover;
  if (!hover) {
    return;
  }
  drawTimeLine(ctx, hover.ringPos, frame, pps, heightPx, frame.theme.trace);
  drawVoltageLine(ctx, hover, frame, widthPx);
  drawCursorLabel(ctx, hover, frame, pps, widthPx);
}

/** Una vertical POR COLUMNA, todas al mismo desplazamiento dentro de su tira:
 * las columnas muestran el mismo instante con derivaciones distintas. */
function drawTimeLine(
  ctx: CanvasRenderingContext2D,
  ringPos: number,
  frame: OverlayFrame,
  pps: number,
  heightPx: number,
  color: string
): void {
  const { metrics } = frame.layout;
  const xInStrip = ringPosToPx(ringPos, frame.view, pps, frame.capacity);
  if (xInStrip < 0 || xInStrip > metrics.stripWidthPx) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let column = 0; column < frame.layout.leadColumns.length; column++) {
    const x = column * (metrics.stripWidthPx + COLUMN_GAP_PX) + xInStrip;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, heightPx);
    ctx.stroke();
  }
}

/** La horizontal es de UNA derivación: el voltaje no es común a las doce. */
function drawVoltageLine(
  ctx: CanvasRenderingContext2D,
  point: MeasurePoint,
  frame: OverlayFrame,
  widthPx: number
): void {
  const position = locate(point, frame);
  if (!position) return;
  const y = position.top + frame.layout.metrics.stripHeightPx / 2 -
    voltageToPx(point.voltageV, frame.layout.metrics);

  ctx.strokeStyle = frame.theme.trace;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(widthPx, y);
  ctx.stroke();
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  marker: MeasurePoint,
  frame: OverlayFrame,
  pps: number
): void {
  const position = locate(marker, frame);
  if (!position) return;
  const x = position.left + ringPosToPx(marker.ringPos, frame.view, pps, frame.capacity);
  const y = position.top + frame.layout.metrics.stripHeightPx / 2 -
    voltageToPx(marker.voltageV, frame.layout.metrics);

  ctx.strokeStyle = frame.theme.gridMajor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - MARKER_HANDLE_PX, y);
  ctx.lineTo(x + MARKER_HANDLE_PX, y);
  ctx.moveTo(x, y - MARKER_HANDLE_PX);
  ctx.lineTo(x, y + MARKER_HANDLE_PX);
  ctx.stroke();
}

/** El rótulo va al lado opuesto del cursor respecto al borde más cercano: si
 * no, tapa justo lo que se está mirando. */
function drawCursorLabel(
  ctx: CanvasRenderingContext2D,
  point: MeasurePoint,
  frame: OverlayFrame,
  pps: number,
  widthPx: number
): void {
  const position = locate(point, frame);
  if (!position) return;
  const x = position.left + ringPosToPx(point.ringPos, frame.view, pps, frame.capacity);
  const flip = x > widthPx - 120;

  ctx.fillStyle = frame.theme.trace;
  ctx.font = `${CURSOR_LABEL_PX}px monospace`;
  ctx.textAlign = flip ? "right" : "left";
  ctx.textBaseline = "top";

  const textX = flip ? x - LABEL_MARGIN_PX : x + LABEL_MARGIN_PX;
  const lines = [
    point.lead,
    formatSeconds(point.timestampS),
    formatMv(point.voltageV * 1000),
  ];
  lines.forEach((line, index) => {
    ctx.fillText(line, textX, position.top + 2 + index * LABEL_LINE_HEIGHT_PX);
  });
}

/** Esquina de la tira de esa derivación, o `null` si no está en pantalla. */
function locate(
  point: MeasurePoint,
  frame: OverlayFrame
): { left: number; top: number } | null {
  const { metrics } = frame.layout;
  for (let column = 0; column < frame.layout.leadColumns.length; column++) {
    const row = frame.layout.leadColumns[column].indexOf(point.lead);
    if (row < 0) continue;
    return {
      left: column * (metrics.stripWidthPx + COLUMN_GAP_PX),
      top: row * (metrics.stripHeightPx + STRIP_GAP_PX),
    };
  }
  return null;
}
```

- [ ] **Step 4: Atenuar la región no escrita**

Si la sesión lleva menos de lo que cabe en la tira, parte del anillo nunca se ha escrito. Ahí no hay señal y no se puede medir; el límite tiene que **verse**, no descubrirse al no poder hacer clic.

Añadir a `overlay-layer.test.ts`:

```ts
describe("region medible", () => {
  it("atenua la parte del anillo que nunca se ha escrito", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, { ...frameWith(createSession("caliper")), writtenCount: 400 });

    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("con el anillo lleno no atenua nada", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, { ...frameWith(createSession("caliper")), writtenCount: CAPACITY });

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
```

y añadir `writtenCount: CAPACITY` a `frameWith`.

En `overlay-layer.ts`, añadir `writtenCount: number;` a `OverlayFrame` y, al principio de `drawOverlay` tras el `clearRect`:

```ts
  drawUnwrittenRegion(ctx, frame, pps, heightPx);
```

con:

```ts
/** Vela la parte del anillo que todavía no tiene señal.
 *
 * Sin esto, el límite de lo medible se descubre al intentar colocar una marca
 * y no poder. Una zona atenuada lo dice antes de intentarlo. */
function drawUnwrittenRegion(
  ctx: CanvasRenderingContext2D,
  frame: OverlayFrame,
  pps: number,
  heightPx: number
): void {
  if (frame.writtenCount >= frame.capacity) return;
  const { metrics } = frame.layout;
  const firstUnwritten = ringPosToPx(frame.writtenCount, frame.view, pps, frame.capacity);
  const widthPx = metrics.stripWidthPx - firstUnwritten;
  if (widthPx <= 0) return;

  ctx.fillStyle = frame.theme.gridMinor;
  for (let column = 0; column < frame.layout.leadColumns.length; column++) {
    const left = column * (metrics.stripWidthPx + COLUMN_GAP_PX) + firstUnwritten;
    ctx.fillRect(left, 0, widthPx, heightPx);
  }
}
```

En `MeasureOverlay.tsx`, pasar `writtenCount: source.indexRing.writtenCount` al `drawOverlay`. En `useMeasure.pointAt`, devolver `null` cuando `snapped.ringPos >= source.indexRing.writtenCount` y el anillo no esté lleno: no se coloca marca sobre lo que no existe.

- [ ] **Step 5: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/render/overlay-layer.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/render/overlay-layer.ts src/render/overlay-layer.test.ts
git commit -m "feat(web): dibujo del cursor y las marcas sobre la rejilla de tiras"
```

---

### Task 13: El canvas de overlay, con ratón y teclado

**Files:**
- Create: `apps/web/src/ui/hooks/useMeasure.ts`
- Create: `apps/web/src/ui/MeasureOverlay.tsx`
- Create: `apps/web/src/ui/MeasureOverlay.module.css`
- Test: `apps/web/src/ui/MeasureOverlay.test.tsx`
- Modify: `apps/web/src/ui/EcgDisplay.tsx`

**Interfaces:**
- Consumes: `MeasureSource` de `useSweepRenderer`; `apply`, `createSession`, `isColdChange`; `snap`; `drawOverlay`; `hitTest`, `pxToRingPos`, `pxToVoltage`, `pxPerSample`.
- Produces: `useMeasure(params): UseMeasureResult`; `<MeasureOverlay />`; `EcgDisplayProps.overlay?: ReactNode`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/ui/MeasureOverlay.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getTheme } from "@ui-system/themes/index";
import { computeLayoutMetrics } from "../render/layout-engine";
import { PX_PER_MM } from "../render/grid-layer";
import { SampleIndexRing } from "../render/sample-index";
import { SweepBuffer } from "../render/sweep-buffer";
import { MeasureOverlay } from "./MeasureOverlay";
import type { LeadName } from "../render/layout";

const CAPACITY = 1000;
const SAMPLE_RATE_HZ = 500;

const METRICS = computeLayoutMetrics({
  availableWidthPx: 10 * 25 * PX_PER_MM,
  availableHeightPx: 600,
  rowCount: 1,
  columnCount: 1,
  gain: 10,
  paperSpeedMmS: 25,
});

function makeSource() {
  const sweep = new SweepBuffer(CAPACITY);
  const samples = new Float32Array(CAPACITY);
  samples[500] = 0.0012;
  sweep.push(samples);

  const indexRing = new SampleIndexRing(CAPACITY);
  const indices = new Float64Array(CAPACITY);
  for (let i = 0; i < CAPACITY; i++) indices[i] = i;
  indexRing.push(indices);

  return {
    sweeps: new Map<LeadName, SweepBuffer>([["II", sweep]]),
    indexRing,
    capacity: CAPACITY,
  };
}

function renderOverlay(active = true) {
  const onResult = vi.fn();
  render(
    <MeasureOverlay
      active={active}
      layout={{ leadColumns: [["II"]], metrics: METRICS }}
      sampleRateHz={SAMPLE_RATE_HZ}
      paperSpeedMmS={25}
      theme={getTheme("dark").ecg}
      getSource={makeSource}
      view={{ startRingPos: 0, visibleSamples: CAPACITY }}
      magnifier={false}
      onResultChange={onResult}
    />
  );
  return onResult;
}

describe("MeasureOverlay", () => {
  it("no es interactivo mientras el trazado corre", () => {
    renderOverlay(false);
    expect(screen.queryByRole("application")).toBeNull();
  });

  it("congelado expone una superficie enfocable con nombre", () => {
    renderOverlay();
    expect(
      screen.getByRole("application", { name: /medición sobre el trazado/i })
    ).toBeInTheDocument();
  });

  it("colocar dos marcas con el teclado produce un resultado", async () => {
    const user = userEvent.setup();
    const onResult = renderOverlay();
    const surface = screen.getByRole("application");

    surface.focus();
    // El primer Enter materializa el cursor (que aun no existe: no ha habido
    // movimiento de raton); el segundo ya coloca la primera marca.
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowRight>82/}");
    await user.keyboard("{Enter}");

    expect(onResult).toHaveBeenCalled();
    const last = onResult.mock.calls.at(-1)![0];
    expect(last.result.kind).toBe("caliper");
    expect(last.result.readout.deltaMs).toBeCloseTo(164, 6);
  });

  it("Escape limpia la medida", async () => {
    const user = userEvent.setup();
    const onResult = renderOverlay();
    const surface = screen.getByRole("application");

    surface.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect(onResult.mock.calls.at(-1)![0].result).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/ui/MeasureOverlay.test.tsx
```

Esperado: FAIL — `Failed to resolve import "./MeasureOverlay"`.

- [ ] **Step 3: Escribir el hook**

Crear `apps/web/src/ui/hooks/useMeasure.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { hitTest, pxPerSample, pxToRingPos, pxToVoltage, type StripLayout, type TraceView } from "../../render/measure-geometry";
import { apply, createSession, isColdChange, type MeasurementSession } from "../../measure/session";
import { snap, type SnapMode } from "../../measure/snap";
import type { MeasurePoint, ToolId } from "../../measure/tools";
import type { MeasureSource } from "./useSweepRenderer";

export interface UseMeasureParams {
  layout: StripLayout;
  sampleRateHz: number;
  paperSpeedMmS: number;
  view: TraceView;
  getSource: () => MeasureSource | null;
  onResultChange: (session: MeasurementSession) => void;
}

export interface UseMeasureResult {
  /** La sesión viva. Se lee desde el bucle de dibujo, nunca desde el render. */
  sessionRef: React.MutableRefObject<MeasurementSession>;
  /** Copia de los campos fríos, para lo que sí debe re-renderizar. */
  cold: MeasurementSession;
  dirtyRef: React.MutableRefObject<boolean>;
  pointAt: (xPx: number, yPx: number) => MeasurePoint | null;
  dispatch: (event: Parameters<typeof apply>[1]) => void;
  moveCursorBySamples: (delta: number) => void;
  setTool: (tool: ToolId) => void;
  setSnapMode: (mode: SnapMode) => void;
}

/** Dueño de la sesión de medición.
 *
 * La sesión vive en una `ref` porque `hover` cambia a la cadencia del puntero:
 * meterla en el estado de React volvería a renderizar el árbol sesenta veces
 * por segundo. Solo los cambios «fríos» —herramienta, snap, marcas, resultado—
 * se publican. */
export function useMeasure({
  layout,
  sampleRateHz,
  paperSpeedMmS,
  view,
  getSource,
  onResultChange,
}: UseMeasureParams): UseMeasureResult {
  const sessionRef = useRef<MeasurementSession>(createSession("caliper"));
  const dirtyRef = useRef(true);
  const [cold, setCold] = useState<MeasurementSession>(sessionRef.current);

  const measureCtx = {
    sampleRateHz,
    paperSpeedMmS,
    clinicalGainMmPerMv: layout.metrics.clinicalGainMmPerMv,
  };

  const dispatch = useCallback(
    (event: Parameters<typeof apply>[1]) => {
      const before = sessionRef.current;
      const after = apply(before, event, measureCtx);
      sessionRef.current = after;
      dirtyRef.current = true;
      if (isColdChange(before, after)) {
        setCold(after);
        onResultChange(after);
      }
    },
    // `measureCtx` se reconstruye en cada render; sus tres campos son los que
    // importan y son primitivos.
    [sampleRateHz, paperSpeedMmS, layout.metrics.clinicalGainMmPerMv, onResultChange]
  );

  /** Traduce un punto del canvas a una muestra medida, con snap aplicado.
   * `null` en los huecos entre tiras y fuera del área. */
  const pointAt = useCallback(
    (xPx: number, yPx: number): MeasurePoint | null => {
      const source = getSource();
      if (!source) return null;
      const hit = hitTest(xPx, yPx, layout);
      if (!hit) return null;
      const sweep = source.sweeps.get(hit.lead);
      if (!sweep) return null;

      const pps = pxPerSample(layout.metrics, sampleRateHz);
      const rawRingPos = pxToRingPos(hit.xInStrip, view, pps, source.capacity);
      const rawVoltageV = pxToVoltage(hit.yInStrip, layout.metrics.stripHeightPx, layout.metrics);

      const snapped = snap({ rawRingPos, rawVoltageV }, sessionRef.current.snapMode, {
        sweep,
        sampleRateHz,
        metrics: layout.metrics,
        view,
        capacity: source.capacity,
      });
      const sampleIndex = source.indexRing.at(snapped.ringPos);

      return {
        ringPos: snapped.ringPos,
        sampleIndex,
        timestampS: sampleIndex / sampleRateHz,
        voltageV: snapped.voltageV,
        lead: hit.lead,
      };
    },
    [getSource, layout, sampleRateHz, view]
  );

  /** Mueve el cursor por teclado. Sin esto la herramienta solo existe para
   * quien usa ratón, y su resultado nunca llegaría al DOM. */
  const moveCursorBySamples = useCallback(
    (delta: number) => {
      const source = getSource();
      if (!source) return;
      const current = sessionRef.current.hover;
      const lead = current?.lead ?? layout.leadColumns[0][0];
      const sweep = source.sweeps.get(lead);
      if (!sweep) return;

      const base = current?.ringPos ?? view.startRingPos;
      const ringPos = ((base + delta) % source.capacity + source.capacity) % source.capacity;
      const sampleIndex = source.indexRing.at(ringPos);

      sessionRef.current = apply(
        sessionRef.current,
        {
          type: "hover",
          point: {
            ringPos,
            sampleIndex,
            timestampS: sampleIndex / sampleRateHz,
            voltageV: sweep.at(ringPos),
            lead,
          },
        },
        measureCtx
      );
      dirtyRef.current = true;
    },
    [getSource, layout, sampleRateHz, view, paperSpeedMmS]
  );

  const setTool = useCallback((tool: ToolId) => dispatch({ type: "setTool", tool }), [dispatch]);
  const setSnapMode = useCallback(
    (snapMode: SnapMode) => dispatch({ type: "setSnap", snapMode }),
    [dispatch]
  );

  // Un cambio de geometría invalida las marcas: describen posiciones del anillo
  // que ya no caen donde caían.
  useEffect(() => {
    dispatch({ type: "clear" });
  }, [layout.metrics.stripWidthPx, layout.metrics.stripHeightPx, paperSpeedMmS]);

  return { sessionRef, cold, dirtyRef, pointAt, dispatch, moveCursorBySamples, setTool, setSnapMode };
}
```

- [ ] **Step 4: Escribir el componente**

Crear `apps/web/src/ui/MeasureOverlay.module.css`:

```css
.overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}

.overlay:focus-visible {
  outline: 2px solid var(--inspector-ok);
  outline-offset: -2px;
}
```

`--inspector-ok` y no `--color-accent`, que no existe en `tokens.css`: es el mismo rol de foco que ya usa `SegmentedControl.module.css`.

Crear `apps/web/src/ui/MeasureOverlay.tsx`:

```tsx
import { useCallback, useEffect, useRef } from "react";
import type { EcgTheme } from "@ui-system/themes/types";
import { COLUMN_GAP_PX, STRIP_GAP_PX } from "../render/layout-engine";
import type { StripLayout, TraceView } from "../render/measure-geometry";
import { drawOverlay } from "../render/overlay-layer";
import type { MeasurementSession } from "../measure/session";
import { useMeasure } from "./hooks/useMeasure";
import type { MeasureSource } from "./hooks/useSweepRenderer";
import styles from "./MeasureOverlay.module.css";

/** Un arrastre por debajo de este umbral es un clic: colocar una marca y
 * desplazar la vista comparten el mismo botón, y distinguirlos por el
 * movimiento es lo que evita tener que activar un modo. */
const DRAG_THRESHOLD_PX = 4;

export interface MeasureOverlayProps {
  /** Solo con el trazado congelado: medir sobre un barrido en marcha no
   * significa nada, porque la muestra bajo el cursor cambia 500 veces por
   * segundo. */
  active: boolean;
  layout: StripLayout;
  sampleRateHz: number;
  paperSpeedMmS: number;
  theme: EcgTheme;
  view: TraceView;
  magnifier: boolean;
  getSource: () => MeasureSource | null;
  onResultChange: (session: MeasurementSession) => void;
}

export function MeasureOverlay({
  active,
  layout,
  sampleRateHz,
  paperSpeedMmS,
  theme,
  view,
  magnifier,
  getSource,
  onResultChange,
}: MeasureOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const { sessionRef, dirtyRef, pointAt, dispatch, moveCursorBySamples } = useMeasure({
    layout,
    sampleRateHz,
    paperSpeedMmS,
    view,
    getSource,
    onResultChange,
  });

  const columns = layout.leadColumns.length;
  const rows = Math.max(...layout.leadColumns.map((column) => column.length));
  const widthPx = layout.metrics.stripWidthPx * columns + COLUMN_GAP_PX * (columns - 1);
  const heightPx = layout.metrics.stripHeightPx * rows + STRIP_GAP_PX * (rows - 1);

  // Bucle propio, independiente del barrido —que estando congelado no tiene
  // nada que hacer—. Solo pinta cuando algo ha cambiado.
  useEffect(() => {
    if (!active) return;
    let frameId: number;
    const tick = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const source = getSource();
      if (canvas && ctx && source && dirtyRef.current) {
        dirtyRef.current = false;
        drawOverlay(ctx, {
          session: sessionRef.current,
          layout,
          view,
          sampleRateHz,
          capacity: source.capacity,
          theme,
          magnifier,
        });
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, layout, view, sampleRateHz, theme, magnifier, getSource]);

  // Al desactivarse se limpia: las marcas describen un anillo que se va a
  // sobrescribir, y conservar los números sería conservar una referencia a un
  // trazado que ya no está.
  useEffect(() => {
    if (!active) dispatch({ type: "clear" });
  }, [active, dispatch]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = localPoint(event);
      dispatch({ type: "hover", point: pointAt(x, y) });
    },
    [dispatch, pointAt]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      pressRef.current = localPoint(event);
    },
    []
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press) return;
      const { x, y } = localPoint(event);
      if (Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD_PX) return;
      const point = pointAt(x, y);
      if (point) dispatch({ type: "place", point });
    },
    [dispatch, pointAt]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      // Un milímetro de papel en muestras: lo que avanza una pulsación con
      // Shift. Es la unidad con la que se lee un ECG.
      const samplesPerMm = sampleRateHz / paperSpeedMmS;
      const step = event.shiftKey ? Math.round(samplesPerMm) : 1;
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          moveCursorBySamples(step);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveCursorBySamples(-step);
          break;
        case "Enter": {
          event.preventDefault();
          const point = sessionRef.current.hover;
          if (point) dispatch({ type: "place", point });
          else moveCursorBySamples(0);
          break;
        }
        case "Escape":
          event.preventDefault();
          dispatch({ type: "clear" });
          break;
      }
    },
    [dispatch, moveCursorBySamples, paperSpeedMmS, sampleRateHz]
  );

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className={styles.overlay}
      width={widthPx}
      height={heightPx}
      role="application"
      aria-label="Medición sobre el trazado congelado"
      tabIndex={0}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => dispatch({ type: "hover", point: null })}
      onKeyDown={handleKeyDown}
    />
  );
}
```

Nota: `Enter` sin cursor llama a `moveCursorBySamples(0)` para materializar el cursor en el inicio de la ventana; la siguiente pulsación ya coloca marca.

- [ ] **Step 5: Montar el overlay en el display**

En `apps/web/src/ui/EcgDisplay.tsx`, añadir `overlay?: ReactNode;` a `EcgDisplayProps` y renderizarlo dentro de un envoltorio posicionado:

```tsx
    <div className={styles.display} ref={containerRef}>
      <div className={styles.grid}>
        {leadColumns.map((leads, index) => (
          <div className={styles.column} key={index}>
            {/* ...LeadStrip igual que antes... */}
          </div>
        ))}
        {overlay}
      </div>
    </div>
```

En `apps/web/src/ui/EcgDisplay.module.css`, añadir:

```css
/* El overlay se posiciona sobre la rejilla de tiras y NO sobre el contenedor
   con su padding: sus dimensiones tienen que coincidir exactamente con las que
   compone la exportación, o habría que reimplementar el layout dos veces. */
.grid {
  position: relative;
  display: flex;
  gap: var(--space-2);
}
```

y mover a `.grid` las propiedades de disposición que hoy tenga `.display`, dejando en `.display` el padding y el fondo.

- [ ] **Step 6: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/ui/MeasureOverlay.test.tsx
```

Esperado: PASS, 4 tests. jsdom no implementa el contexto 2D de canvas, así que sin un stub de `getContext` cada tick del bucle de dibujo escupe `Not implemented: HTMLCanvasElement.prototype.getContext` a stderr — el test pasa igual, pero para mantener la salida limpia se añade el mismo stub que ya usa `ECGWorkspace.test.tsx`: un `beforeEach` con `vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(...)` devolviendo un objeto con los métodos que `drawOverlay` llama, y un `afterEach` con `vi.restoreAllMocks()` (el proyecto no tiene `restoreMocks` en la config de Vitest, así que sin esto el stub se filtraría a otros ficheros de test).

- [ ] **Step 7: Commit**

```bash
git add src/ui/hooks/useMeasure.ts src/ui/MeasureOverlay.tsx src/ui/MeasureOverlay.module.css src/ui/MeasureOverlay.test.tsx src/ui/EcgDisplay.tsx src/ui/EcgDisplay.module.css
git commit -m "feat(web): capa de medicion con raton y teclado sobre el trazado congelado"
```

---

### Task 14: Panel de medición y controles

**Files:**
- Create: `apps/web/src/ui/MeasurePanel.tsx`
- Test: `apps/web/src/ui/MeasurePanel.test.tsx`
- Modify: `apps/web/src/ui/WorkspaceInspector.tsx`
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`
- Test: `apps/web/src/ui/accessibility-contract.test.tsx`

**Interfaces:**
- Consumes: `MeasurementSession`, `TOOLS`, formateadores.
- Produces: `<MeasurePanel session tool snapMode onToolChange onSnapChange />`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/ui/MeasurePanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSession, apply } from "../measure/session";
import { MeasurePanel } from "./MeasurePanel";
import type { MeasurePoint } from "../measure/tools";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

function point(sampleIndex: number, mv: number): MeasurePoint {
  return {
    ringPos: sampleIndex,
    sampleIndex,
    timestampS: sampleIndex / 500,
    voltageV: mv / 1000,
    lead: "II",
  };
}

function sessionWithCaliper() {
  let s = createSession("caliper");
  s = apply(s, { type: "place", point: point(1000, 0) }, CTX);
  return apply(s, { type: "place", point: point(1082, 1.21) }, CTX);
}

function renderPanel(session = createSession("caliper")) {
  const onTool = vi.fn();
  const onSnap = vi.fn();
  render(
    <MeasurePanel session={session} onToolChange={onTool} onSnapChange={onSnap} />
  );
  return { onTool, onSnap };
}

describe("MeasurePanel", () => {
  it("sin medida, invita a medir en vez de mostrar ceros", () => {
    renderPanel();
    expect(screen.getByText(/marca dos puntos/i)).toBeInTheDocument();
  });

  it("publica el resultado del calibrador en el DOM", () => {
    // Es la unica via por la que la medida llega a un lector de pantalla: lo
    // dibujado en canvas no existe para el.
    renderPanel(sessionWithCaliper());

    expect(screen.getByText("164 ms")).toBeInTheDocument();
    expect(screen.getByText("+1.21 mV")).toBeInTheDocument();
    expect(screen.getByText("366 lpm")).toBeInTheDocument();
    expect(screen.getByText("4.1")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
  });

  it("el resultado se anuncia como estado", () => {
    renderPanel(sessionWithCaliper());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("permite cambiar de herramienta", async () => {
    const user = userEvent.setup();
    const { onTool } = renderPanel();

    await user.click(screen.getByRole("radio", { name: "RR" }));

    expect(onTool).toHaveBeenCalledWith("rr");
  });

  it("permite cambiar el modo de enganche", async () => {
    const user = userEvent.setup();
    const { onSnap } = renderPanel();

    await user.click(screen.getByRole("radio", { name: /rejilla/i }));

    expect(onSnap).toHaveBeenCalledWith("grid");
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/ui/MeasurePanel.test.tsx
```

Esperado: FAIL — `Failed to resolve import "./MeasurePanel"`.

- [ ] **Step 3: Escribir el panel**

Crear `apps/web/src/ui/MeasurePanel.tsx`:

```tsx
import { Metric, MetricGrid, SectionTitle, SegmentedControl } from "@ui-system";
import {
  formatBpm,
  formatMs,
  formatMv,
  formatSeconds,
  formatSquares,
} from "../measure/formulas";
import type { MeasurementSession } from "../measure/session";
import type { SnapMode } from "../measure/snap";
import { TOOLS, type ToolId } from "../measure/tools";

const TOOL_OPTIONS = [
  { value: "ruler", label: TOOLS.ruler.label },
  { value: "caliper", label: TOOLS.caliper.label },
  { value: "rr", label: TOOLS.rr.label },
];

const SNAP_OPTIONS = [
  { value: "signal", label: "Señal" },
  { value: "grid", label: "Rejilla" },
  { value: "rpeak", label: "Pico R" },
];

export interface MeasurePanelProps {
  session: MeasurementSession;
  onToolChange: (tool: ToolId) => void;
  onSnapChange: (mode: SnapMode) => void;
}

/** La lectura de la medida, en el DOM.
 *
 * Existe además del rótulo del canvas y no en su lugar: lo dibujado en canvas
 * no existe para un lector de pantalla, y esta es la única vía por la que el
 * resultado llega a quien no ve la pantalla. Por eso el resultado —y no el
 * cursor, que cambia sesenta veces por segundo— es lo que se publica a React. */
export function MeasurePanel({ session, onToolChange, onSnapChange }: MeasurePanelProps) {
  const result = session.result;

  return (
    <>
      <SectionTitle>Medición</SectionTitle>
      <SegmentedControl
        label="Herramienta"
        value={session.tool}
        options={TOOL_OPTIONS}
        onChange={(value) => onToolChange(value as ToolId)}
      />
      <SegmentedControl
        label="Enganche"
        value={session.snapMode}
        options={SNAP_OPTIONS}
        onChange={(value) => onSnapChange(value as SnapMode)}
      />

      {result === null && (
        <p>
          {session.tool === "ruler"
            ? "Marca un punto del trazado para leer su tiempo y voltaje."
            : "Marca dos puntos del trazado para medir la distancia entre ellos."}
        </p>
      )}

      {result?.kind === "cursor" && (
        <MetricGrid role="status">
          <Metric label="Derivación" value={result.lead} />
          <Metric label="t" value={formatSeconds(result.timestampS)} />
          <Metric label="V" value={formatMv(result.voltageV * 1000)} />
        </MetricGrid>
      )}

      {result?.kind === "caliper" && (
        <MetricGrid role="status">
          <Metric label="Δt" value={formatMs(result.readout.deltaMs)} />
          <Metric label="ΔV" value={formatMv(result.readout.deltaMv)} />
          {/* «Equivalente» y no «FC»: son los latidos por minuto que habría si
              todos los intervalos midieran esto, no la frecuencia medida. */}
          <Metric label="Frec. equivalente" value={formatBpm(result.readout.equivalentBpm)} />
          <Metric label="Cuadros pequeños" value={formatSquares(result.readout.smallSquares)} />
          <Metric label="Cuadros grandes" value={formatSquares(result.readout.largeSquares)} />
        </MetricGrid>
      )}
    </>
  );
}
```

Si `MetricGrid` no acepta `role`, envolver cada `MetricGrid` en `<div role="status">…</div>`.

- [ ] **Step 4: Cablear el panel**

**Hueco del plan, resuelto aquí:** la sesión de medición vive dentro de `useMeasure`, que a su vez vive dentro de `MeasureOverlay` (Task 13) — pero el panel de herramientas vive en `WorkspaceInspector`, fuera del overlay. `onResultChange` solo informa hacia afuera de los cambios fríos; no hay ningún camino de vuelta para que el panel le diga a la sesión "cambia de herramienta". Sin resolver esto, los botones de `MeasurePanel` quedarían conectados a nada.

La solución: `MeasureOverlay` pasa a ser un `forwardRef` que expone un asa imperativa mínima:

```tsx
export interface MeasureOverlayHandle {
  setTool: (tool: ToolId) => void;
  setSnapMode: (mode: SnapMode) => void;
}

export const MeasureOverlay = forwardRef<MeasureOverlayHandle, MeasureOverlayProps>(
  function MeasureOverlay({ active, layout, sampleRateHz, paperSpeedMmS, theme, view, magnifier, getSource, onResultChange }, handleRef) {
    // ...igual que antes, pero desestructurando tambien setTool y setSnapMode de useMeasure...
    useImperativeHandle(handleRef, () => ({ setTool, setSnapMode }), [setTool, setSnapMode]);
    // ...resto sin cambios...
  }
);
```

En `apps/web/src/ui/WorkspaceInspector.tsx`, añadir a los props `measureSession: MeasurementSession | null`, `onToolChange`, `onSnapChange`, y renderizar `<MeasurePanel .../>` **antes** del `MetricGrid` de las medidas del servidor cuando `measureSession` no sea `null`.

En `apps/web/src/ui/ECGWorkspace.tsx`:

```tsx
  const measureOverlayRef = useRef<MeasureOverlayHandle>(null);
  const [measureSession, setMeasureSession] = useState<MeasurementSession | null>(null);

  const handleToolChange = useCallback((tool: ToolId) => {
    measureOverlayRef.current?.setTool(tool);
  }, []);
  const handleSnapChange = useCallback((mode: SnapMode) => {
    measureOverlayRef.current?.setSnapMode(mode);
  }, []);
```

pasar `ref={measureOverlayRef}` y `onResultChange={setMeasureSession}` a `<MeasureOverlay />`, `measureSession={isFrozen ? measureSession : null}`, `onToolChange={handleToolChange}` y `onSnapChange={handleSnapChange}` a `<WorkspaceInspector />`, y montar el overlay vía el prop `overlay` de `EcgDisplay`. La `view` para esta tarea (antes del zoom de la Task 15) es el anillo entero: `{ startRingPos: 0, visibleSamples: Math.round(metrics.stripSeconds * sampleRateHz) }` — la misma cuenta con la que `sweepCapacitySamples` dimensiona el anillo, así que coinciden sin tener que exponer la capacidad real antes de que exista una muestra escrita.

- [ ] **Step 5: Extender el contrato de accesibilidad**

**Desviación del plan:** `accessibility-contract.test.tsx` usa una `SilentSocket` que no implementa `dispatch` — nunca llega a `started`, así que no hay forma de congelar dentro de ese fichero sin ampliar esa clase, lo que sería alcance añadido fuera de esta tarea. En su lugar, la comprobación de rol y nombre accesible se añade al test que ya existe en `ECGWorkspace.test.tsx` ("el indicador de congelado aparece al pulsar..."), que sí usa `FakeWebSocket` con `dispatch` y ya deja la sesión congelada:

```tsx
    expect(screen.getByText(/trazado congelado/i)).toBeInTheDocument();
    expect(fakeSocket.sentMessages.some((m) => m.includes('"pause"'))).toBe(true);
    // La superficie de medicion solo existe congelado: lo dibujado en canvas
    // no existe para un lector de pantalla, y este rol y nombre son la unica
    // via por la que sabe que hay algo interactivo ahi.
    expect(
      screen.getByRole("application", { name: /medición sobre el trazado/i })
    ).toBeInTheDocument();
```

`accessibility-contract.test.tsx` no se toca.

- [ ] **Step 6: Ejecutar la suite entera**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/MeasurePanel.tsx src/ui/MeasurePanel.test.tsx src/ui/WorkspaceInspector.tsx src/ui/ECGWorkspace.tsx src/ui/accessibility-contract.test.tsx
git commit -m "feat(web): panel de medicion en el inspector, con herramienta y enganche"
```

---

### Task 15: Zoom temporal y desplazamiento

**Files:**
- Create: `apps/web/src/measure/zoom.ts`
- Test: `apps/web/src/measure/zoom.test.ts`
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`
- Modify: `apps/web/src/ui/hooks/useSweepRenderer.ts`

**Interfaces:**
- Produces: `PAPER_SPEEDS_MM_S = [25, 50, 100]`; `nextPaperSpeed(current, direction)`; `viewFor(capacity, visibleSamples, startRingPos)`; `clampStart(start, visibleSamples, capacity, writtenCount)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/measure/zoom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampStart, nextPaperSpeed, PAPER_SPEEDS_MM_S } from "./zoom";

describe("nextPaperSpeed", () => {
  it("sube por los escalones de un electrocardiografo", () => {
    expect(nextPaperSpeed(25, 1)).toBe(50);
    expect(nextPaperSpeed(50, 1)).toBe(100);
  });

  it("no pasa del ultimo escalon", () => {
    expect(nextPaperSpeed(100, 1)).toBe(100);
  });

  it("baja y se detiene en la velocidad de referencia", () => {
    expect(nextPaperSpeed(50, -1)).toBe(25);
    expect(nextPaperSpeed(25, -1)).toBe(25);
  });

  it("los escalones son los del equipo real", () => {
    expect(PAPER_SPEEDS_MM_S).toEqual([25, 50, 100]);
  });
});

describe("clampStart", () => {
  it("con el anillo lleno se puede recorrer todo", () => {
    expect(clampStart(3000, 1250, 5000, 5000)).toBe(3000);
  });

  it("no deja pasar del final del anillo lleno", () => {
    expect(clampStart(4500, 1250, 5000, 5000)).toBe(3750);
  });

  it("no deja empezar antes del origen", () => {
    expect(clampStart(-100, 1250, 5000, 5000)).toBe(0);
  });

  it("con el anillo a medias, el limite es lo escrito", () => {
    // La zona nunca escrita no se puede medir: dejar entrar ahi mostraria una
    // linea plana que parece señal y no lo es.
    expect(clampStart(1500, 1250, 5000, 2000)).toBe(750);
  });

  it("si lo escrito no llena la ventana, se empieza en el origen", () => {
    expect(clampStart(500, 1250, 5000, 800)).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/measure/zoom.test.ts
```

Esperado: FAIL — `Failed to resolve import "./zoom"`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/web/src/measure/zoom.ts`:

```ts
import { REFERENCE_PAPER_SPEED_MM_S } from "../render/layout-engine";

/** Velocidades de un electrocardiógrafo. Escalones y no una escala continua:
 * el número que aparece en pantalla tiene que ser uno que el alumno reconozca
 * cuando se ponga delante de una máquina. */
export const PAPER_SPEEDS_MM_S = [25, 50, 100] as const;

export function nextPaperSpeed(current: number, direction: 1 | -1): number {
  const index = PAPER_SPEEDS_MM_S.indexOf(current as (typeof PAPER_SPEEDS_MM_S)[number]);
  const from = index < 0 ? 0 : index;
  const next = Math.min(PAPER_SPEEDS_MM_S.length - 1, Math.max(0, from + direction));
  return PAPER_SPEEDS_MM_S[next];
}

/** Dónde puede empezar la ventana visible.
 *
 * El anillo no cambia de tamaño al hacer zoom: se enseña un trozo. El límite
 * superior es lo escrito, no la capacidad — la zona que nunca se ha escrito
 * pintaría una línea plana que parece señal. */
export function clampStart(
  start: number,
  visibleSamples: number,
  capacity: number,
  writtenCount: number
): number {
  const available = Math.min(capacity, writtenCount);
  const maxStart = Math.max(0, available - visibleSamples);
  return Math.min(maxStart, Math.max(0, Math.round(start)));
}

export function isReferenceSpeed(paperSpeedMmS: number): boolean {
  return paperSpeedMmS === REFERENCE_PAPER_SPEED_MM_S;
}
```

- [ ] **Step 4: Cablear el zoom**

En `apps/web/src/ui/ECGWorkspace.tsx`, sustituir la constante `PAPER_SPEED_MM_S` por estado:

```tsx
  // El zoom es una herramienta de congelado: en marcha, la ventana visible es
  // donde escribe el barrido y cambiarla a mitad de escritura deja el cursor
  // fuera de pantalla. Al reanudar se vuelve a la velocidad de referencia.
  const [paperSpeedMmS, setPaperSpeedMmS] = useState<number>(REFERENCE_PAPER_SPEED_MM_S);
  const [viewStartRingPos, setViewStartRingPos] = useState(0);
```

En `toggleFreeze`, al descongelar: `setPaperSpeedMmS(REFERENCE_PAPER_SPEED_MM_S); setViewStartRingPos(0);`

Pasar `paperSpeedMmS` a `useLayoutMetrics`. Calcular la ventana:

```tsx
  const visibleSamples = Math.round(metrics.stripSeconds * sampleRateHz);
  const view = { startRingPos: viewStartRingPos, visibleSamples };
```

Añadir el manejador de rueda sobre el contenedor del ECG, activo solo congelado:

```tsx
  const handleWheel = (event: React.WheelEvent) => {
    if (!isFrozen) return;
    event.preventDefault();
    setPaperSpeedMmS((current) => nextPaperSpeed(current, event.deltaY < 0 ? 1 : -1));
  };
```

Y el desplazamiento por arrastre. En `ECGWorkspace.tsx`:

```tsx
  const handlePan = useCallback(
    (deltaSamples: number) => {
      const source = getMeasureSource();
      if (!source) return;
      setViewStartRingPos((start) =>
        clampStart(
          start - deltaSamples,
          visibleSamples,
          source.capacity,
          source.indexRing.writtenCount
        )
      );
    },
    [getMeasureSource, visibleSamples]
  );
```

pasado como `onPan={handlePan}` a `<MeasureOverlay />`. En `MeasureOverlay.tsx`, añadir `onPan: (deltaSamples: number) => void;` a los props y sustituir `handlePointerMove` por:

```tsx
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = localPoint(event);
      const press = pressRef.current;

      // Arrastrar desplaza, un clic coloca marca. Distinguirlos por el
      // movimiento —y no por un modo que haya que activar— es lo que permite
      // que el mismo botón haga las dos cosas sin ambigüedad.
      if (press && Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD_PX) {
        const pps = pxPerSample(layout.metrics, sampleRateHz);
        onPan(Math.round((x - press.x) / pps));
        pressRef.current = { x, y };
        return;
      }

      dispatch({ type: "hover", point: pointAt(x, y) });
    },
    [dispatch, layout.metrics, onPan, pointAt, sampleRateHz]
  );
```

añadiendo el import de `pxPerSample` desde `../render/measure-geometry`. `handlePointerUp` no cambia: si hubo arrastre, `pressRef` se ha ido moviendo y la distancia contra la posición actual queda por debajo del umbral, pero el punto ya se ha consumido — para que no coloque marca al final de un arrastre, marcar el arrastre con una bandera:

```tsx
  const draggedRef = useRef(false);
```

puesta a `false` en `handlePointerDown`, a `true` en la rama de arrastre de `handlePointerMove`, y consultada al principio de `handlePointerUp`:

```tsx
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
```

Pasar `view` a `useSweepRenderer` y usarla en la llamada a `rebuilder.rebuild(...)` del efecto de repintado completo, y añadir `view.startRingPos` y `view.visibleSamples` a las dependencias de ese efecto.

- [ ] **Step 5: Ejecutar la suite entera**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 6: Comprobación manual**

```bash
npm run dev
```

Elegir un ritmo, pulsar Congelar y girar la rueda sobre el trazado. Comprobar: la rejilla **no cambia de tamaño**, la barra de estado pasa de `25 mm/s · 10 s/tira` a `50 mm/s · 5 s/tira` y a `100 mm/s · 2.5 s/tira`, y arrastrando se recorren los diez segundos. Al reanudar vuelve a 25 mm/s.

- [ ] **Step 7: Commit**

```bash
git add src/measure/zoom.ts src/measure/zoom.test.ts src/ui/ECGWorkspace.tsx src/ui/MeasureOverlay.tsx src/ui/hooks/useSweepRenderer.ts
git commit -m "feat(web): zoom por velocidad de papel y desplazamiento sobre el congelado"
```

---

### Task 16: Lupa

**Files:**
- Modify: `apps/web/src/render/overlay-layer.ts`
- Test: `apps/web/src/render/overlay-layer.test.ts`
- Modify: `apps/web/src/ui/WorkspaceHeader.tsx`, `apps/web/src/ui/ECGWorkspace.tsx`

**Interfaces:**
- Produces: `MAGNIFIER_WIDTH_PX = 180`, `MAGNIFIER_HEIGHT_PX = 120`, `MAGNIFIER_FACTOR = 4`; `OverlayFrame` gana `sweeps: ReadonlyMap<LeadName, SweepBuffer>`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/web/src/render/overlay-layer.test.ts` (y añadir `sweeps` a `frameWith`, construyéndolo con un `SweepBuffer` de `CAPACITY` relleno de ceros):

```ts
describe("lupa", () => {
  it("apagada no dibuja nada extra", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: false });

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("encendida dibuja su marco y su rotulo de aumento", () => {
    // El rotulo no es decoracion: una lupa sin declarar su escala invita a
    // contar cuadros sobre una rejilla que no es la de la pantalla.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: true });

    expect(ctx.fillRect).toHaveBeenCalled();
    const textos = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(textos).toContain("×4");
  });

  it("sin cursor no hay lupa", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, { ...frameWith(createSession("caliper")), magnifier: true });

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/render/overlay-layer.test.ts
```

Esperado: FAIL — la lupa no se dibuja.

- [ ] **Step 3: Escribir la implementación**

En `apps/web/src/render/overlay-layer.ts`, añadir a `OverlayFrame` el campo `sweeps: ReadonlyMap<LeadName, SweepBuffer>;`, las constantes y la función, y llamarla al final de `drawOverlay` cuando `frame.magnifier && hover`:

```ts
export const MAGNIFIER_WIDTH_PX = 180;
export const MAGNIFIER_HEIGHT_PX = 120;
export const MAGNIFIER_FACTOR = 4;
const MAGNIFIER_MARGIN_PX = 12;

/** Ventana ampliada alrededor del cursor, dibujada DESDE EL ANILLO.
 *
 * No es un escalado de los píxeles del canvas: a la escala de referencia cada
 * píxel contiene unas seis muestras, así que ampliar la imagen ampliaría el
 * aliasing en vez de recuperar la señal. Aquí se vuelve a dibujar la señal a
 * otra escala, que es lo que enseña algo que en la vista normal no está.
 *
 * Lleva rejilla propia y rótulo de aumento: una lupa que no declara su escala
 * invita a contar cuadros sobre una rejilla que no es la de la pantalla, que
 * es justo el error que este proyecto persigue. Los números del calibrador
 * salen siempre de las muestras, nunca de lo que se ve aquí. */
function drawMagnifier(
  ctx: CanvasRenderingContext2D,
  hover: MeasurePoint,
  frame: OverlayFrame,
  pps: number,
  widthPx: number,
  heightPx: number
): void {
  const sweep = frame.sweeps.get(hover.lead);
  const position = locate(hover, frame);
  if (!sweep || !position) return;

  const cursorX = position.left + ringPosToPx(hover.ringPos, frame.view, pps, frame.capacity);
  // Al lado opuesto del cursor, y volteada cerca de los bordes: la lupa no
  // puede tapar justo lo que se está mirando.
  const left = cursorX + MAGNIFIER_MARGIN_PX + MAGNIFIER_WIDTH_PX > widthPx
    ? cursorX - MAGNIFIER_MARGIN_PX - MAGNIFIER_WIDTH_PX
    : cursorX + MAGNIFIER_MARGIN_PX;
  const top = Math.min(
    Math.max(0, position.top),
    heightPx - MAGNIFIER_HEIGHT_PX
  );

  ctx.fillStyle = frame.theme.background;
  ctx.fillRect(left, top, MAGNIFIER_WIDTH_PX, MAGNIFIER_HEIGHT_PX);

  const zoomPxPerSample = pps * MAGNIFIER_FACTOR;
  const zoomPxPerMm = frame.layout.metrics.viewportScalePxPerMm * MAGNIFIER_FACTOR;
  const samples = Math.round(MAGNIFIER_WIDTH_PX / zoomPxPerSample);
  const centerY = top + MAGNIFIER_HEIGHT_PX / 2;

  // Rejilla propia, a la escala propia.
  ctx.strokeStyle = frame.theme.gridMinor;
  ctx.lineWidth = 0.5;
  for (let mm = 0; mm * zoomPxPerMm <= MAGNIFIER_WIDTH_PX; mm++) {
    const x = left + mm * zoomPxPerMm;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + MAGNIFIER_HEIGHT_PX);
    ctx.stroke();
  }

  ctx.strokeStyle = frame.theme.trace;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= samples; i++) {
    const ringPos = ((hover.ringPos - samples / 2 + i) % frame.capacity + frame.capacity) % frame.capacity;
    const x = left + i * zoomPxPerSample;
    const y = centerY - voltageToPx(sweep.at(ringPos), frame.layout.metrics) * MAGNIFIER_FACTOR;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = frame.theme.trace;
  ctx.font = `${CURSOR_LABEL_PX}px monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`×${MAGNIFIER_FACTOR}`, left + 4, top + 4);
}
```

Añadir los imports de `LeadName` y `SweepBuffer`, y en `MeasureOverlay.tsx` pasar `sweeps: source.sweeps` al `drawOverlay`.

- [ ] **Step 4: Añadir el conmutador**

En `WorkspaceHeader.tsx`, añadir un `IconButton` con `icon="search"`, `label="Lupa"`, `active={magnifier}`, `disabled={!isFrozen}` y su `onToggleMagnifier`. En `ECGWorkspace.tsx`, el estado `const [magnifier, setMagnifier] = useState(false);` pasado a `<MeasureOverlay magnifier={magnifier} />` y puesto a `false` al descongelar.

Si `Icon` no tiene un glifo `search`, usar el que exista más cercano de los ya definidos en `packages/ui-system/components/foundation/Icon.tsx` — no se añaden componentes nuevos al sistema de diseño.

- [ ] **Step 5: Ejecutar y comprobar que pasa**

```bash
npx vitest run src/render/overlay-layer.test.ts && npm test
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/overlay-layer.ts src/render/overlay-layer.test.ts src/ui/WorkspaceHeader.tsx src/ui/ECGWorkspace.tsx src/ui/MeasureOverlay.tsx
git commit -m "feat(web): lupa dibujada desde el anillo, con rejilla y aumento declarados"
```

---

### Task 17: Exportar la captura con las marcas

**Files:**
- Modify: `apps/web/src/ui/hooks/useSweepRenderer.ts` (`composeSnapshot`)
- Modify: `apps/web/src/ui/ECGWorkspace.tsx`
- Test: `apps/web/src/ui/hooks/useSweepRenderer.test.tsx` (crear)

**Interfaces:**
- Produces: `SnapshotOptions` gana `overlay?: HTMLCanvasElement | null` y `readout?: readonly string[]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/ui/hooks/useSweepRenderer.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { composeSnapshotLines } from "./useSweepRenderer";
import { createSession, apply } from "../../measure/session";
import type { MeasurePoint } from "../../measure/tools";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

function point(sampleIndex: number, mv: number): MeasurePoint {
  return {
    ringPos: sampleIndex,
    sampleIndex,
    timestampS: sampleIndex / 500,
    voltageV: mv / 1000,
    lead: "II",
  };
}

describe("composeSnapshotLines", () => {
  it("sin medida no estampa nada", () => {
    expect(composeSnapshotLines(null)).toEqual([]);
  });

  it("estampa la lectura del calibrador", () => {
    // Un PNG con dos marcas y ningun numero obliga a volver a medir sobre la
    // imagen, que es justo lo que se acaba de hacer.
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000, 0) }, CTX);
    s = apply(s, { type: "place", point: point(1082, 1.21) }, CTX);

    expect(composeSnapshotLines(s)).toEqual([
      "Δt 164 ms",
      "ΔV +1.21 mV",
      "366 lpm",
    ]);
  });

  it("estampa la lectura de la regla", () => {
    const s = apply(createSession("ruler"), { type: "place", point: point(1157, 0.84) }, CTX);
    expect(composeSnapshotLines(s)).toEqual(["II", "2.314 s", "+0.84 mV"]);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```bash
npx vitest run src/ui/hooks/useSweepRenderer.test.tsx
```

Esperado: FAIL — `composeSnapshotLines` no está exportada.

- [ ] **Step 3: Escribir la implementación**

En `apps/web/src/ui/hooks/useSweepRenderer.ts`, exportar:

```ts
/** Las líneas de texto que acompañan a la captura.
 *
 * Se compone aquí y no en el canvas para poder probarla sin canvas, y para que
 * salga de las mismas funciones de formato que el panel y el rótulo: si
 * divergieran, la imagen exportada diría un número distinto del que se vio. */
export function composeSnapshotLines(session: MeasurementSession | null): string[] {
  const result = session?.result;
  if (!result) return [];
  if (result.kind === "cursor") {
    return [result.lead, formatSeconds(result.timestampS), formatMv(result.voltageV * 1000)];
  }
  return [
    `Δt ${formatMs(result.readout.deltaMs)}`,
    `ΔV ${formatMv(result.readout.deltaMv)}`,
    formatBpm(result.readout.equivalentBpm),
  ];
}
```

Añadir a `SnapshotOptions`:

```ts
  /** El canvas de overlay, tal cual. Se dimensiona exactamente a la rejilla de
   * tiras, así que entra con un solo `drawImage` en (0,0) y no hay que
   * reimplementar el layout una segunda vez. */
  overlay?: HTMLCanvasElement | null;
  /** Lectura de la medida, estampada bajo el sello temporal. */
  readout?: readonly string[];
```

Y en `composeSnapshot`, tras el bucle de `leadColumns` y antes del sello:

```ts
      if (options.overlay) {
        ctx.drawImage(options.overlay, 0, 0);
      }
```

y después del sello:

```ts
      if (options.readout?.length) {
        ctx.fillStyle = theme.text.muted;
        ctx.font = `${SNAPSHOT_LABEL_PX}px monospace`;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        options.readout.forEach((line, index) => {
          ctx.fillText(
            line,
            out.width - SNAPSHOT_PADDING_PX,
            SNAPSHOT_PADDING_PX / 2 + (index + 1) * (SNAPSHOT_LABEL_PX + 2)
          );
        });
      }
```

- [ ] **Step 4: Cablear la exportación**

En `MeasureOverlay.tsx`, aceptar un prop `canvasRefCallback?: (element: HTMLCanvasElement | null) => void` y llamarlo desde el `ref` del canvas, además de guardar la referencia local. En `ECGWorkspace.tsx`:

```tsx
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const snapshotWithStamp = useCallback(
    () =>
      composeSnapshot({
        stamp: clock,
        overlay: overlayCanvasRef.current,
        readout: composeSnapshotLines(measureSession),
      }),
    [composeSnapshot, clock, measureSession]
  );
```

- [ ] **Step 5: Ejecutar la suite entera**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 6: Comprobación manual de extremo a extremo**

```bash
npm run dev
```

Elegir un ritmo, congelar, colocar dos marcas sobre dos R con enganche a pico R, comprobar que el panel muestra `Δt`, `ΔV`, `lpm` y los cuadros, exportar el PNG y comprobar que la imagen lleva **las marcas y los números**.

- [ ] **Step 7: Commit**

```bash
git add src/ui/hooks/useSweepRenderer.ts src/ui/hooks/useSweepRenderer.test.tsx src/ui/MeasureOverlay.tsx src/ui/ECGWorkspace.tsx
git commit -m "feat(web): la captura exportada lleva las marcas y la lectura"
```

---

## Cierre de la fase

- [ ] **Suite completa en verde**

```bash
npm test
```

- [ ] **Compilación de tipos**

```bash
npm run build
```

- [ ] **Repaso de la especificación**

Comprobar contra `docs/superpowers/specs/2026-08-06-ecg-medicion-congelado-design.md` que están las once herramientas de E1: cursor sincronizado, regla, calibrador, Δt, ΔV, snap a rejilla, snap a pico R, zoom temporal, lupa, congelar y seguir midiendo, exportar con marcas.

- [ ] **Lo que NO entra en esta fase**, y debe seguir sin entrar: varios calibradores a la vez, zoom vertical, zoom en marcha, medición entre derivaciones, autoevaluación, exportación a PDF o vídeo. Y ninguna detección fisiológica en el cliente: el modo pico R es una ayuda a la interacción y así está documentado.
