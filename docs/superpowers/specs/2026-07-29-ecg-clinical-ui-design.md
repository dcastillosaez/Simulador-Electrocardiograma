# Rediseño de interfaz — Puesto de simulación clínica (Entrega 1 de 2)

> Convierte la vista en vivo de la fase C en algo que se parezca a una consola de simulación médica, no a un dashboard web. Complementa `2026-07-28-ecg-frontend-design.md`: la arquitectura de capas (runtime / Zustand / renderer) que allí se fijó no cambia. Lo que cambia es que aparece un sistema de diseño propio y el renderer deja de tener colores y escalas escritos a mano.

## 1. Alcance

Esta entrega es visual y estructural. Monta el sistema de diseño, la shell de cinco zonas, y saca del renderer todo lo que hoy tiene hardcodeado.

**Dentro:**

- Paquete `packages/ui-system/` con tokens tipados, dos temas y 18 componentes.
- Shell de cinco zonas sobre CSS Grid: cabecera, panel de escenario, área de ECG, inspector y barra de estado.
- `LayoutEngine`: reparto del alto entre derivaciones y cadena de escalas mV → mm → px.
- Renderer tematizado: ni un color literal en `render/`.
- `SweepRebuilder`: repintado completo del anillo cuando cambia el tamaño, el tema o el layout.
- Continuidad de señal como estado del buffer (`continuityMask`).
- Inspector con lo que hoy existe: ritmo activo, frecuencia cardíaca de los parámetros y estado de conexión.

**Fuera, con motivo:**

- **Medidas clínicas en vivo (PR, QRS, QT, RR).** El motor las calcula en `measurements.py`, pero la API no las expone: no hay una sola referencia a `measure` en `apps/api`. Llevarlas a pantalla obliga a tocar motor, API, contrato de mensajes y tests de las tres capas. Es la Entrega 2 y tiene spec propio.
- **Corazón 3D y farmacología.** Los `namespace` del tema quedan abiertos, pero sin nada que los pinte cualquier valor concreto sería inventado y estaría mal el día que exista el renderizador de verdad.
- **Temas `cathlab` y `presentation`.** Mismo motivo. La arquitectura admite N temas; escribir cuatro sin una interfaz donde mirarlos es adivinar.
- **Formato de ECG impreso (4×3 más tira de ritmo).** Cada cuadrante muestra una ventana temporal distinta, así que es incompatible con el barrido continuo. Pertenece a "Exportar ECG", que es otro modelo de render: congelar y componer.
- **Regresión visual por captura.** Con dos temas y alto de tira variable el número de imágenes de referencia se dispara y son frágiles. El test de tema centinela (§10) cubre la corrección de color sin ese coste.
- **Calibración física del monitor.** El botón tipo visor DICOM, con tarjeta de referencia, queda anotado como futuro. La cadena de escalas lo permite sin tocar nada más: basta sustituir el `viewportScale` calculado por uno medido.

## 2. Principio rector

**La fuente única de verdad del diseño visual es un modelo tipado en TypeScript.** De él se generan las variables CSS que consume React. Canvas 2D y, en su día, Three.js importan el modelo directamente. El renderer nunca consulta el DOM.

Esto no es purismo. Hoy el renderer hace `ctx.strokeStyle = "#000000"` y el grid tiene `#f4c6c6` escrito en el código. Con eso, cambiar el aspecto obliga a editar el renderizador, y nada impide que el verde del CSS y el verde del canvas se separen en un dígito y nadie se entere hasta que alguien mire las dos cosas juntas.

La alternativa que se descartó fue leer las custom properties con `getComputedStyle` desde el renderer. Ata el dibujo al DOM, y `drawSweepSegment` es hoy una función pura que se testea con un `ctx` simulado; en jsdom las custom properties se comportan de forma poco fiable. Se perdería la parte de la suite que mejor funciona a cambio de nada.

## 3. `packages/ui-system`

```
packages/ui-system/
  tokens/
    tokens.ts        fuente única de valores crudos
    build.ts         genera tokens.css
    tokens.css       artefacto generado: se commitea, no se edita a mano
  themes/
    dark.ts          monitor clínico
    light.ts         papel de ECG
    index.ts         getTheme / setTheme, tipo Theme
  components/
  hooks/
  styles/
  index.ts
```

Vive en `packages/` porque conceptualmente es un módulo transversal, igual que `ecg-engine`, y no una carpeta de `apps/web`. Se importa como `@ui-system/...` mediante alias en `vite.config.ts` y `tsconfig.json`.

No se montan workspaces de npm todavía: no existe `package.json` raíz ni pnpm/turbo/nx, y hoy hay un único consumidor. Pero el paquete se escribe **con forma de paquete desde el primer día**: superficie pública explícita en `index.ts`, sin importar nada de `apps/web`, sin alcanzar dentro de las carpetas de otros módulos. El día que aparezca un segundo consumidor, promoverlo a paquete npm real es añadir un `package.json` y un `workspaces`, no reescribir nada.

### Sincronía del artefacto

`tokens.css` se genera con `npm run tokens`. Un test ejecuta `build.ts` y compara su salida con el fichero commiteado; falla si alguien lo editó a mano o si olvidó regenerarlo. Se descarta un plugin de Vite para no meter un paso de build obligatorio en desarrollo.

## 4. Theme Engine

Los tokens son valores. El tema decide qué conjunto está activo y, sobre todo, **nombra roles en vez de colores**.

```ts
theme.ecg.trace          // no "verde"
theme.ecg.gridMinor
theme.ecg.gridMajor
theme.ecg.background
theme.ecg.calibration
theme.ecg.cursor

theme.panel.background
theme.panel.border
theme.inspector.ok
theme.inspector.warning
theme.inspector.critical
```

Un rol sobrevive a un cambio de identidad visual; un nombre de color, no. Cuando llegue el modo daltonismo, `theme.inspector.critical` seguirá significando lo mismo aunque deje de ser rojo.

El tema cubre todo lo que hoy serían números mágicos: `typography` (familia, tamaño, peso, interlineado, espaciado), `radius`, `shadow`, `motion` y la escala de espaciado. Nunca `margin: 13px`; siempre `var(--space-3)`.

### Valores base

```
--color-bg           #111315
--color-panel        #181B20
--color-border       #2E3440
--color-text         #F4F5F7
--color-text-muted   #B6BDC8
--color-grid-minor   #421010
--color-grid-major   #6B1C1C
--color-ecg          #37FF90
--color-ok           #32D583
--color-warning      #FBBF24
--color-error        #EF4444

--radius-sm 6px   --radius-md 10px   --radius-lg 16px
--space-1 4px  --space-2 8px  --space-3 12px  --space-4 16px  --space-5 24px
--font-ui    Inter, "IBM Plex Sans", system-ui, sans-serif
--font-mono  "JetBrains Mono", "Roboto Mono", monospace
```

Las líneas del grid son colores sólidos, no rojos translúcidos. Sobre un fondo conocido el resultado visual es equivalente, pero el canvas se ahorra componer alfa en cada línea de cada tira en cada repintado.

El tema `light` no es un tema inventado: es el aspecto de papel que el renderer ya tiene hoy (`#f4c6c6`, `#e08080`, trazo negro), rescatado al sistema en lugar de borrado. Existe por una razón concreta además de la estética — con un solo tema la costura de intercambio no se ejercita nunca, y se descubre que no funciona el día que hace falta.

## 5. Cadena de escalas

El error a evitar es dejar que el tamaño de la ventana gobierne la escala clínica. Un milivoltio es un milivoltio; lo que depende de la pantalla es cuántos píxeles lo representan. Son tres eslabones y se mantienen separados:

```
mV ──× clinicalGain (mm/mV)──▶ mm ──× viewportScale (px/mm)──▶ px
      fisiología: no la toca         pantalla: se adapta
      el tamaño de ventana
```

`clinicalGain` es 10 mm/mV y sigue siendo verdad se mire donde se mire. `viewportScale` es lo que se adapta. `pixelsPerMillivolt` es el producto, y es lo único que el renderer necesita.

La separación paga sola en cuanto lleguen el zoom ×2, la exportación a PDF, la impresión o una pantalla Retina: ninguna de esas cosas debería obligar a la fisiología a enterarse.

Una comprobación que valida el modelo: con 152 px de tira, margen de 2 mV a cada lado y ganancia de 10 mm/mV hacen falta 40 mm verticales, luego `viewportScale = 152/40 = 3,8 px/mm`. Y `PX_PER_MM = 96/25,4 = 3,78`. Es el mismo número. El 152 px que fijó el arreglo I-2 ya era, implícitamente, la suposición de 96 dpi; ahora está explícita y tiene nombre.

Que 96 dpi sea ficción en casi cualquier monitor actual es cierto y asumido. Los simuladores comerciales tampoco logran escala física exacta: mantienen proporciones y relación temporal, y ofrecen calibración a quien la necesite. Ese es el camino previsto.

## 6. LayoutEngine y LayoutMetrics

```
ResizeObserver → LayoutEngine → LayoutMetrics → Renderer
```

El `LayoutEngine` existe como pieza propia, y no como una llamada suelta a `clamp()`, porque es donde vivirán las decisiones de reparto que vengan después: ECG junto a corazón 3D, pantalla partida, modo presentación, monitor ultrapanorámico. Ninguna de ellas debería obligar a tocar el renderer.

```ts
export interface LayoutMetrics {
  stripHeightPx: number;
  compression: "normal" | "compact" | "very-compact";
  clinicalGainMmPerMv: number;
  viewportScalePxPerMm: number;
  pixelsPerMillivolt: number;   // clinicalGain × viewportScale
  pixelsPerSecond: number;      // paperSpeedMmS × PX_PER_MM
}

export function computeLayoutMetrics(
  availableHeightPx: number,
  leadCount: number,
  clinicalGainMmPerMv: number,
  paperSpeedMmS: number,
): LayoutMetrics;
```

### Reparto del alto

Cada tira recibe `clamp(52, (alto_disponible − huecos) / n, 140)` píxeles, con `--space-1` (4 px) de hueco entre tiras.

| Pantalla | Central aprox. | 12 derivaciones |
| --- | --- | --- |
| Portátil 1366×768 | ~560 px | ~46 px, por debajo del mínimo |
| 1080p | ~850 px | ~70 px, banda ideal |
| 1440p | ~1210 px | ~100 px |
| 4K | ~1900 px | tope de 140 px, sobrante repartido |

**El mínimo es blando.** Con doce derivaciones en un portátil no caben 52 px. No se hace scroll —un monitor clínico no scrollea, y perderlo destruye la sensación de monitorización continua— y no se ocultan derivaciones en silencio, que en algo clínico es inaceptable. Las tiras se comprimen más y la interfaz lo declara.

El indicador es clínico, no técnico: 🟢 Normal · 🟡 Vista compacta · 🔴 Vista muy compacta, con umbrales en ≥65 px, 52–65 px y <52 px. El tooltip explica: *"Altura disponible insuficiente para la representación óptima de 12 derivaciones."* En pantalla no aparece nunca un `46 px/tira`: ni el médico ni el alumno saben qué hacer con ese número.

### Eje horizontal

`pixelsPerSecond` queda atado a la velocidad de papel y **no** se adapta al alto. Si `viewportScale` gobernara los dos ejes, comprimir doce derivaciones en un portátil daría ~1,15 px/mm, o sea unos 27 segundos por pantalla: un garabato ilegible.

El precio es que bajo compresión fuerte la relación de aspecto se aplana y la morfología se lee peor. Por eso `compression` viaja dentro de las métricas y la interfaz lo declara: es una degradación informada, no silenciosa.

## 7. Shell de cinco zonas

```
grid-template-areas:
  "header  header  header"
  "sidebar ecg     inspector"
  "status  status  status";
grid-template-columns: 280px 1fr 320px;
grid-template-rows: auto 1fr auto;
height: 100dvh;
```

CSS Grid para la shell; Flexbox solo dentro de componentes.

`100dvh` y no `100vh`: en tablet y móvil la barra del navegador falsea `vh` y el layout da saltos al aparecer y desaparecer.

El área central lleva `min-height: 0`. Sin eso, un hijo con contenido fuerza el desbordamiento de la fila, el grid crece más allá del viewport y reaparece el scroll que se acaba de descartar. Es el fallo clásico de Grid y conviene dejarlo escrito.

El panel derecho es contextual y cambiará —inspector ahora, corazón 3D después, farmacología más tarde—. El área de ECG no se mueve nunca.

### Grid del ECG, por tira

Hoy hay un canvas de rejilla de 800×600 posicionado en absoluto que no se alinea con las tiras que van debajo. Pasa a dibujarse dentro de cada tira, en su propio canvas de fondo, con las dimensiones reales de esa tira.

Además de arreglar la alineación, hace cada tira autónoma: mañana se puede ampliar, congelar o resaltar una derivación sin tocar el resto.

## 8. Componentes

Dieciocho piezas, en cinco grupos.

| Grupo | Componentes |
| --- | --- |
| Layout | `AppShell` · `Header` · `Sidebar` · `Inspector` · `StatusBar` |
| Surface | `Panel` · `SectionTitle` · `Divider` · `ControlGroup` |
| Data | `Metric` · `MetricGrid` · `Badge` |
| Controls | `Slider` · `Stepper` · `SegmentedControl` · `Select` |
| Foundation | `Icon` · `Tooltip` |

`Foundation` es una capa, no una categoría más: todo lo demás acaba dependiendo de esas dos piezas.

`Icon` es un envoltorio, no un sistema de iconos. Sin él, los SVG de pausa, play, stop, conexión, error y exportar acaban repartidos por media aplicación.

`Tooltip` se construye aunque `title=""` cubriría el único caso de hoy: en cuanto lleguen las medidas del inspector, la explicación de PR/QRS/QT, las alarmas y los parámetros de ruido, hará falta de todos modos. Es `position: absolute`, cuatro posiciones, sin portal y sin animación compleja.

`SegmentedControl` absorbe los radios de derivaciones (1/3/6/12), los presets de calidad de señal, la velocidad de papel y el selector de tema. Es la pieza que da aspecto de consola y evita cuatro componentes casi iguales.

Quedan fuera `Dialog` y `Toast` (nada los dispara en esta entrega), `MetricCard` y `Tag` (se solapan con `Metric` y `Badge`), `PresetButton` (es `SegmentedControl`) y `Toolbar` (es `Header`).

## 9. Renderer: qué cambia

### `grid-layer.ts`

`computeGridLines` deja de usar `PX_PER_MM` y pasa a `metrics.viewportScalePxPerMm`. `voltageToPx(v, gain)` pasa a recibir las métricas y usar `pixelsPerMillivolt`. `PX_PER_MM` sobrevive degradado: ya no lo consume el dibujo, es el `viewportScale` por defecto que `computeLayoutMetrics` toma como referencia.

### `lead-canvas.ts`

El `#000000` sale a `theme.ecg.trace`. Tema y métricas entran por `LeadCanvasOptions`, que ya existe, en vez de como parámetros posicionales octavo y noveno de una función que ya tiene siete:

```ts
interface LeadCanvasOptions {
  metrics: LayoutMetrics;   // sustituye a paperSpeedMmS y gainMmPerMv
  theme: EcgTheme;
}
```

`paperSpeedMmS` y `gainMmPerMv` desaparecen de aquí: son entradas de `computeLayoutMetrics`, no del dibujo. El renderer solo necesita el resultado (`pixelsPerSecond`, `pixelsPerMillivolt`), y así no puede derivar su propia escala por su cuenta.

`ERASE_BAND_PX = 8` pasa a `ERASE_BAND_MM = 2`. Su propio comentario ya dice que a 25 mm/s son unos 2 mm de papel: estaba expresado en las unidades equivocadas. Con escala variable, un hueco fijo en píxeles se ve enorme comprimido y ridículo en 4K.

El `clearRect` se mantiene: sobre el canvas de trazo deja ver el canvas de rejilla que va debajo, que es exactamente lo que se busca.

### `sweep-buffer.ts`

La capacidad del anillo depende de `pixelsPerSecond`, así que ahora cambia también al redimensionar la ventana, no solo al cambiar el layout o la frecuencia de muestreo.

## 10. Continuidad de la señal y repintado

### La continuidad es estado del buffer

Mientras el renderer dibuja segmento a segmento, basta con saber si *este* trozo venía precedido de un hueco. En cuanto hay que reconstruir la imagen entera desde el buffer, eso deja de bastar: el buffer ya no representa `valor(t)` sino `(valor, continuidad)`.

Por eso `SweepBuffer` gana un `continuityMask`: un `Uint8Array` paralelo al `Float32Array` de muestras. El nombre no es `gapBuffer` porque el mismo mecanismo servirá para cambio de sesión, pausa, pérdida de frames y discontinuidades intencionadas.

Sin esto, el arreglo I-3 —no interpolar los huecos por pérdida de frame o descarte de overrun— sobrevive exactamente hasta el primer redimensionado de ventana, momento en el que un repintado completo uniría con línea recta discontinuidades que en su día se dibujaron con el lápiz levantado.

### `SweepRebuilder`

Asignar `canvas.width` o `canvas.height` borra el contenido del canvas. Al redimensionar, el ECG quedaría en blanco hasta que el barrido diera la vuelta entera, unos ocho segundos.

El repintado completo es un subsistema, no una función suelta, porque el mismo algoritmo va a hacer falta para bastantes cosas: cambio de tema, de layout, de zoom, de velocidad de papel, de ganancia, exportar a PNG o PDF, replay y congelado.

```ts
class SweepRebuilder {
  rebuild(ctx, buffer, metrics, theme): void;
}
```

**Eventos que fuerzan repintado completo:** redimensionado, cambio de tema, cambio de layout y cambio de `viewportScale`.

Un cambio de tema no se arregla reasignando `strokeStyle`: hay que reconstruir rejilla, trazo, cursor y calibración.

**El repintado completo no entra jamás en el camino caliente.** Nunca dentro de `requestAnimationFrame`.

## 11. Descomposición de `ECGWorkspace`

Hoy son 230 líneas que hacen ciclo de vida del runtime, refs de canvas, buffers de barrido, bucle de animación, cálculo de layout y todo el JSX.

```
ECGWorkspace              orquestación y nada más
├── useSimulationRuntime  attach/detach, connect/disconnect
├── useLayoutMetrics      ResizeObserver → LayoutEngine → LayoutMetrics
├── useSweepRenderer      bucle rAF, buffers, refs de canvas
└── EcgDisplay            contenedor medido
    └── LeadStrip × n     canvas de rejilla + canvas de trazo + etiqueta
```

## 12. Contrato de migración

El rediseño es visual. **El árbol de accesibilidad se conserva.**

Ningún `role`, `aria-label` ni `data-testid` que hoy afirme un test desaparece. En concreto `data-testid="lead-canvas-${lead}"`, del que depende el benchmark de rendimiento con Playwright, y los `role="status"`, `role="alert"`, `role="radiogroup"` y `aria-label` de los paneles de control.

Si una pieza nueva obliga a cambiar un nombre accesible, se cambia el test de forma explícita y se justifica. Nunca por accidente.

## 13. Testing

**Tema centinela.** El guardarraíl principal. Se dibuja con un `Theme` de colores absurdos y se afirma que todo `strokeStyle` y `fillStyle` que el renderer asigna procede de ese objeto. Si alguien reintroduce un literal, el test cae.

Es exactamente el tipo de test que le faltaba a los presets de ruido: aquel bug pasó porque ningún test afirmaba nada sobre los valores, solo sobre el round-trip de `matchPreset`.

**Equivalencia incremental ↔ repintado.** Dibujar N ticks incrementales y reconstruir el mismo buffer con `SweepRebuilder` deben producir la misma secuencia de trazos. Ata las dos rutas y, en concreto, verifica que el repintado respeta la `continuityMask` en vez de interpolar.

**`computeLayoutMetrics`.** Fronteras del clamp (51, 52, 65, 140, 141), los tres niveles de compresión, y la cadena de escalas: `pixelsPerMillivolt === clinicalGain × viewportScale`, con el caso de referencia de 152 px que debe dar 3,8 px/mm.

**Sincronía de tokens.** Ejecutar `build.ts` y comparar con el `tokens.css` commiteado.

**Contrato de accesibilidad.** Un test que enumera los roles, `aria-label` y el `data-testid` vigentes y comprueba que siguen presentes. Convierte la regla del §12 en algo verificable.

**`continuityMask`.** Escritura, envolvimiento del anillo y reinicio en `clear()`.

## 14. Relación con la Entrega 2

La Entrega 2 lleva las medidas clínicas del motor a la pantalla: `measurements.py` ya calcula frecuencia, RR con su desviación, PR, duración de QRS, QT y amplitud de R, y `BeatBasedSource` expone `events(t0_s, t1_s)`, así que calcular sobre una ventana móvil en el servidor es viable. En fibrilación ventricular saldrán NaN, que es lo clínicamente correcto: no hay PR ni QT que medir.

Esta entrega le deja el hueco preparado: el `Inspector` y los componentes `Metric` y `MetricGrid` existen, y `theme.inspector.ok/warning/critical` ya está definido. Añadir las medidas será rellenar una rejilla que ya está montada, no rediseñar el panel.
