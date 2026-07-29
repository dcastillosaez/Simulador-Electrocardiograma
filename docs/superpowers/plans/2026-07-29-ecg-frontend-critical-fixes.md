# Fase C — arreglo de hallazgos Critical de la revisión final (repetida)

> Sigue a `2026-07-28-ecg-frontend-design.md` y `2026-07-28-ecg-frontend.md`, ya fusionados en `master` (PR #11, `3e42382`). Una repetición de la revisión final de rama encontró 3 hallazgos Critical que no se detectaron en la revisión anterior (esa cubrió otro subconjunto: C1/C2/I8/I1/I2 de aquella ronda, ya arreglados en `0e30a0b`). Este plan cubre solo los 3 Critical nuevos.

## Contexto para ambas tareas

- Repo: `F:/Documentos/IA/Medicina`. Rama: `feat/ecg-frontend-critical-fixes`, creada desde `master` en `3e42382`.
- Amplitud real de la señal (`packages/ecg-engine/src/ecg_engine/beat.py`): onda R ≈ 0,00100V (0,00110V en fibrilación auricular), T ≈ 0,00025V, P ≈ 0,00012V. Constante de referencia: **R_WAVE_V = 0.001** (1mV).
- `packages/ecg-engine/src/ecg_engine/noise.py`: `emg_v`/`mains_v`/`baseline_v`/`motion_v` son amplitudes/desviaciones típicas en voltios, mismo dominio que la señal (no hay reescalado interno). `baseline_v` se multiplica además por una ganancia por derivación de hasta ×1,3 (`_BASELINE_LEAD_GAIN`).

## Task 1 — Recalibrar la escala de los controles de ruido (Critical C1)

**Archivos:** `apps/web/src/ui/AdvancedControlPanel.tsx`, `apps/web/src/ui/noise-presets.ts`, `apps/web/src/ui/noise-presets.test.ts`.

**Problema:** `SLIDER_MAX_V = 0.3` y `SLIDER_STEP_V = 0.005` en `AdvancedControlPanel.tsx` son 300× y 5× la onda R respectivamente — el primer paso no nulo de cualquier slider ya satura la señal. Los presets en `noise-presets.ts` heredan la misma escala equivocada (p. ej. `buena.baseline_v = 0.02` es 20× R): salvo `perfecta` (todo a cero), ningún preset produce un trazado interpretable. `clip_v` ya se corrigió en una revisión anterior (`CLIP_MAX_V = 0.005`, preset `muy_mala.clip_v = 0.0015`) — es la prueba de que el resto de campos se quedó sin ese mismo arreglo.

**Qué hacer:**

1. Añadir una constante compartida `R_WAVE_V = 0.001` (con un comentario corto que remita a `beat.py` como fuente), en el sitio que seguís usando ambos ficheros — puede vivir en `noise-presets.ts` y re-exportarse, o en un módulo nuevo minúsculo si preferís no crear un ciclo de imports entre UI y presets. Referenciar esta constante desde `AdvancedControlPanel.tsx` en vez de un número mágico nuevo.

2. En `AdvancedControlPanel.tsx`, recalibrar `SLIDER_MAX_V` y `SLIDER_STEP_V` (los que aplican a `emg_v`/`mains_v`/`baseline_v`/`motion_v`) a un rango expresado en fracción de `R_WAVE_V`: máximo ≈ 2× `R_WAVE_V` (0,002V), paso ≈ 1/100 del máximo. No toquéis `CLIP_MAX_V`/`CLIP_STEP_V` — ya están bien calibrados.

3. Recalibrar los 6 presets de `noise-presets.ts` para que, expresados como fracción de `R_WAVE_V`, formen una progresión de degradación real y monótona (cada preset visiblemente peor que el anterior, pero **todos con la onda R aún distinguible salvo que el usuario mueva un slider más allá del preset**, incluido `muy_mala`). Referencia de orden de magnitud, no valores exactos obligatorios — usad criterio propio siempre que la progresión sea coherente y quede dentro del rango del slider (máximo del punto 2):
   - `perfecta`: sin cambios (todo a 0, `clip_v: null`).
   - `buena`: degradación apenas perceptible (cada campo aditivo entre ~1% y ~10% de R_WAVE_V).
   - `urgencias`: moderada (varios campos entre ~5% y ~20% de R_WAVE_V), sin recorte.
   - `ambulancia`: con más peso en `motion_v` que en los demás (coherente con vibración de vehículo en marcha), sin recorte.
   - `uci`: entre `buena` y `urgencias`, sin recorte.
   - `muy_mala`: la peor pero aún legible con esfuerzo — mantened `clip_v: 0.0015` (ya correcto) y llevad `emg_v`/`baseline_v`/`motion_v` a valores altos (30-60% de R_WAVE_V) sin llegar a un valor que, combinado con `clip_v`, aplane la onda R por completo.

4. Actualizar `noise-presets.test.ts`: además del test existente de `matchPreset` (round-trip), añadir una aserción que compare cada campo de cada preset contra `R_WAVE_V` (p. ej. "ningún campo aditivo de ningún preset supera 1× R_WAVE_V" o similar guardarraíl relativo, no un valor absoluto hardcodeado dos veces) — el bug original pasó precisamente porque ningún test afirmaba nada sobre la escala de los valores, solo sobre el round-trip de `matchPreset`.

**Verificación:** `npx vitest run src/ui/noise-presets.test.ts src/ui/AdvancedControlPanel.test.tsx` (si existe este último; si no, basta el primero) y `npx tsc --noEmit`.

---

## Task 2 — Ring buffer de render con barrido real + política de buffer completa (Critical C2 + C3)

**Archivos:** `apps/web/src/simulation-runtime/frame-buffer.ts`, `apps/web/src/simulation-runtime/frame-buffer.test.ts`, `apps/web/src/render/lead-canvas.ts`, `apps/web/src/render/lead-canvas.test.ts`, `apps/web/src/ui/ECGWorkspace.tsx`, `apps/web/src/ui/ECGWorkspace.test.tsx`, y (nuevo) `apps/web/src/render/sweep-buffer.ts` + `apps/web/src/render/sweep-buffer.test.ts`.

Dependen del mismo rediseño porque el buffer de jitter (`FrameBuffer`) es quien alimenta el nuevo buffer de render — se hacen en la misma tarea, no en paralelo.

### C3 — `FrameBuffer`: pre-roll y overrun hasta el objetivo

**Problema actual (`frame-buffer.ts`):** `targetS`/`minS` se asignan en el constructor y no los lee nadie más. No hay pre-roll: la reproducción arranca con el primer trozo que llega, así que en régimen normal (chunks de 100ms cada 100ms) el buffer vive permanentemente al borde del underrun. El overrun (`push()`) descarta hasta `maxS` (0,7s), no hasta `targetS` (0,5s) como pide el spec §4 ("descartar lo más antiguo hasta volver al objetivo").

**Qué hacer:**

1. **Overrun hasta el objetivo:** en `push()`, cuando `bufferedDurationS > maxS`, seguir descartando el frame más antiguo hasta que `bufferedDurationS <= targetS` (no `maxS`). El disparador de la limpieza sigue siendo superar `maxS`; el punto de parada cambia a `targetS`. El test existente `"descarta lo mas antiguo al superar el maximo (overrun)"` sigue en verde sin cambios (targetS < maxS), pero añadid uno nuevo que afirme que tras un aluvión de pushes queda cerca de `targetS`, no solo `<= maxS`.

2. **Pre-roll:** añadir un getter `isPreRolled: boolean`, `false` hasta que `bufferedDurationS` alcanza `targetS` por primera vez (o tras vaciarse del todo), `true` a partir de ahí. `advance()` debe ser un no-op mientras `!isPreRolled` (los frames se siguen acumulando vía `push()`, simplemente no se consumen todavía). Cuando `advance()` deja el buffer vacío (`frames.length === 0`), `isPreRolled` vuelve a `false` — hay que volver a acumular hasta el objetivo antes de reanudar. No toquéis el significado de `isUnderrun` (`frames.length === 0`); son conceptos distintos y ambos se necesitan en la Tarea 2's integración con `ECGWorkspace`.

3. **Tests existentes que hay que ajustar:** varios tests actuales empujan menos de `targetS` (500ms por defecto) y esperan que `advance()` consuma de inmediato — eso ya no es el contrato correcto (antes de pre-roll no debe reproducirse nada). Ajustadlos construyendo el `FrameBuffer` con un `targetS` explícito pequeño cuando el test quiera aislar la mecánica de consumo de trozos, y añadid tests nuevos y separados que cubran el pre-roll en sí: no se consume nada antes de alcanzar el objetivo, se empieza a consumir justo al alcanzarlo, y tras vaciarse hace falta volver a alcanzar el objetivo antes de que `advance()` vuelva a consumir.

### C2 — `getVisibleSamples` confunde el buffer de jitter con la ventana de render

**Problema actual:** `getVisibleSamples(leadIndex)` devuelve TODO lo que queda en el buffer de jitter (máx. 0,7s) y `ECGWorkspace` lo redibuja entero cada tick con `drawLeadTrace` desde `x=0`. Contra el backend real (chunks de 100ms cada 100ms) eso son ≤9px de trazo sobre un canvas de 800px (8,5s de papel a 25mm/s), parpadeando. El spec madre (`docs/superpowers/specs/2026-07-25-ecg-simulator-fase1-design.md`, sección de renderizado) pide "modo barrido de monitor": el buffer de jitter (para absorber variación de red) y la ventana visible en pantalla (8,5s de papel) son dos cosas de tamaño muy distinto y no pueden ser el mismo objeto.

**Qué hacer — diseño de referencia (podéis ajustar nombres/estructura si el comportamiento y los tests equivalentes se mantienen):**

1. **`FrameBuffer` — sustituir `getVisibleSamples` por `consumeNewSamples`:** en vez de devolver todo lo bufferizado, `advance()` debe recordar qué frames desalojó en esa llamada concreta (sobrescribiendo lo recordado en la llamada anterior, no acumulando histórico). Nuevo método `consumeNewSamples(leadIndex: number): Float32Array` devuelve, en orden cronológico, las muestras de esos frames recién desalojados (vacío si `advance()` no corrió, fue no-op por `!isPreRolled`, o no completó ningún trozo esa llamada). Eliminad `getVisibleSamples` y su test — sustituidlo por tests de `consumeNewSamples` con el mismo espíritu (concatena en orden de llegada, por derivación) más el caso "vacío si no se consumió nada esta vez".

2. **Nuevo `render/sweep-buffer.ts` — anillo de render por derivación:**
   - Una función pura `sweepCapacitySamples(widthPx: number, paperSpeedMmS: number, sampleRateHz: number): number` que calcule cuántas muestras caben en el ancho del canvas al ritmo de papel dado (usando `PX_PER_MM` de `grid-layer.ts`: `pxPerSample = PX_PER_MM * paperSpeedMmS / sampleRateHz`; capacidad = `widthPx / pxPerSample`, redondeada). Con los valores por defecto del proyecto (800px, 25mm/s, 500Hz) da ≈4233 muestras (~8,5s).
   - Una clase `SweepBuffer` que envuelve un `Float32Array` de esa capacidad como anillo circular: `push(samples: Float32Array)` escribe avanzando y envolviendo el cursor de escritura sin asignar memoria nueva por llamada; expone el cursor de escritura actual y un accesor indexado (con módulo) a una posición del anillo; `reset()` limpia el contenido y el cursor (para cuando cambie de sesión o de ritmo).
   - Tests: capacidad calculada correctamente para los valores por defecto y para al menos otro combo (p. ej. 50mm/s); el cursor envuelve sin crecer el array ni lanzar al empujar más muestras que la capacidad; el contenido tras envolver sobrescribe correctamente lo más antiguo (verificable leyendo posiciones concretas del anillo tras una secuencia de pushes conocida).

3. **`render/lead-canvas.ts` — dibujar solo el segmento nuevo, con banda de borrado:**
   - Nueva función (junto a la existente `drawLeadTrace`, que podéis conservar si algo más la usa, o eliminar si queda huérfana) que reciba el `SweepBuffer` de una derivación más las muestras nuevas de este tick (`consumeNewSamples`), y:
     a. Dibuje SOLO esas muestras nuevas como segmento de línea, en la posición de píxel que les corresponde según el cursor de escritura del anillo (`x = (índiceEnAnillo % capacidad) * pxPerSample`) — nunca redibuje el anillo entero.
     b. Antes o durante ese dibujo, limpie (`clearRect`) una banda estrecha de unos pocos píxeles inmediatamente por delante del nuevo cursor de escritura, envolviendo al borde derecho del canvas si corresponde — es lo que separa visualmente el trazo nuevo del trazo antiguo de la vuelta anterior (el efecto de barrido de un monitor real, spec madre).
   - Property-tests con el mismo patrón de mock de `ctx` que ya usa `lead-canvas.test.ts` (objeto con `vi.fn()` por método): (a) el número de `lineTo` es proporcional al número de muestras nuevas, NO a la capacidad del anillo (esta es la propiedad de rendimiento que motiva todo el cambio); (b) se emite al menos un `clearRect` cuya coordenada x aproxima la posición del cursor de escritura; (c) con una capacidad pequeña deliberada en el test (para forzar el envolvimiento en pocas muestras), las coordenadas x de los puntos dibujados y de la banda de borrado envuelven correctamente al llegar al borde derecho (vuelven cerca de 0, no seguen creciendo sin límite).

4. **`ECGWorkspace.tsx` — integrar:**
   - Un `SweepBuffer` por derivación activa, dimensionado con `sweepCapacitySamples` usando el ancho real del canvas (800), `PAPER_SPEED_MM_S` y `sampleRateHz` vigentes; recrearlo si cambia cualquiera de esos tres valores (hoy son constantes salvo `sampleRateHz`, que ya se lee de `store.sampleRateHz` en el mismo efecto).
   - En el tick de rAF: llamar a `runtime.buffer.advance(elapsedS)` igual que ahora; el criterio de "esperando señal" pasa a ser `runtime.buffer.isUnderrun || !runtime.buffer.isPreRolled` (antes solo era `isUnderrun`); cuando NO se está esperando señal, para cada derivación activa llamar a `runtime.buffer.consumeNewSamples(leadIndex)` y pasar el resultado a la nueva función de dibujo de barrido de la Tarea 2.3 junto con el `SweepBuffer` de esa derivación.
   - Al cambiar de ritmo (`handleRhythmSelect`) o al reiniciarse la sesión, hay que reiniciar los `SweepBuffer` (`reset()`) para no mezclar trazos de dos sesiones distintas en el mismo anillo — mirad cómo `session-runtime.ts` ya distingue un reinicio de sesión (`session_id` distinto tras `sequence_number` en 0) y enganchaos a esa señal si hace falta, o al evento `started`.
   - Ajustad `ECGWorkspace.test.tsx` a la nueva integración: los tests actuales sobre el indicador de "esperando señal" deben seguir en verde ampliando la condición cubierta (ahora también depende de `isPreRolled`); añadid al menos un test de que un frame nuevo produce dibujo incremental (vía el mock de canvas ya usado en el resto de la suite) y de que cambiar de ritmo reinicia el barrido.

5. **Actualizar el spec de la fase C** (`docs/superpowers/specs/2026-07-28-ecg-frontend-design.md`, secciones 4 y 5): nombrad explícitamente que el buffer de jitter (`FrameBuffer`, política de underrun/overrun, 300-700ms) y la ventana de render en pantalla (`SweepBuffer`, dimensionada al ancho de canvas en segundos de papel) son dos buffers distintos con responsabilidades distintas — la confusión entre ambos fue la causa raíz de este bug.

**Verificación:** `npx vitest run src/simulation-runtime/frame-buffer.test.ts src/render/lead-canvas.test.ts src/render/sweep-buffer.test.ts src/ui/ECGWorkspace.test.tsx` y `npx tsc --noEmit`. Si el repositorio tiene el backend/mock levantable en este entorno, una pasada manual o del test de Playwright existente (`tests/e2e/streaming-performance.spec.ts`) es la verificación más fiel al criterio de aceptación 1/7, aunque no es obligatoria para cerrar la tarea si no es practicable desde el sandbox del subagente.

## Restricciones globales (aplican a ambas tareas)

- El buffer de muestras (`Float32Array`) sigue sin poder vivir en Zustand ni pasar por reconciliación de React — el `SweepBuffer` y el drenaje del `FrameBuffer` son responsabilidad de `simulation-runtime`/`render`, invocados desde el bucle rAF de `ECGWorkspace`, nunca desde un `useEffect` reactivo a cada frame.
- Nada de interpolación en underrun: si no hay muestras nuevas que consumir este tick, no se dibuja nada nuevo (el trazo ya pintado en el anillo se queda tal cual).
- `npx tsc --noEmit` es obligatorio en cada tarea, además de los tests — ya hay precedente en este proyecto de un error de tipos real que Vitest no detectó por no hacer type-checking.
