# Medición sobre el ECG congelado — Diseño

**Fecha:** 2026-08-06
**Estado:** propuesto, pendiente de aprobación
**Alcance:** capa de medición e interacción en `apps/web` (fase E1) y contrato de anotaciones fisiológicas motor → API → frontend (fase F2, aquí solo se diseña).

---

## 1. Qué se construye

Hoy, cuando el usuario pulsa **Congelar**, el trazado se queda quieto y ahí termina todo: lo que hay en pantalla es una imagen. Este documento convierte esa imagen en algo que se puede leer — un ECG sobre el que se mide, se cuenta cuadros y se señala una onda con el dedo.

El cambio de fondo no son las herramientas, es lo que hay debajo de ellas. Un trazado congelado se vuelve medible cuando existe un **sistema de coordenadas** que va del píxel a la muestra, de la muestra al instante de simulación y del instante al voltaje. Ese sistema no existe todavía: `SweepBuffer` guarda muestras sin tiempo, y la conversión índice → píxel vive repartida entre `lead-canvas.ts` y `sweep-rebuilder.ts` como aritmética suelta. Construirlo es el 70% del trabajo; las herramientas que se apoyan encima son casi consecuencias.

## 2. La decisión que ordena todo el documento

El repositorio ya tiene una regla escrita, en `measuring.py:5`:

> El frontend nunca calcula un intervalo ni corrige un QT — recibe milisegundos y los pinta.

Esa regla no se toca. Pero hay que afinar qué cae dentro:

| Lo que hace el usuario | Quién posee la verdad | Por qué |
|---|---|---|
| Poner dos marcas y leer la distancia | **El frontend** | Una regla no diagnostica. Mide lo que el usuario señala, y si señala mal, mide mal: eso es exactamente lo que se quiere enseñar. |
| Que el sistema diga dónde empieza el QRS | **El motor** | Eso ya es una afirmación fisiológica. Detectarla con picos sobre señal con ruido sería inventar una segunda verdad, distinta de la que el motor generó. |

De ahí salen dos consecuencias que gobiernan el resto:

1. **La regla y el calibrador son frontend puro.** No necesitan al motor, y por eso pueden entregarse ya.
2. **Resaltar una onda, pintar el bracket del PR o saltar al latido siguiente exige que el motor lo diga.** No se aproximan en el cliente ni «provisionalmente»: una aproximación provisional en algo docente enseña a medir mal, que es peor que no medir.

## 3. Dos fases

### Fase E1 — Herramientas de análisis (100% frontend)

Convierte el congelado en una estación de trabajo. No toca motor ni API.

Cursor sincronizado sobre todas las derivaciones · regla temporal y de voltaje · calibrador de dos puntos con Δt, ΔV, frecuencia equivalente y cuadros · snap a señal, a rejilla y a pico R · zoom temporal 25/50/100 mm/s · lupa · exportación de la captura con las marcas puestas.

### Fase F2 — Anotaciones fisiológicas (motor + API + frontend)

El motor empieza a publicar los fiduciales de cada latido. Con eso, y **reutilizando exactamente la infraestructura gráfica de E1**, aparecen: resaltado de ondas, brackets automáticos de PR/QRS/QT, paso a paso por latido, modo interpretación, inspector clínico y sincronización con el corazón 3D de la fase D.

Este documento especifica E1 al completo y **fija el contrato de F2** (§10) para que E1 no se construya de espaldas a él.

---

# Fase E1

## 4. Arquitectura

### 4.1 El eje de tiempo que hoy falta

`FrameBuffer.consumeNewSamples()` devuelve un `Float32Array` de muestras y tira a la basura el `tStartS` que venía en la cabecera del frame (`frame-decoder.ts:27`). A partir de ahí nadie sabe qué instante es cada muestra del anillo.

**`TimeIndex`** — un anillo de `Float64Array`, misma capacidad que los `SweepBuffer`, con el instante de simulación de cada posición.

Tres decisiones, y las tres importan:

- **Uno solo, no doce.** Las doce derivaciones se escriben en el mismo tick desde el mismo trozo multicanal: comparten eje de tiempo por construcción. Un `TimeIndex` por derivación sería doce copias del mismo dato con doce oportunidades de desincronizarse. Se lee una vez por tick, igual que `justConsumedHadGap`.
- **Un valor por muestra, no anclas por trozo.** Con capacidad ~5000 son 40 KB en total y un bucle de ~50 iteraciones por tick — nada al lado de doce trazos de canvas. La alternativa (guardar `(ringIndex, tStart)` por trozo y buscar por bisección al leer) ahorra 39 KB y añade una búsqueda binaria en el camino del puntero. No compensa.
- **`Float64`, no `Float32`.** Una guardia larga llega a miles de segundos; en `Float32` la resolución ahí ya no distingue milisegundos.

Los huecos —pérdida de frame o descarte por overrun— no rompen nada: cada muestra lleva su instante real, así que un salto temporal en el anillo se lee como tal en lugar de deducirse de un contador que asumiría continuidad.

`FrameBuffer` gana un método espejo del que ya tiene:

```ts
/** Instantes de simulación de las muestras desalojadas por el último
 * `advance()`, en el mismo orden que `consumeNewSamples()`. */
consumedSampleTimes(): Float64Array
```

### 4.2 Geometría de medida

Módulo nuevo `render/measure-geometry.ts`, puro, sin DOM. Recoge la aritmética que hoy está duplicada y añade las inversas:

```
ringIndexToPx(i, metrics, sampleRateHz) → x
pxToRingIndex(x, metrics, sampleRateHz) → i     (redondeo a la muestra más cercana)
voltageToPx(v, metrics)                          (ya existe en grid-layer.ts)
pxToVoltage(y, stripHeightPx, metrics) → v
hitTest(xPx, yPx, layout) → { lead, column, row, xInStrip, yInStrip } | null
```

Un número que conviene tener presente porque justifica media sección de este documento: con una tira de 800 px, 10 s y 25 mm/s, la escala es 3,2 px/mm y **cada píxel contiene ~6 muestras**. La pantalla tira 6 de cada 7 muestras. Por eso el snap a señal no es un adorno, y por eso la lupa enseña algo que en la vista normal no está.

### 4.3 Una sola capa de overlay, sobre todo el display

`lead-canvas.ts:119` ya reserva el hueco (`class OverlayLayer`, «cursores, calipers»). Se implementa, pero **no como un tercer canvas por tira**: como **un único canvas absoluto sobre toda la rejilla de tiras**.

El motivo es el cursor sincronizado. La línea vertical tiene que cruzar las doce derivaciones; con un canvas por tira habría que coordinar doce dibujos para pintar una sola línea. Con uno solo es una línea.

Dimensiones exactas: las de la rejilla de tiras, no las del contenedor con su padding —

```
ancho  = stripWidthPx * columns + COLUMN_GAP_PX * (columns - 1)
alto   = stripHeightPx * rows   + STRIP_GAP_PX  * (rows - 1)
```

que son exactamente las que compone `composeSnapshot`. Con eso, exportar las marcas es un `drawImage` en (0,0) y no una segunda implementación del layout (§5.6).

**Las columnas muestran el mismo instante** (`EcgDisplay.tsx:15`). Un cursor en el instante *t* se dibuja, por tanto, como una línea vertical **por columna**, todas al mismo desplazamiento dentro de su tira. En vista de una columna es una línea; en `6x2` son dos.

El canvas de trazo no se toca. Dibujar cursores encima lo borraría la banda de barrido y rompería la premisa de `SweepRebuilder` de que ese canvas contiene solo trazo.

### 4.4 La puerta: cuándo está realmente congelado

`runtime.pause()` detiene la generación en el servidor, pero el cliente sigue drenando lo que le queda en `FrameBuffer` — hasta 0,7 s. Durante esos instantes el anillo aún cambia.

La capa de medición se activa cuando se cumplen **las dos** condiciones:

```
store.connectionState === "paused"   &&   runtime.buffer.isUnderrun
```

Es también el momento correcto para mostrar «Trazado congelado», que hoy aparece antes de que el trazo se pare de verdad.

Al reanudar: se borran calibrador y cursor, la velocidad de papel vuelve a 25 mm/s y el overlay deja de recibir puntero. Las mediciones no sobreviven porque el anillo que describen se está sobrescribiendo; conservar los números sería conservar una referencia a un trazado que ya no está.

**Región medible.** Si la sesión lleva menos de 10 s, el anillo está a medias: solo `[0, writeCursor)` tiene señal. Fuera de ahí no hay cursor ni se puede colocar una marca. La zona no escrita se atenúa en el overlay para que el límite se vea, en lugar de descubrirse al no poder hacer clic.

---

## 5. Las herramientas

### 5.1 Cursor y regla

Línea vertical (cruza todas las tiras y todas las columnas) y línea horizontal (solo dentro de la tira activa: el voltaje es de una derivación concreta). Junto al cursor, un rótulo dibujado en el canvas:

```
II
t = 2.315 s
V = +0.84 mV
```

- **`t` es tiempo de simulación desde el inicio de la sesión**, no hora de reloj. El rótulo del panel lo dice; el número, por sí solo, no puede decirlo.
- **`V` es respecto a la línea de 0 mV de la tira**, que es donde el motor pone la isoeléctrica. La amplitud respecto a la isoeléctrica *del latido* —lo que hace falta para medir un ST— **no es esta herramienta, es el calibrador**: se pone el punto A sobre el segmento TP y el punto B en el punto J, y el ΔV que sale es la elevación real. Así se mide en papel y así se enseña aquí.
- Tres decimales en `t` (la muestra cae en la rejilla de 2 ms a 500 Hz), dos en `V`, con signo siempre explícito.

El rótulo se coloca al lado opuesto del cursor respecto al borde más cercano, para no tapar justo lo que se está mirando.

### 5.2 Calibrador de dos puntos

Clic → punto A. Clic → punto B. Se lee:

```
Δt = 164 ms
ΔV = 1.21 mV
Frecuencia equivalente = 366 lpm

4.1 cuadros pequeños
0.82 cuadros grandes
```

Aritmética, explícita para que no se reinvente en tres sitios:

| Magnitud | Fórmula |
|---|---|
| Δt (ms) | `(t_B − t_A) × 1000`, valor absoluto |
| ΔV (mV) | `V_B − V_A`, con signo |
| Frecuencia equivalente (lpm) | `60 / Δt_s` |
| Cuadros pequeños | `Δt_s × paperSpeedMmS` (1 mm = 1 cuadro pequeño) |
| Cuadros grandes | cuadros pequeños `/ 5` |
| Altura en cuadros | `ΔV_mV × clinicalGainMmPerMv` |

Comprobación con el ejemplo: 0,164 s × 25 mm/s = 4,1 mm → 4,1 cuadros pequeños → 0,82 grandes. 60/0,164 = 366 lpm. Y con RR = 860 ms, 60/0,86 = 69,8 lpm.

Los cuadros se derivan de la **velocidad de papel vigente**, no de la constante 25: con el zoom a 50 mm/s el mismo intervalo ocupa el doble de cuadros en pantalla, y decir lo contrario sería mentir sobre lo que se está viendo.

**Un calibrador a la vez.** Se coloca, se lee, se sustituye. Varios calibradores fijados simultáneamente es una función de estación de trabajo profesional que aquí no aporta —el flujo real es medir un intervalo, apuntarlo mentalmente y medir el siguiente— y multiplicaría el estado de la interacción por poco a cambio. Queda fuera de alcance, no descartada.

**El «RR continuo» no es una herramienta aparte.** Es este mismo calibrador con snap a pico R. Dos clics sobre dos R dan Δt = RR y la frecuencia equivalente, que es literalmente lo que se pedía. Añadir un modo RR separado sería duplicar la máquina de estados para renombrar su salida.

Los dos puntos son arrastrables después de colocados: nadie acierta a la primera y volver a empezar por 3 ms de error es innecesario.

### 5.3 Snap

Control segmentado con tres modos. Afecta a dónde caen las marcas y el cursor:

| Modo | Qué hace | Para qué |
|---|---|---|
| **Señal** (por defecto) | La marca cae en la muestra más cercana en X, y en Y **sobre el valor de la señal** en ese instante | Nunca se mide el fondo. Amplitudes y ST salen del trazo real, no de dónde tembló la mano |
| **Rejilla** | La marca cae en el vértice de milímetro más cercano | Es como se lee en papel: contando cuadros |
| **Pico R** | Busca el máximo en valor absoluto dentro de ±150 ms del cursor, en la derivación activa | Medir RR sin cazar píxeles |

El modo **Pico R** de E1 es una ayuda a la interacción, **no una medida clínica**: es un máximo local, no una detección de QRS. Condiciones para que enganche —y si no se cumplen, no engancha y se dice, en lugar de saltar a cualquier sitio:

- máxima desviación absoluta respecto a 0 mV dentro de la ventana,
- que supere 0,25 mV,
- que sea máximo local (mayor que sus vecinos inmediatos).

En F2 este modo pasa a usar el fiducial `qrs.r` que publica el motor, y deja de ser una heurística. La interfaz no cambia; cambia de dónde sale el número.

### 5.4 Zoom temporal: velocidad de papel real

Rueda del ratón sobre el trazado: 25 → 50 → 100 mm/s. Lo que cambia es la velocidad de papel, **no el tamaño de la rejilla**: el cuadro pequeño sigue midiendo un milímetro en pantalla y sigue valiendo 1/velocidad segundos. A 50 mm/s se ve la mitad de tiempo, exactamente como en un electrocardiógrafo.

Un zoom óptico —ampliar todo, rejilla incluida— sería más fácil y estropearía lo único que este simulador hace bien y que muchos hacen mal: que contar cuadros sea exacto (`layout-engine.ts:118` documenta el defecto que costó arreglar).

Esto obliga a invertir una dependencia en `computeLayoutMetrics`. Hoy:

```
stripSeconds  = SCREEN_SECONDS / columns            (constante)
scalePxPerMm  = stripWidthPx / (stripSeconds × paperSpeedMmS)
```

Pasa a ser:

```
scalePxPerMm  = stripWidthPx / ((SCREEN_SECONDS / columns) × REFERENCE_PAPER_SPEED_MM_S)   (constante)
stripSeconds  = stripWidthPx / (scalePxPerMm × paperSpeedMmS)
```

con `REFERENCE_PAPER_SPEED_MM_S = 25`. A 25 mm/s los dos juegos de fórmulas dan idénticos resultados: **regresión cero, verificada por test**, en la línea de disciplina del spec del eje eléctrico.

Consecuencias:

- **El anillo se dimensiona a la referencia** (10 s a 25 mm/s) y no cambia de tamaño al hacer zoom. Ampliar es enseñar una ventana del anillo, no capturar de nuevo.
- **`SweepRebuilder` gana repintado por ventana**: `rebuild(ctx, sweep, …, { fromRingIndex, toRingIndex })`. Sin ventana repinta todo, como ahora.
- **Aparece el desplazamiento lateral.** Con 2,5 s visibles de 10 disponibles hay que poder moverse. Arrastrar desplaza; un clic sin movimiento coloca una marca. La distinción es el umbral de arrastre habitual (~4 px), no un modo que haya que activar.
- **El zoom es una herramienta de congelado.** En marcha la ventana visible es donde escribe el barrido, y cambiarla a mitad de escritura deja el cursor fuera de pantalla. Al reanudar se vuelve a 25 mm/s.
- La barra de estado ya publica `mm/s` y `s/tira`: pasan a ser dinámicos, y con eso el zoom queda declarado sin añadir ningún indicador nuevo.

### 5.5 Lupa

Ventana de ~180×120 px junto al cursor con ×4 alrededor de él, dibujada desde el anillo —no como escalado de píxeles del canvas, que ampliaría el aliasing en lugar de recuperar las ~6 muestras por píxel que la vista normal tira.

Lleva **su propia rejilla a su propia escala y su rótulo `×4`**. Una lupa sin rejilla propia invita a contar cuadros sobre una escala que no es la suya, que es justo el error que este proyecto persigue. Y los números del calibrador salen siempre de las muestras, nunca de lo que se ve en la lupa.

Se sitúa en el lado opuesto al cursor y se voltea cerca de los bordes. Es conmutable y arranca apagada.

### 5.6 Exportación con marcas

`composeSnapshot` compone hoy rejilla + trazo por tira. Añade dos cosas:

1. **El canvas de overlay entero, en (0,0)** — posible sin recalcular nada porque se dimensionó exactamente a la rejilla de tiras (§4.3).
2. **El bloque numérico del calibrador**, estampado como texto junto al sello temporal existente. Un PNG con dos marcas y ningún número obliga a volver a medir sobre la imagen, que es precisamente lo que se acaba de hacer.

---

## 6. Rendimiento: qué no pasa por React

El cursor se mueve a la cadencia del puntero. Si su lectura vive en el store de Zustand, cada movimiento vuelve a renderizar el árbol.

La frontera:

| Qué | Dónde vive | Cadencia |
|---|---|---|
| Cursor, líneas, lupa, rótulo flotante | Canvas de overlay, estado en `ref` | Puntero (~60–120 Hz) |
| Resultado del calibrador (Δt, ΔV, lpm, cuadros) | Estado de React → panel del inspector | Al hacer clic o soltar un arrastre |
| Modo de snap, zoom, lupa on/off | Estado de React | Interacción explícita |

El overlay se redibuja en su propio `requestAnimationFrame`, independiente del bucle de barrido —que en congelado no tiene nada que hacer— y solo cuando hay algo sucio. Nunca provoca un repintado del trazo.

## 7. Accesibilidad y teclado

Lo dibujado en canvas no existe para un lector de pantalla. El proyecto ya vigila esto con `accessibility-contract.test.tsx`, así que:

- **El resultado del calibrador vive también en el DOM**, en el panel del inspector, con `role="status"`. Es el único resultado que un lector de pantalla necesita: la lectura continua del cursor no es material anunciable.
- **La medición es operable con teclado.** Con el overlay activo: flechas mueven el cursor una muestra, `Shift`+flechas un milímetro, `Enter` coloca punto, `Esc` borra el calibrador. Con eso la herramienta no depende del ratón y sus resultados aterrizan en el DOM por el mismo camino.
- El overlay es `focusable`, con nombre accesible y su estado (congelado / en marcha) expuesto.

## 8. Ficheros

**Nuevos**

```
apps/web/src/render/time-index.ts          + test
apps/web/src/render/measure-geometry.ts    + test
apps/web/src/render/overlay-layer.ts       + test    (dibujo puro: recibe ctx y estado)
apps/web/src/measure/caliper.ts            + test    (máquina de estados + aritmética)
apps/web/src/measure/snap.ts               + test
apps/web/src/ui/MeasureOverlay.tsx         + test    (canvas, puntero, teclado)
apps/web/src/ui/MeasurePanel.tsx           + test    (lectura en el inspector)
apps/web/src/ui/hooks/useMeasure.ts
```

**Modificados**

```
render/layout-engine.ts        velocidad de papel como entrada; stripSeconds derivado
render/sweep-rebuilder.ts      repintado por ventana
simulation-runtime/frame-buffer.ts   consumedSampleTimes()
ui/hooks/useSweepRenderer.ts   alimenta el TimeIndex; expone anillos y geometría
ui/EcgDisplay.tsx              monta el canvas de overlay
ui/hooks/useExport.ts          overlay + bloque numérico en la captura
ui/ECGWorkspace.tsx            estado de congelado, zoom, cableado
```

**Mejora incluida a propósito.** `ECGWorkspace.tsx` tiene 407 líneas y este trabajo le añadiría estado de congelado, zoom, snap y lupa: pasaría de 500. Se extraen `WorkspaceHeader.tsx` (los controles de la cabecera) y `WorkspaceInspector.tsx` (el contenido del inspector), que ya hoy son dos bloques con fronteras claras. No se toca nada más: no es una refactorización general, es dejar habitable el fichero donde hay que trabajar.

**Sin componentes nuevos en `ui-system`.** `SegmentedControl`, `IconButton`, `Metric`, `MetricGrid`, `Badge` y `Tooltip` cubren toda la interfaz de esta fase.

## 9. Pruebas

Siguiendo la costumbre de la casa —lógica en módulos puros, tests unitarios encima:

- **`time-index`**: correspondencia muestra ↔ instante, envolvimiento del anillo, huecos, anillo a medio llenar.
- **`measure-geometry`**: ida y vuelta píxel ↔ muestra ↔ voltaje; `hitTest` en una y dos columnas, dentro de los huecos, fuera del área.
- **`caliper`**: las seis fórmulas de la tabla de §5.2, con los ejemplos numéricos del documento como casos.
- **`snap`**: los tres modos; que Pico R **no** enganche por debajo del umbral, ni sin máximo local, ni en una R negativa mal condicionada.
- **`layout-engine`**: **regresión cero a 25 mm/s** —métricas idénticas a las actuales— y ventana correcta a 50 y 100.
- **`sweep-rebuilder`**: repintado por ventana equivalente al total cuando la ventana es el anillo entero.
- **`MeasureOverlay`**: la puerta de congelado (no responde en marcha, ni en pausa con buffer sin drenar), colocación con ratón y con teclado, limpieza al reanudar.
- **Contrato de accesibilidad**: el resultado existe en el DOM y la herramienta es operable con teclado.

---

# Fase F2 — contrato (diseño, no implementación)

## 10. Anotaciones fisiológicas

Se especifica ahora para que E1 se construya encajando con esto, no de espaldas.

### 10.1 Qué publica el motor

No «los intervalos»: **los fiduciales**. Un intervalo es una resta entre dos fiduciales, y publicar solo la resta obliga a adivinar los extremos cuando hace falta pintarlos.

El motor ya tiene todo lo necesario: `CardiacEvent.t_s` marca el pico (P en los auriculares, R en los ventriculares) y `target_extent_s(template, target)` da la extensión de cada onda a ±2,5σ relativa al evento. Los fiduciales son la suma de ambos.

```jsonc
{
  "type": "annotation",
  "beat_id": 128,
  "t_s": 12.480,            // instante de referencia del latido (pico R)
  "sample_index": 6240,     // el mismo instante en muestras desde el inicio
  "template_id": "sinus",
  "p":   { "onset_s": …, "peak_s": …, "offset_s": … },
  "qrs": { "onset_s": …, "q_s": …, "r_s": …, "s_s": …, "offset_s": … },
  "st":  { "onset_s": …, "offset_s": … },
  "t":   { "onset_s": …, "peak_s": …, "offset_s": … },
  "intervals_ms": { "pr": …, "qrs": …, "qt": …, "rr": …, "qtc": … }
}
```

Reglas del contrato:

- **`null` para lo que no existe**, con el mismo criterio que ya usa `measurements`: una FA no tiene `p`, una FV no tiene nada más que su propia irregularidad, un bloqueo AV completo no tiene `pr`. `null` significa «no existe en este ritmo», nunca «error».
- **`sample_index` además de `t_s`**, a petición explícita: `round(t_s × sample_rate_hz)`. Es derivable, y publicarlo igualmente elimina la ambigüedad de redondeo justo en la frontera del anillo y evita que cada consumidor —overlay, lupa, exportación, corazón 3D, reproducción paso a paso— rehaga la conversión a su manera.
- **Un mensaje por latido, interleaved en el flujo**, no uno por frame. A 60 lpm es 1 msg/s; a 180, tres. Despreciable frente a los 10 frames binarios por segundo.
- **La anotación llega cuando el latido ha terminado de generarse.** No se puede anotar el fin de la T de un latido antes de haberla producido: hay un retraso de hasta ~400 ms de tiempo simulado. Es correcto y hay que contarlo, porque afecta al último latido visible al congelar, que puede no tener anotación.
- **`annotation` no sustituye a `measurements`.** Uno es por latido y describe *este* latido; el otro promedia diez segundos y describe el ritmo. Son cosas distintas y no deben fusionarse más adelante «para simplificar».

### 10.2 Qué hace el frontend con ellas

Las guarda en un anillo paralelo al de muestras, podado por la misma ventana temporal. `TimeIndex` (§4.1) es justo lo que traduce `sample_index` a posición del anillo y de ahí a píxel: la infraestructura de E1 consume el contrato de F2 sin adaptadores.

Encima de eso, y sin gráfica nueva: resaltado de una onda concreta, brackets `P |--PR--|QRS|--QT--|`, paso a paso por latido (`beat_id ± 1`), inspector por latido, snap a R exacto, y el disparador temporal que el corazón 3D necesita para iluminar los ventrículos cuando empieza el QRS.

---

## 11. Fuera de alcance

- Varios calibradores fijados a la vez.
- Zoom vertical y zoom con el trazado en marcha.
- Medición entre derivaciones distintas (útil para el eje; necesita anotaciones y decisión clínica propia).
- Autoevaluación —«marca dónde crees que empieza el QRS» y comparar con la verdad—. Es una función excelente, depende de F2 y merece su propio diseño.
- Exportación a PDF y vídeo con marcas.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| El zoom cambia `computeLayoutMetrics`, que gobierna toda la geometría | Test de regresión cero a 25 mm/s antes de tocar nada más |
| El overlay se cuela en el camino caliente y baja los 60 fps | rAF propio, solo activo en congelado, con el bucle de barrido parado |
| El snap a pico R se percibe como detección de QRS | Se nombra y documenta como ayuda de interacción; umbral estricto; no engancha antes que enganchar mal |
| Medir sobre una lupa con escala distinta enseña a medir mal | La lupa lleva su rejilla y su rótulo `×4`; los números salen siempre de las muestras |
| La ventana de 10 s limita qué se puede medir | La región no escrita se atenúa y no admite marcas: el límite se ve, no se descubre |
