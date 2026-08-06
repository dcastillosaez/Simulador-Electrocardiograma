# Medición sobre el ECG congelado — Diseño

**Fecha:** 2026-08-06
**Estado:** propuesto, pendiente de aprobación
**Alcance:** capa de medición e interacción en `apps/web` (fase E1) y contrato de anotaciones fisiológicas motor → API → frontend (fase F2, aquí solo se diseña).

---

## 1. Qué se construye

Hoy, cuando el usuario pulsa **Congelar**, el trazado se queda quieto y ahí termina todo: lo que hay en pantalla es una imagen. Este documento convierte esa imagen en algo que se puede leer — un ECG sobre el que se mide, se cuenta cuadros y se señala una onda con el dedo.

El cambio de fondo no son las herramientas, son las dos piezas que van debajo de todas ellas:

1. **Un índice de muestras.** Un trazado se vuelve medible cuando existe una correspondencia exacta entre píxel, muestra e instante. Hoy `SweepBuffer` guarda muestras sin identidad y la conversión índice → píxel vive repartida entre `lead-canvas.ts` y `sweep-rebuilder.ts` como aritmética suelta.
2. **Una sesión de medición.** Un objeto de estado que todas las herramientas comparten, en lugar de una máquina de estados por herramienta.

Con esas dos, cada herramienta concreta —regla, calibrador, lupa, y mañana PR, QT, resaltado de ondas— es casi una consecuencia. Sin ellas, cada herramienta nueva vuelve a costar lo mismo que la primera.

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

Índice de muestras · sesión de medición · cursor sincronizado sobre todas las derivaciones · regla temporal y de voltaje · calibrador de dos puntos con Δt, ΔV, frecuencia equivalente y cuadros · snap a señal, a rejilla y a pico R · zoom temporal 25/50/100 mm/s · lupa · exportación de la captura con las marcas puestas.

### Fase F2 — Anotaciones fisiológicas (motor + API + frontend)

El motor empieza a publicar los fiduciales de cada latido. Con eso, y **reutilizando exactamente la infraestructura de E1**, aparecen: resaltado de ondas, brackets automáticos de PR/QRS/QT, paso a paso por latido, modo interpretación, inspector clínico y sincronización con el corazón 3D de la fase D. En términos de código, cada una de esas herramientas es un **descriptor nuevo en la misma sesión de medición** (§4.5), no un subsistema nuevo.

Este documento especifica E1 al completo y **fija el contrato de F2** (§10) para que E1 no se construya de espaldas a él.

---

# Fase E1

## 4. Arquitectura

### 4.1 El índice de muestras

`FrameBuffer.consumeNewSamples()` devuelve un `Float32Array` y tira a la basura el `tStartS` que venía en la cabecera del frame (`frame-decoder.ts:27`). A partir de ahí ninguna muestra del anillo sabe quién es.

**`SampleIndexRing`** — un anillo paralelo a los `SweepBuffer`, misma capacidad, con el **número de muestra absoluto desde el inicio de la sesión** en cada posición.

La coordenada canónica es la muestra, no el segundo. El renderer entero trabaja en muestras: el anillo, el trazo, la banda de borrado y `sweepCapacitySamples` ya lo hacen. Poner el segundo en el centro obligaría a redondear en cada conversión y a arrastrar error de coma flotante hasta el píxel. Con la muestra como origen, todo lo demás es una división:

```
muestra → tiempo     i / sampleRateHz
tiempo  → muestra     round(t × sampleRateHz)
muestra → x           posiciónEnAnillo(i) × pxPorMuestra
x       → muestra     anillo[round(x / pxPorMuestra)]
muestra → frame       floor(i / CHUNK_SAMPLES)          — derivable, no se almacena
```

El registro que la capa de medición maneja lleva los dos campos, porque leerlos juntos es cómodo:

```ts
interface SamplePoint {
  sampleIndex: number;   // absoluto desde el inicio de la sesión
  timestampS: number;    // derivado: sampleIndex / sampleRateHz
}
```

**Almacenado hay uno solo.** El segundo es una división, y guardar los dos sería tener dos sitios donde el mismo hecho puede desincronizarse. La equivalencia se sostiene sobre un invariante del backend que conviene dejar escrito: el motor genera de forma contigua desde `t = 0` en trozos de `CHUNK_SAMPLES` (`simulation.py:117`), así que `frame.tStartS × sampleRateHz` es exactamente el índice de su primera muestra. Un test de contrato lo fija.

Tres decisiones más:

- **Uno solo, no doce.** Las doce derivaciones se escriben en el mismo tick desde el mismo trozo multicanal: comparten índice por construcción. Uno por derivación serían doce copias del mismo dato con doce oportunidades de desincronizarse. Se lee una vez por tick, igual que `justConsumedHadGap`.
- **Un valor por posición, no anclas por trozo.** Con capacidad ~5000 son 40 KB y un bucle de ~50 iteraciones por tick — nada al lado de doce trazos de canvas. Guardar `(posición, índiceBase)` por trozo ahorraría 39 KB y metería una búsqueda binaria en el camino del puntero.
- **`Float64Array`.** A 500 Hz, un `Int32` desborda a los 49 días de sesión; `Float64` representa enteros exactos hasta 2⁵³. El coste es el mismo array que ya se iba a reservar.

Los huecos —pérdida de frame o descarte por overrun— quedan bien representados: las posiciones del anillo siguen siendo contiguas, pero los índices absolutos **saltan**. Eso es exactamente lo que ocurrió, y es información, no un problema: la marca de discontinuidad que ya lleva `SweepBuffer` y el salto del índice cuentan la misma historia.

Una consecuencia de los huecos: **posición del anillo → índice absoluto es O(1)** (lectura directa) y es la dirección del camino caliente. La inversa —índice absoluto → posición, que hará falta en F2 para colocar una anotación— necesita búsqueda binaria sobre las dos secciones ordenadas que el cursor de escritura deja. Se ejecuta una vez por latido, no por movimiento del puntero.

`FrameBuffer` gana un método espejo del que ya tiene:

```ts
/** Índices absolutos de las muestras desalojadas por el último `advance()`,
 * en el mismo orden que `consumeNewSamples()`. */
consumedSampleIndices(): Float64Array
```

### 4.2 Geometría de medida

Módulo nuevo `render/measure-geometry.ts`, puro, sin DOM. Recoge la aritmética hoy duplicada y añade las inversas:

```
ringPosToPx(pos, metrics, sampleRateHz) → x
pxToRingPos(x, metrics, sampleRateHz)   → pos     (a la muestra más cercana)
voltageToPx(v, metrics)                            (ya existe en grid-layer.ts)
pxToVoltage(y, stripHeightPx, metrics)  → v
hitTest(xPx, yPx, layout) → { lead, column, row, xInStrip, yInStrip } | null
```

Un número que justifica media sección de este documento: con una tira de 800 px, 10 s y 25 mm/s la escala es 3,2 px/mm y **cada píxel contiene ~6 muestras**. La pantalla tira 6 de cada 7. Por eso el snap a señal no es un adorno y por eso la lupa enseña algo que en la vista normal no está.

### 4.3 Una sola capa de overlay, sobre todo el display

`lead-canvas.ts:119` ya reserva el hueco (`class OverlayLayer`, «cursores, calipers»). Se implementa, pero **no como un tercer canvas por tira**: como **un único canvas absoluto sobre toda la rejilla de tiras**.

El motivo inmediato es el cursor sincronizado: la línea vertical cruza las doce derivaciones, y con doce canvas habría que coordinar doce dibujos para pintar una línea. El motivo de fondo es que ahí van a vivir, compartiendo el mismo sistema de coordenadas, todas las capas visuales que vienen: regla, calibradores, brackets de PR/QT/RR, anotaciones del motor, marcadores, selección, lupa, resaltado de ondas, eje temporal y rótulos. Doce overlays sincronizados serían doce sitios donde ese sistema puede divergir.

Dimensiones exactas: las de la rejilla de tiras, no las del contenedor con su padding —

```
ancho  = stripWidthPx * columns + COLUMN_GAP_PX * (columns - 1)
alto   = stripHeightPx * rows   + STRIP_GAP_PX  * (rows - 1)
```

que son exactamente las que compone `composeSnapshot`. Con eso exportar es `rejilla → ECG → overlay` y se acabó (§5.6).

**Las columnas muestran el mismo instante** (`EcgDisplay.tsx:15`). Un cursor en la muestra *i* se dibuja como una línea vertical **por columna**, todas al mismo desplazamiento dentro de su tira. En vista de una columna es una línea; en `6x2` son dos.

El canvas de trazo no se toca. Dibujar cursores encima lo borraría la banda de barrido y rompería la premisa de `SweepRebuilder` de que ese canvas contiene solo trazo.

### 4.4 Congelar es instantáneo

`runtime.pause()` detiene la generación en el servidor, pero el servidor está al otro lado de la red y el cliente tiene hasta 0,7 s de señal en `FrameBuffer`. Esperar a que se vacíe para dar por congelado el trazado se ve como casi un segundo de retardo entre el clic y la reacción: el usuario pulsa Congelar y el ECG sigue moviéndose.

**El congelado es del cliente y ocurre en el mismo frame.** Como un osciloscopio:

1. Al pulsar, un `frozen` que el bucle de barrido lee **deja de avanzar y de dibujar en ese mismo tick**. La imagen queda exactamente donde estaba.
2. En paralelo se envía `pause` al servidor, que deja de generar.

**El buffer no se drena a escondidas: se queda quieto.** Vaciarlo por detrás tiraría hasta 0,7 s de señal ya generada y abriría un hueco artificial al reanudar. Como el motor congela también su reloj (`simulation.py:107` — pausar es dejar de llamar a `next_chunk`), lo que quedó en el buffer es contiguo con lo que llegará después: al reanudar, el trazo continúa sin costura.

Dos detalles que hay que atender para que eso se cumpla:

- **Reiniciar `lastS` al reanudar.** El bucle calcula el tiempo transcurrido contra el reloj real; sin reiniciarlo, el primer tick tras un congelado de treinta segundos consumiría el buffer entero de golpe sin llegar a dibujarlo.
- **Los frames en vuelo.** Entre el clic y la llegada del `pause` al servidor pueden colarse uno o dos frames. `FrameBuffer.push` los acepta y, si superan `maxS`, descarta lo más viejo marcando hueco — comportamiento ya existente y correcto.

La capa de medición se activa con `frozen`, sin más condiciones. El indicador «Trazado congelado» aparece con el clic, que es cuando el trazado se congela de verdad.

Al reanudar: se borran calibrador y cursor, la velocidad de papel vuelve a 25 mm/s y el overlay deja de recibir puntero. Las mediciones no sobreviven porque el anillo que describen se va a sobrescribir; conservar los números sería conservar una referencia a un trazado que ya no está.

**Región medible.** Si la sesión lleva menos de lo que cabe en la tira, el anillo está a medias: solo `[0, writeCursor)` tiene señal. Fuera de ahí no hay cursor ni se puede colocar una marca. La zona no escrita se atenúa en el overlay para que el límite se vea, en lugar de descubrirse al no poder hacer clic.

### 4.5 `MeasurementSession`: un estado para todas las herramientas

Si cada herramienta trae su propia máquina de estados, la undécima cuesta lo mismo que la primera y las once se solapan en un 80%. Todas hacen lo mismo: fijar puntos, seguir el puntero, aplicar snap, producir un resultado.

Una sesión única:

```ts
interface MeasurementSession {
  tool: ToolId;              // qué herramienta está activa
  snapMode: SnapMode;
  markers: SamplePoint[];    // puntos ya fijados
  anchor: SamplePoint | null;// el último fijado, referencia de la medida en curso
  hover: SamplePoint | null; // dónde está el puntero ahora
  result: MeasurementResult | null;
}
```

y una **herramienta que es un descriptor, no una clase**:

```ts
interface MeasurementTool {
  id: ToolId;
  markerCount: number;             // 1 regla · 2 calibrador y RR · n en F2
  defaultSnap: SnapMode;
  compute(markers, hover, context): MeasurementResult | null;
}
```

Con eso, las herramientas de las dos fases son la misma máquina con distintos parámetros:

| Herramienta | Fase | Marcas | Snap | Resultado |
|---|---|---|---|---|
| Regla | E1 | 0 (solo `hover`) | Señal | derivación, t, V |
| Calibrador | E1 | 2 | Señal / Rejilla | Δt, ΔV, lpm, cuadros |
| RR | E1 | 2 | Pico R | Δt = RR, lpm |
| PR | F2 | 0 — los extremos los da la anotación | — | inicio P → inicio QRS |
| QT | F2 | 0 — ídem | — | inicio QRS → fin T |
| Resaltado de onda | F2 | 0 | — | el intervalo de la onda elegida |

La transición de estado es un **reductor puro**, `apply(session, event) → session`, con eventos `hover`, `place`, `dragMarker`, `clear`, `setTool`, `setSnap`. Sin DOM y sin canvas: se prueba entero con tablas de entrada y salida, que es como se prueba el resto de la lógica de este repositorio.

**La sesión vive en una `ref`, no en el store.** `hover` cambia a la cadencia del puntero y no puede disparar renders (§6). La sesión emite un evento `cold` cuando cambian `tool`, `snapMode`, `markers` o `result`; el panel del inspector se suscribe a ese evento. `hover` no emite nunca: lo consume el bucle de dibujo del overlay leyendo la `ref`.

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
- **`V` es respecto a la línea de 0 mV de la tira**, que es donde el motor pone la isoeléctrica. La amplitud respecto a la isoeléctrica *del latido* —lo que hace falta para medir un ST— **no es esta herramienta, es el calibrador**: punto A sobre el segmento TP, punto B en el punto J, y el ΔV que sale es la elevación real. Así se mide en papel y así se enseña aquí.
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

Aritmética, explícita para que no se reinvente en tres sitios (`measure/formulas.ts`):

| Magnitud | Fórmula |
|---|---|
| Δt (ms) | `(i_B − i_A) / sampleRateHz × 1000`, valor absoluto |
| ΔV (mV) | `V_B − V_A`, con signo |
| Frecuencia equivalente (lpm) | `60 / Δt_s` |
| Cuadros pequeños | `Δt_s × paperSpeedMmS` (1 mm = 1 cuadro pequeño) |
| Cuadros grandes | cuadros pequeños `/ 5` |
| Altura en cuadros | `ΔV_mV × clinicalGainMmPerMv` |

Δt se calcula **restando índices de muestra**, no timestamps: es aritmética entera y el resultado es exacto.

Comprobación con el ejemplo: 0,164 s × 25 mm/s = 4,1 mm → 4,1 cuadros pequeños → 0,82 grandes. 60/0,164 = 366 lpm. Y con RR = 860 ms, 60/0,86 = 69,8 lpm.

Los cuadros se derivan de la **velocidad de papel vigente**, no de la constante 25: con el zoom a 50 mm/s el mismo intervalo ocupa el doble de cuadros en pantalla, y decir lo contrario sería mentir sobre lo que se está viendo.

**Un calibrador a la vez.** Se coloca, se lee, se sustituye. El flujo real es medir un intervalo, apuntarlo y medir el siguiente. Varios calibradores fijados simultáneamente queda fuera de alcance, no descartado: con la sesión de §4.5 es alargar `markers` y llevar una lista de resultados, no rehacer nada.

**El RR no es una herramienta nueva.** Es el calibrador con snap a pico R —una entrada distinta en la tabla de §4.5, no código nuevo—. Dos clics sobre dos R dan Δt = RR y la frecuencia equivalente, que es literalmente lo que se pedía.

Los dos puntos son arrastrables después de colocados: nadie acierta a la primera y volver a empezar por 3 ms de error es innecesario.

### 5.3 Snap

Control segmentado con tres modos. Afecta a dónde cae la marca y el cursor:

| Modo | Qué hace | Para qué |
|---|---|---|
| **Señal** (por defecto) | La marca cae en la muestra más cercana en X, y en Y **sobre el valor de la señal** en ese instante | Nunca se mide el fondo. Amplitudes y ST salen del trazo real, no de dónde tembló la mano |
| **Rejilla** | La marca cae en el vértice de milímetro más cercano | Es como se lee en papel: contando cuadros |
| **Pico R** | Máximo en valor absoluto dentro de ±150 ms del cursor, en la derivación activa | Medir RR sin cazar píxeles |

El modo **Pico R** de E1 es una ayuda a la interacción, **no una medida clínica**: es un máximo local, no una detección de QRS. Condiciones para que enganche —y si no se cumplen, no engancha y se dice, en lugar de saltar a cualquier sitio:

- máxima desviación absoluta respecto a 0 mV dentro de la ventana,
- que supere 0,25 mV,
- que sea máximo local (mayor que sus vecinos inmediatos).

En F2 este modo pasa a usar el fiducial `qrs.r` del motor y deja de ser una heurística. La interfaz no cambia; cambia de dónde sale el número.

### 5.4 Zoom temporal: velocidad de papel real

Rueda del ratón sobre el trazado: 25 → 50 → 100 mm/s. Lo que cambia es la velocidad de papel, **no el tamaño de la rejilla**: el cuadro pequeño sigue midiendo un milímetro en pantalla y sigue valiendo 1/velocidad segundos. A 50 mm/s se ve la mitad de tiempo, exactamente como en un electrocardiógrafo.

Un zoom óptico —ampliar todo, rejilla incluida— sería más fácil y estropearía lo único que este simulador hace bien y que muchos hacen mal: que contar cuadros sea exacto (`layout-engine.ts:118` documenta el defecto que costó arreglar).

**`SCREEN_SECONDS` desaparece.** Que la constante del sistema sean segundos es un accidente de cómo se construyó: en un electrocardiógrafo la constante es el **ancho del papel** y los segundos salen de dividirlo por la velocidad. El cambio de nombre es el cambio de modelo:

```
VIEWPORT_WIDTH_MM = 250            // por tira, a una columna. Constante del sistema
viewportWidthMm   = VIEWPORT_WIDTH_MM / columns
scalePxPerMm      = stripWidthPx / viewportWidthMm
visibleSeconds    = viewportWidthMm / paperSpeedMmS
```

250 mm no es un número nuevo: son los mismos 10 s a 25 mm/s que hay hoy, dichos en las unidades correctas. A 25 mm/s las métricas salen **idénticas** a las actuales —**regresión cero, verificada por test**, en la disciplina del spec del eje eléctrico—; a 50 son 5 s y a 100, 2,5 s.

Consecuencias:

- **El anillo se dimensiona a la velocidad de referencia** (250 mm a 25 mm/s = 10 s) y no cambia de tamaño al hacer zoom. Ampliar es enseñar una ventana del anillo, no capturar de nuevo.
- **`SweepRebuilder` gana repintado por ventana**: `rebuild(ctx, sweep, …, { fromRingPos, toRingPos })`. Sin ventana repinta todo, como ahora.
- **Aparece el desplazamiento lateral.** Con 2,5 s visibles de 10 disponibles hay que poder moverse. Arrastrar desplaza; un clic sin movimiento coloca una marca. La distinción es el umbral de arrastre habitual (~4 px), no un modo que haya que activar.
- **El zoom es una herramienta de congelado.** En marcha, la ventana visible es donde escribe el barrido, y cambiarla a mitad de escritura deja el cursor fuera de pantalla. Al reanudar se vuelve a 25 mm/s.
- La barra de estado ya publica `mm/s` y `s/tira`: pasan a ser dinámicos, y con eso el zoom queda declarado sin añadir ningún indicador nuevo.

### 5.5 Lupa

Ventana de ~180×120 px junto al cursor con ×4 alrededor de él, dibujada desde el anillo —no como escalado de píxeles del canvas, que ampliaría el aliasing en lugar de recuperar las ~6 muestras por píxel que la vista normal tira.

Lleva **su propia rejilla a su propia escala y su rótulo `×4`**. Una lupa sin rejilla propia invita a contar cuadros sobre una escala que no es la suya, que es justo el error que este proyecto persigue. Y los números del calibrador salen siempre de las muestras, nunca de lo que se ve en la lupa.

Se sitúa en el lado opuesto al cursor y se voltea cerca de los bordes. Es conmutable y arranca apagada.

### 5.6 Exportación con marcas

`composeSnapshot` compone hoy rejilla + trazo por tira. Pasa a ser `rejilla → ECG → overlay`, con dos añadidos:

1. **El canvas de overlay entero, en (0,0)** — posible sin recalcular nada porque se dimensionó exactamente a la rejilla de tiras (§4.3).
2. **El resultado numérico de la sesión**, estampado como texto junto al sello temporal existente. Un PNG con dos marcas y ningún número obliga a volver a medir sobre la imagen, que es precisamente lo que se acaba de hacer.

---

## 6. Rendimiento: qué no pasa por React

El cursor se mueve a la cadencia del puntero. Si `hover` vive en el store, cada movimiento vuelve a renderizar el árbol.

La frontera:

| Qué | Dónde vive | Cadencia |
|---|---|---|
| `hover`, arrastre en curso, líneas, lupa, rótulo flotante | `ref` de la sesión + canvas de overlay | Puntero (~60–120 Hz) |
| `result`, `markers`, `tool`, `snapMode` | Evento `cold` de la sesión → estado de React → inspector | Al fijar una marca, soltar un arrastre o cambiar de herramienta |

React nunca recibe un `mousemove`. Recibe *medición completada* y *selección cambiada*, que son eventos raros.

El overlay se redibuja en su propio `requestAnimationFrame`, y en congelado es el único bucle vivo: el de barrido está parado (§4.4). Nunca provoca un repintado del trazo.

## 7. Accesibilidad y teclado

Lo dibujado en canvas no existe para un lector de pantalla. El proyecto ya vigila esto con `accessibility-contract.test.tsx`, así que:

- **`result` vive también en el DOM**, en el panel del inspector, con `role="status"`. Es el único resultado que un lector de pantalla necesita: la lectura continua del cursor no es material anunciable.
- **La medición es operable con teclado.** Con el overlay activo: flechas mueven el cursor una muestra, `Shift`+flechas un milímetro, `Enter` fija marca, `Esc` limpia la sesión. Con eso la herramienta no depende del ratón y sus resultados aterrizan en el DOM por el mismo camino.
- El overlay es enfocable, con nombre accesible y su estado (congelado / en marcha) expuesto.

## 8. Ficheros

**Nuevos**

```
apps/web/src/render/sample-index.ts        + test
apps/web/src/render/measure-geometry.ts    + test
apps/web/src/render/overlay-layer.ts       + test    (dibujo puro: recibe ctx y sesión)
apps/web/src/measure/session.ts            + test    (estado único + reductor puro)
apps/web/src/measure/tools.ts              + test    (descriptores de herramienta)
apps/web/src/measure/formulas.ts           + test    (Δt, ΔV, lpm, cuadros)
apps/web/src/measure/snap.ts               + test
apps/web/src/ui/MeasureOverlay.tsx         + test    (canvas, puntero, teclado)
apps/web/src/ui/MeasurePanel.tsx           + test    (lectura en el inspector)
apps/web/src/ui/hooks/useMeasure.ts
```

**Modificados**

```
render/layout-engine.ts              VIEWPORT_WIDTH_MM; visibleSeconds derivado de la velocidad
render/sweep-rebuilder.ts            repintado por ventana
simulation-runtime/frame-buffer.ts   consumedSampleIndices()
ui/hooks/useSweepRenderer.ts         alimenta el SampleIndexRing; bandera `frozen`; expone anillos y geometría
ui/EcgDisplay.tsx                    monta el canvas de overlay
ui/hooks/useExport.ts                overlay + resultado en la captura
ui/ECGWorkspace.tsx                  congelado inmediato, zoom, cableado
```

**Mejora incluida a propósito.** `ECGWorkspace.tsx` tiene 407 líneas y este trabajo le añadiría congelado, zoom, snap, herramienta activa y lupa: pasaría de 500. Se extraen `WorkspaceHeader.tsx` (los controles de la cabecera) y `WorkspaceInspector.tsx` (el contenido del inspector), que ya hoy son dos bloques con fronteras claras. No se toca nada más: no es una refactorización general, es dejar habitable el fichero donde hay que trabajar.

**Sin componentes nuevos en `ui-system`.** `SegmentedControl`, `IconButton`, `Metric`, `MetricGrid`, `Badge` y `Tooltip` cubren toda la interfaz de esta fase.

## 9. Pruebas

Siguiendo la costumbre de la casa —lógica en módulos puros, tests unitarios encima:

- **`sample-index`**: correspondencia posición ↔ índice absoluto, envolvimiento, saltos por hueco, anillo a medio llenar, búsqueda inversa sobre el anillo rotado.
- **Contrato de invariante**: `frame.tStartS × sampleRateHz` es el índice de su primera muestra.
- **`measure-geometry`**: ida y vuelta píxel ↔ muestra ↔ voltaje; `hitTest` en una y dos columnas, dentro de los huecos, fuera del área.
- **`session`**: el reductor completo por tablas — colocar, arrastrar, limpiar, cambiar de herramienta con marcas puestas, `hover` fuera de la región medible.
- **`formulas`**: las seis fórmulas de §5.2, con los ejemplos numéricos del documento como casos.
- **`snap`**: los tres modos; que Pico R **no** enganche por debajo del umbral, ni sin máximo local, ni en una R negativa mal condicionada.
- **`layout-engine`**: **regresión cero a 25 mm/s** —métricas idénticas a las actuales— y ventana correcta a 50 y 100.
- **`sweep-rebuilder`**: repintado por ventana equivalente al total cuando la ventana es el anillo entero.
- **`useSweepRenderer`**: congelado en el mismo tick; el buffer no se drena estando congelado; `lastS` se reinicia al reanudar y no se consume el buffer de golpe.
- **`MeasureOverlay`**: no responde en marcha; colocación con ratón y con teclado; limpieza al reanudar.
- **Contrato de accesibilidad**: `result` existe en el DOM y la herramienta es operable con teclado.

---

# Fase F2 — contrato (diseño, no implementación)

## 10. Anotaciones fisiológicas

Se especifica ahora para que E1 se construya encajando con esto, no de espaldas.

### 10.1 Qué publica el motor

No «los intervalos»: **los fiduciales**. Un intervalo es una resta entre dos fiduciales, y publicar solo la resta obliga a adivinar los extremos cuando hay que pintarlos.

El motor ya tiene todo lo necesario: `CardiacEvent.t_s` marca el pico (P en los auriculares, R en los ventriculares) y `target_extent_s(template, target)` da la extensión de cada onda a ±2,5σ relativa al evento. Los fiduciales son la suma de ambos.

```jsonc
{
  "type": "annotation",
  "beat_id": 128,
  "t_s": 12.480,            // instante de referencia del latido (pico R)
  "sample_index": 6240,     // el mismo instante, en la coordenada canónica
  "template_id": "sinus",
  "p":   { "onset_s": …, "peak_s": …, "offset_s": … },
  "qrs": { "onset_s": …, "q_s": …, "r_s": …, "s_s": …, "offset_s": … },
  "st":  { "onset_s": …, "offset_s": … },
  "t":   { "onset_s": …, "peak_s": …, "offset_s": … },
  "intervals_ms": { "pr": …, "qrs": …, "qt": …, "rr": …, "qtc": … }
}
```

Reglas del contrato:

- **`null` para lo que no existe**, con el mismo criterio que ya usa `measurements`: una FA no tiene `p`, una FV no tiene latidos discretos que anotar, un bloqueo AV completo no tiene `pr`. `null` significa «no existe en este ritmo», nunca «error».
- **`sample_index` además de `t_s`**. Es la coordenada canónica del frontend (§4.1): publicarlo elimina el redondeo en la frontera del anillo y evita que cada consumidor —overlay, lupa, exportación, corazón 3D, reproducción paso a paso— rehaga la conversión a su manera. Los fiduciales internos van en segundos relativos al latido, que es como los tiene el motor.
- **Un mensaje por latido, interleaved en el flujo**, no uno por frame. A 60 lpm es 1 msg/s; a 180, tres. Despreciable frente a los 10 frames binarios por segundo.
- **La anotación llega cuando el latido ha terminado de generarse.** No se puede anotar el fin de la T antes de haberla producido: hay un retraso de hasta ~400 ms de tiempo simulado. Es correcto y hay que contarlo, porque afecta al último latido visible al congelar, que puede no tener anotación todavía.
- **`annotation` no sustituye a `measurements`.** Uno es por latido y describe *este* latido; el otro promedia diez segundos y describe el ritmo. Son cosas distintas y no deben fusionarse más adelante «para simplificar».

### 10.2 Qué hace el frontend con ellas

Las guarda en un anillo paralelo al de muestras, podado por la misma ventana. `SampleIndexRing` traduce `sample_index` a posición y de ahí a píxel: el contrato de F2 se consume con la infraestructura de E1, sin adaptadores.

Encima de eso, y sin gráfica nueva: resaltado de una onda concreta, brackets `P |--PR--|QRS|--QT--|`, paso a paso por latido (`beat_id ± 1`), inspector por latido, snap a R exacto, y el disparador temporal que el corazón 3D necesita para iluminar los ventrículos cuando empieza el QRS. Cada una es **una fila más en la tabla de §4.5**.

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
| Congelar sin drenar deja el buffer con señal vieja y al reanudar se consume de golpe | Reinicio de `lastS` al reanudar, con test |
| El overlay se cuela en el camino caliente y baja los 60 fps | rAF propio; `hover` en `ref`, nunca en el store; en congelado el bucle de barrido está parado |
| El snap a pico R se percibe como detección de QRS | Se nombra y documenta como ayuda de interacción; umbral estricto; no engancha antes que enganchar mal |
| Medir sobre una lupa con escala distinta enseña a medir mal | La lupa lleva su rejilla y su rótulo `×4`; los números salen siempre de las muestras |
| La ventana del anillo limita qué se puede medir | La región no escrita se atenúa y no admite marcas: el límite se ve, no se descubre |
