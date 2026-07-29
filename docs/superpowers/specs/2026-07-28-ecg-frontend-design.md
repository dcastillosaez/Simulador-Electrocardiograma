# Fase C — Frontend del simulador de ECG

> Diseño de la interfaz web que consume la API de streaming construida en la fase B. Complementa, no sustituye, la sección 9 del spec original (`2026-07-25-ecg-simulator-fase1-design.md`), donde el stack y el contrato binario ya quedaron fijados.

## 1. Alcance de esta fase

Solo la vista en vivo de una sesión: seleccionar un ritmo, arrancarlo, ver el trazado de las 12 derivaciones en tiempo real, y ajustar frecuencia cardíaca y ruido en caliente.

**No-objetivos explícitos de esta fase** (quedan para fase 2 o posteriores, y ninguno tiene todavía soporte en el backend):

- Historial de sesiones (`GET /api/sessions` existe en la API pero no se consume aquí).
- Corazón 3D, panel de farmacología, monitor de constantes vitales (PA, SatO₂, temperatura), timeline de intervenciones. El motor fisiológico actual solo genera frecuencia cardíaca y niveles de ruido — nada de esto es construible sin diseñar antes esa parte del backend.
- Reconexión automática del WebSocket (coherente con el no-objetivo ya fijado para el backend en la fase B).
- Edición del catálogo de ritmos o creación de escenarios nuevos.

## 2. Arquitectura en capas

El objetivo de rendimiento (60 fps sostenidos, sin fugas, criterio de aceptación 2) descarta cualquier diseño donde el flujo continuo de muestras pase por el ciclo de reconciliación de React. La arquitectura separa explícitamente el **runtime de simulación** (datos) del **árbol de UI** (interfaz):

```
React UI  →  Zustand (estado de interfaz)  →  simulation-runtime (WS, buffer, decoder)  →  Canvas Renderer (rAF)
```

- **React** dibuja botones, paneles, sliders. Nunca toca un `Float32Array`.
- **Zustand** guarda solo estado derivado que la interfaz necesita re-renderizar: conectado/desconectado, ritmo activo, `session_id`, parámetros vigentes, pausa/congelado, layout, panel abierto. El buffer de muestras nunca vive aquí.
- **`simulation-runtime`** es el dueño de la conexión WebSocket, el decodificador binario, el buffer circular y la máquina de estados de la sesión. Se expone como un `EventEmitter` (`connected`, `started`, `updated`, `paused`, `resumed`, `stopped`, `error`, `frame`); React se suscribe a esos eventos, nunca dirige el runtime directamente desde un `useEffect` con lógica de negocio.
- **Canvas Renderer** corre su propio bucle `requestAnimationFrame`, lee el buffer circular directamente en cada tick, y dibuja. No pasa por React ni por Zustand en el camino caliente.

No se llama `engine-client` (como sugería el sketch original de la sección 9): con WS, decoder, buffer, máquina de estados, y candidatos futuros como replay o heartbeat viviendo ahí dentro, "runtime" describe mejor su responsabilidad que "cliente".

### Estructura de carpetas

```
apps/web/src/
├── simulation-runtime/
│   ├── websocket-client.ts   conexión, envío de mensajes de control, reconexión = ninguna
│   ├── frame-decoder.ts      cabecera de 40 bytes → objeto tipado, espejo exacto de frames.py
│   ├── frame-buffer.ts       buffer circular, política de underrun/overrun (objetivo 500ms, rango 300-700ms)
│   ├── session-runtime.ts    máquina de estados (idle/starting/running/paused/stopping/error), EventEmitter
│   └── index.ts
├── render/
│   ├── grid-layer.ts         rejilla clínica (1mm/5mm), prerenderizada, se redibuja solo si cambia escala/layout
│   ├── lead-canvas.ts        un canvas por derivación, lee su slice channel-major del buffer
│   ├── overlay-layer.ts      medidas, calipers — reservado, sin implementación en esta fase
│   └── layout.ts             posiciones de 1/3/6/12 derivaciones
├── ui/
│   ├── RhythmSelector.tsx
│   ├── ControlPanel/         modo básico (presets) + modo avanzado (sliders individuales)
│   └── LayoutPicker.tsx
├── state/
│   └── session-store.ts      Zustand, solo estado de interfaz
└── types/
    └── (generados o espejados desde el contrato de `apps/api`)
```

## 3. Contrato binario — consumo en el cliente

Ya fijado en la sección 5 del spec madre; aquí solo lo que le toca al cliente:

- `frame-decoder.ts` interpreta la cabecera de 40 bytes little-endian exactamente como la codifica `frames.py`: `version`, `sample_rate_hz`, `n_channels`, `n_samples_per_channel`, `sequence_number`, `t_start_s`, `session_id` (16 bytes, orden de red, sin reordenar), seguido del payload `float32` channel-major.
- `new Float32Array(buffer, 40, n)` funciona directo porque la cabecera deja el payload alineado a 4 — ya documentado en el spec, se verifica con un test.
- `sequence_number`: un salto hacia atrás descarta el frame (fuera de orden); un salto hacia adelante indica frames perdidos (se registra, no se interpola); un `session_id` distinto tras un `sequence_number` en 0 identifica un reinicio de sesión.

## 4. Dos buffers distintos: jitter de red y ventana de render

> Corregido tras la revisión final de rama: la versión original de esta sección confundía ambos buffers en uno solo (`getVisibleSamples` sobre el mismo objeto que absorbía el jitter), lo que producía un trazo de ≤700ms redibujado entero cada tick — inservible para leer un ECG en un canvas que representa varios segundos de papel.

**`FrameBuffer`** (`simulation-runtime/frame-buffer.ts`) es un amortiguador de **jitter de red**: absorbe la variación con la que llegan los trozos del backend. Objetivo 500ms, rango sano 300-700ms, del orden de un puñado de trozos.

- **Pre-roll**: no empieza a reproducirse con el primer trozo que llega — espera a acumular `targetS` antes de que `advance()` consuma nada (`isPreRolled`). Sin esto, en régimen normal el buffer vive permanentemente al borde del underrun.
- **Underrun** (buffer vacío): el trazo se congela en la última muestra dibujada y se muestra un indicador de espera de señal. Nunca se salta ni se interpola. Tras vaciarse, hay que volver a alcanzar `targetS` antes de reanudar.
- **Overrun** (>700ms, típico al volver de una pestaña en segundo plano): se descarta lo más antiguo hasta volver a `targetS` (no hasta `maxS`).

Expone `push(frame)`, `advance(elapsedS)`, `consumeNewSamples(leadIndex)` (las muestras que la última llamada a `advance()` desalojó, no todo lo que queda bufferizado) — sin conocimiento de Canvas ni de React, testeable en aislamiento.

**`SweepBuffer`** (`render/sweep-buffer.ts`) es la **ventana de render en pantalla**, uno por derivación: un anillo circular dimensionado en segundos de papel al ancho del canvas (`sweepCapacitySamples`) — con los valores por defecto del proyecto (800px, 25mm/s, 500Hz), ~4233 muestras, unos 8,5s. Dos órdenes de magnitud mayor que el buffer de jitter. Cada tick de `requestAnimationFrame` drena `consumeNewSamples()` del `FrameBuffer` hacia el `SweepBuffer` de cada derivación activa.

## 5. Renderizado — capas de Canvas

Tres capas independientes, no un único canvas ni una por derivación sin distinción de responsabilidades:

1. **`GridLayer`**: la rejilla clínica (menor 1mm, mayor 5mm; a 25mm/s, 1mm = 40ms; calibración 10mm/mV) se prerenderiza una vez y solo se recalcula si cambia la velocidad de papel, la ganancia o el layout. No se redibuja a 60fps — dibujar cientos de líneas cada frame sería trabajo desperdiciado.
2. **`LeadCanvas` × N**: un canvas por derivación activa (1, 3, 6 o 12 según el layout). Cada tick dibuja en modo barrido de monitor (`drawSweepSegment`): solo el segmento de muestras nuevas de ese tick, en la posición de píxel que le marca el cursor de escritura del `SweepBuffer` de esa derivación, nunca el anillo entero. Delante del cursor se borra una banda estrecha para separar visualmente el trazo nuevo del de la vuelta anterior. Cambiar de layout es trivial (montar/desmontar canvases), y una derivación puede evolucionar de forma independiente sin redibujar las demás.
3. **`OverlayLayer`**: capa superior para medidas e interacción (cursores, calipers). Reservada en esta fase — sin funcionalidad, solo el hueco en la arquitectura para no tener que replanificar el layout cuando se implemente.

## 6. Controles

**Ritmo y frecuencia cardíaca:**
- Selector de ritmo (`GET /api/rhythms`).
- Frecuencia cardíaca con stepper (±5) sobre el rango que devuelve `editable_parameters` del ritmo activo — nunca un rango fijo hardcodeado en el cliente.

**Ruido — dos niveles:**
- **Modo básico** (por defecto): presets de calidad de señal — Perfecta, Buena, Urgencias, Ambulancia, UCI, Muy mala, Personalizada. Cada preset fija internamente los 5 parámetros del motor (`emg_v`, `mains_v`, `baseline_v`, `motion_v`, `clip_v`); "Personalizada" es lo que aparece automáticamente si el usuario toca un slider en modo avanzado.
- **Modo avanzado** (desplegable): los 5 sliders individuales. El backend ya acepta los 5 sin cambios — el criterio de aceptación 3 ("frecuencia cardíaca y niveles de ruido modificables en caliente") pide exactamente esto.

**Render, nunca generan tráfico de red** (ya fijado en la sección 7 del spec madre): velocidad de papel (25/50mm/s), ganancia (×0,25-×2), layout (1/3/6/12). Viven en `state/session-store.ts` y solo afectan a `render/`.

**Pausar vs. congelar** — dos acciones distintas, ya diferenciadas en la sección 7 del spec madre:
- *Pausar* envía `pause`/`resume` al servidor: detiene el reloj de simulación.
- *Congelar* es una acción de cliente sobre el buffer, para medir intervalos sin detener la simulación en curso.

## 7. Backend: hueco de CORS

`apps/api` no tiene `CORSMiddleware` — hallazgo de la revisión final de la fase B, diferido a este momento porque es aquí donde por fin hace falta. Primera tarea del plan: registrar CORS en `apps/api/src/ecg_api/main.py` permitiendo el origen del dev server de Vite.

## 8. Manejo de errores

| Situación | Comportamiento |
|---|---|
| WebSocket se cierra inesperadamente | Estado "desconectado" visible. Sin reintento automático — el usuario reinicia con el selector de ritmo. |
| `error {code, detail}` del servidor | Se muestra el detalle; el socket permanece abierto salvo que el propio servidor lo cierre (código 1011, `ENGINE_FAILURE`). |
| Underrun del buffer | Trazo congelado en la última muestra + indicador de espera de señal, nunca interpolación. |
| `sequence_number` fuera de orden | Frame descartado en silencio (log de depuración). |
| `sequence_number` con salto hacia adelante | Se registra como frames perdidos; no se interpola ni se rellena. |

## 9. Testing — tres niveles

1. **Vitest** (rápido, en cada cambio):
   - `frame-decoder`: round-trip byte-exacto contra el formato real que produce `frames.py` (fixtures compartidas o generadas desde un vector de bytes conocido).
   - `frame-buffer`: underrun/overrun, y un benchmark sintético de "el coste no crece con el tiempo" — mismo patrón que ya se usó para el motor Python en la fase A (medianas de N operaciones antes/después de una ventana larga, umbral relativo).
   - `session-runtime`: la máquina de estados (transiciones válidas/inválidas, eventos emitidos).
   - Lógica de `state/session-store.ts`.
2. **Motor y API** (ya existen, de las fases A y B): golden signals y benchmarks del motor, suite de `apps/api`. No se tocan en esta fase salvo el cambio de CORS.
3. **Playwright + Chromium**: sesión larga midiendo vía CDP memoria de heap JS, fps y frames descartados — verificación real del criterio de aceptación 2, no solo aproximada por el benchmark sintético del nivel 1.

   El backend real pacea los frames a tiempo de reloj (`CHUNK_INTERVAL_S=0.1s` de `asyncio.sleep` por trozo, fase B): "10 minutos simulados" contra el backend real tardarían 10 minutos reales, inviable para un test que corre en cada CI. Este nivel usa un servidor WebSocket ligero de prueba (mock, no `apps/api`) que envía frames codificados con el mismo formato binario pero sin pacear a tiempo real — así se ejercita el mismo `frame-decoder`/`frame-buffer`/renderer con muchos más minutos de contenido comprimidos en segundos de reloj real. No sustituye una prueba manual ocasional contra el backend real; es la que corre en CI.

## 10. Relación con los criterios de aceptación de la fase 1

| Criterio | Cubierto por |
|---|---|
| 1. Los doce ritmos se ven correctamente en las doce derivaciones | Esta fase (trazado) + revisión clínica (criterio 7, independiente) |
| 2. 60fps/10min sin fugas ni deriva | Arquitectura de capas + benchmark Playwright (sección 9) |
| 3. FC y ruido modificables en caliente, sin cortes | Controles (sección 6) sobre `update`, ya soportado por la API |
| 4. Sesión reproducible desde `seed`/`params`/`engine_semver`/`engine_commit` | Ya cubierto por la fase B; esta fase no lo modifica |
| 7. Revisión clínica de los doce trazados | Independiente de esta fase — ya se hizo con el visualizador de la fase A; pendiente la revisión formal por un profesional |

Quedan fuera de esta fase, explícitamente: el historial de sesiones (criterio no ligado a ningún número, mejora de fase 2) y todo lo que dependa de farmacología o constantes vitales no modeladas por el motor.
