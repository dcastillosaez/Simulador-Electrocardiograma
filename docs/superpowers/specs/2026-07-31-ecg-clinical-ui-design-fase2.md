# ECG Simulator — Rediseño clínico de la interfaz (Fase 2 de UI)

**Fecha:** 2026-07-31
**Estado:** propuesta de diseño, pendiente de plan de implementación
**Alcance:** evolución visual de `packages/ui-system` y de su ensamblado en `apps/web/src/ui/ECGWorkspace.tsx`, ambos construidos en la fase C (`2026-07-28-ecg-frontend-design.md`). No toca el motor, la API ni el runtime de simulación salvo donde se indica explícitamente (sección 10).

---

## 0. Punto de partida: esto no se construye desde cero

La propuesta que da origen a este documento habla de "crear un Design System completo" y de "rediseñar el layout como estación clínica de cinco zonas". Antes de entrar en detalle vale la pena decirlo sin rodeos: las dos cosas ya existen. La fase C dejó construido:

- Un `AppShell` de cinco zonas fijas — header, sidebar, ecg, inspector, status — en CSS Grid (`components/layout/AppShell.tsx`), con un hueco ya reservado para contenido futuro en el panel derecho. El propio código lo dice: *"el panel derecho es contextual y cambiará —inspector ahora, corazón 3D después, farmacología más tarde—"* (`AppShell.tsx:12-15`).
- Tokens de color, espaciado, tipografía, radio y sombra (`tokens/tokens.ts`), con dos temas completos y ya intercambiables en caliente (`themes/dark.ts`, `themes/light.ts`).
- Componentes de layout (`Header`, `Sidebar`, `Inspector`, `StatusBar`), de superficie (`Panel`, `SectionTitle`, `Divider`), de datos (`Metric`, `MetricGrid`, `Badge`) y de control (`SegmentedControl`, `Stepper`, `Slider`, `Select`, `IconButton`, `NumberField`).
- Un set de iconos propio (`components/foundation/Icon.tsx`), diez trazados SVG dibujados a mano — la misma filosofía "discreta, sin librería de iconos enorme" que pedía el punto 8 de la propuesta original.

Esta fase no reemplaza nada de lo anterior. Ajusta valores de tokens, reorganiza el contenido de cada zona y añade lo que falta de verdad: indicador de conexión en el header, pestañas en la sidebar, color por estado clínico del ritmo activo, y la instrumentación (fps real, ocupación del buffer) que el status bar necesita para mostrar algo más que lo que ya expone el store hoy. Cada sección siguiente sigue el mismo patrón: **hoy** → **cambia** → **nuevo de verdad**.

## 1. Filosofía

Un monitor de cabecera (Philips, GE, Dräger) no se parece a una aplicación web porque no tiene que venderse a nadie: existe para que un clínico lea una constante vital en menos de un segundo, desde cualquier ángulo de la habitación, sin ambigüedad. Esta fase persigue esa misma economía visual — no un tema oscuro "bonito" encima del layout actual, sino la misma jerarquía de información que tendría un monitor real: el trazado manda, las cifras se leen sin esfuerzo, y todo lo demás (selectores, botones, ajustes) se retira a un segundo plano hasta que se necesita. Sin copiar literalmente el aspecto de ninguna marca — el simulador no necesita parecer un dispositivo médico certificado, solo comunicar con la misma disciplina.

## 2. Header — de navbar a estación

**Hoy** (`Header.tsx` + `Header.module.css`): un `<h1>` con el título en mayúsculas a 14px (`--font-size-md`) y, a la derecha, un slot con `LayoutPicker`, el `SegmentedControl` de tema, el de ganancia (con tooltip), y los tres `IconButton` de congelar/exportar/grabar. No hay indicador de conexión, ni frecuencia de muestreo, ni número de derivaciones activas, ni el nombre del ritmo en curso — toda esa información vive hoy solo en el inspector o el status bar.

**Cambia:**
- El título sube de 14px a un tamaño propio de "display" (ver sección 8) — deja de competir visualmente con sus propios controles.
- Se añade, junto al título, el nombre del ritmo activo (`selectedRhythm.display_name`, ya disponible en `ECGWorkspace.tsx:317`) como subtítulo — es la primera cifra que un clínico busca al entrar en la sala.
- Los controles existentes (`LayoutPicker`, tema, ganancia, congelar, exportar, grabar) no desaparecen — se agrupan visualmente a la derecha, con más separación entre grupos (ver sección 7) para que dejen de leerse como una fila continua de botones.

**Nuevo:**
- Indicador de conexión: un punto de color + etiqueta (`● Conectado` / `● Desconectado` / `● Congelado`), derivado de `store.connectionState` — hoy ese estado solo se muestra como texto crudo en el status bar (`ECGWorkspace.tsx:338`), nunca en el header. Reutiliza los tonos ya definidos en `Theme.inspector` (`ok`/`warning`/`critical`); "desconectado" necesita un cuarto tono neutro que hoy no existe en `types.ts` (ver sección 10).
- "500 Hz" y "12 Leads": ambos datos ya existen en el store (`sampleRateHz`, y el número de derivaciones se deriva de `leadColumns`/`layout`) pero hoy solo aparecen, parcialmente, en el status bar. Se muestran también en el header como metadatos fijos de la sesión.

## 3. Sidebar — panel clínico, no lista de controles

**Hoy** (`ECGWorkspace.tsx:252-279`): un único `Panel` con `SectionTitle` "Paciente", el `RhythmSelector`, y debajo `BasicControlPanel` o `AdvancedControlPanel` según el modo. Todo apilado dentro del mismo panel, sin separación visual entre "qué ritmo" y "qué frecuencia" y "qué calidad de señal".

**Cambia:**
- Dentro del panel, cada bloque (ritmo, frecuencia, calidad de señal) pasa a tener su propio espaciado vertical generoso en vez de vivir pegado al anterior — ver sección 7 sobre espaciado. No es un componente nuevo, es aplicar `gap` mayor entre los hijos de `Panel` y, si hace falta, un `Divider` (ya existe, `components/surface/Divider.tsx`) entre bloques.
- El control de frecuencia cardíaca (`HeartRateControl.tsx`, hoy un `Stepper`) se mantiene funcionalmente igual; el pedido de un `[-] 72 [+]` grande y centrado es un ajuste de `Stepper.module.css`, no un componente nuevo.

**Nuevo:**
- Pestañas de primer nivel en la sidebar: **ECG** (activa), **Corazón**, **Fármacos**, **Historial** — inertes salvo "ECG". Esto es la aplicación directa, en la sidebar, del mismo principio que ya está documentado para el panel derecho: reservar el hueco ahora para que la fase D y la futura fase de farmacología no requieran rediseñar el layout, solo activar una pestaña. Requiere un componente `TabBar` o similar que hoy no existe en `packages/ui-system` — es la única pieza de UI genuinamente nueva de esta sección.

## 4. Área de ECG — que parezca un instrumento, no una `<div>`

**Hoy** (`EcgDisplay.module.css`, `ECGWorkspace.module.css:23-32`): el área de ECG es la celda `main` del grid, sin borde, sin fondo propio, sin separación visual del resto de la shell — el lienzo de Canvas ocupa directamente el espacio disponible.

**Cambia:**
- El contenedor de `EcgDisplay` recibe esquinas redondeadas (`--radius-lg`, 16px, ya existe en tokens), un borde de 1px con el color `panel.border` del tema activo, una sombra sutil (`--shadow-card`, ya existe) y un fondo apenas distinto del fondo general de la shell — no el mismo `ink900` a secas, sino un tono intermedio entre `ink900` e `ink850` para que se lea como pantalla propia sin dejar de ser oscuro. Ninguno de estos tokens es nuevo; es la primera vez que se aplican al contenedor del ECG en vez de solo a los paneles.
- El grid interno (`GridLayer`) y el trazado no cambian: siguen siendo responsabilidad del renderer de Canvas, ajeno a este contenedor.

**A verificar en implementación — protagonismo del 70%:** con `grid-template-columns: 280px 1fr 320px` (`AppShell.module.css:13`), la columna central ya es la que más espacio recibe, pero el reparto exacto depende del ancho de ventana: en 1440px de ancho, sidebar + inspector fijos (600px) más gaps y padding dejan la columna central en torno al 55-60%, no al 70% que pide el punto 10 de la propuesta. Para acercarse al 70% en resoluciones de escritorio habituales (1440-1920px) hay que reducir el ancho fijo de sidebar/inspector (por ejemplo a 240px/260px) o pasar a `clamp()` en vez de píxeles fijos. Este ajuste se valida visualmente durante la implementación, no se fija aquí a ciegas.

## 5. Inspector — tarjetas, no números sueltos

**Hoy** (`ECGWorkspace.tsx:290-334`, `Metric.module.css`, `MetricGrid.module.css`): ya es, de hecho, una cuadrícula de tarjetas — `Metric` ya separa etiqueta/valor/unidad, ya usa fuente monoespaciada con cifras tabulares para que el número no "baile" al cambiar, y ya soporta los tonos `ok`/`warning`/`critical`. Lo que pide el punto 4 de la propuesta (Frecuencia, PR, QRS, QTc como tarjetas separadas con mucho espacio) es, en gran parte, lo que ya hay.

**Cambia:**
- `MetricGrid` hoy usa `gap: var(--space-3)` (12px) en una cuadrícula cuyo número de columnas no está fijado explícitamente en el CSS leído — para el efecto "UCI, muchísimo espacio" que pide la propuesta, sube a `--space-5` (24px) y probablemente pasa de 2 columnas a 1 en el ancho actual del inspector (320px), o el inspector se ensancha ligeramente. Se decide en implementación comparando ambas opciones en pantalla.
- El tamaño de la cifra (`--font-size-lg`, 18px hoy) puede subir para las métricas principales (Frecuencia) frente a las secundarias (PR/QRS/QTc/RR) — una jerarquía dentro de la propia jerarquía, coherente con que la frecuencia cardíaca es la que más rápido se necesita leer.

**Nuevo:** nada estructural — es el bloque que menos cambia de toda la propuesta.

## 6. Status bar — indicadores reales, no solo texto

**Hoy** (`ECGWorkspace.tsx:337-363`, `StatusBar.module.css`): una fila con `connectionState` crudo, `sampleRateHz`, ganancia efectiva, velocidad de papel, segundos por tira, `framesLost`, un `Badge` de compresión, y el reloj. Ya es una barra real con `Badge` (indicador), no una simple línea de texto — el punto 5 de la propuesta ("no texto, una barra real, con indicadores") ya está parcialmente resuelto.

**Cambia:**
- `connectionState` deja de mostrarse en crudo (`"running"`, `"idle"`, `"paused"`) y se traduce a las etiquetas clínicas del sketch original: `READY` (idle, antes de arrancar), `LIVE` (running), `PAUSED` (congelado), `DESCONECTADO`.

**Nuevo — esto es instrumentación, no solo CSS:**
- **fps real**: hoy no se mide en ningún sitio. El bucle de `requestAnimationFrame` vive en `useSweepRenderer` (o el hook equivalente que gestiona el render loop); hace falta un contador de fotogramas por segundo ahí dentro, expuesto de vuelta al componente para pintarlo en el status bar. No existe today ninguna fuente de este dato.
- **Ocupación del buffer en ms**: `FrameBuffer` (`simulation-runtime/frame-buffer.ts`, documentado en la sección 4 del spec de fase C) ya conoce internamente su ocupación frente a `targetS`/`maxS`, pero no expone ese valor a `session-store.ts` — el store hoy solo trackea `framesLost`. Hace falta un getter en `FrameBuffer` y un puente hasta el store (o hasta donde viva el `StatusBar`) para mostrar algo como "Buffer 498 ms".

Ambos puntos son trabajo de instrumentación en el runtime de simulación, no maquetación — quien planifique esta fase debe saber que el status bar del sketch no es solo un reordenamiento visual de lo que ya hay.

## 7. Espaciado — más aire

Los tokens de espaciado (`tokens.ts:39-45`) ya cubren casi todo lo que pide el punto 6 de la propuesta: `space-3` (12px) para "entre controles" y `space-4` (16px) para "entre paneles" ya existen y ya se usan — `Panel.module.css` los aplica hoy exactamente así. Lo que falta es el espaciado **entre zonas** de la shell: `AppShell.module.css:6-7` usa `gap: var(--space-2)` (8px) y `padding: var(--space-2)` (8px) para toda la shell, muy por debajo de los 20-24px que pide la propuesta.

**Cambia:**
- `.shell` en `AppShell.module.css` pasa su `gap` y `padding` de `--space-2` (8px) a `--space-5` (24px). Es el cambio de mayor impacto visual de todo el documento con el menor esfuerzo de implementación: una línea de CSS que afecta a las cinco zonas a la vez.
- Revisar que ningún panel interno dependa de ese gap ajustado para su propio `min-height: 0` (la nota ya existente en `AppShell.module.css:25-29` sobre el fallo clásico de Grid sigue aplicando con el nuevo valor).

## 8. Tipografía — cuatro tamaños, no cinco

**Hoy** (`tokens.ts:58-64`): `xs` 11px, `sm` 12px, `md` 14px, `lg` 18px, `xl` 24px — cinco escalones. La propuesta pide cuatro: 30px (título), 18px (secciones), 14px (controles), 12px (información secundaria).

**Cambia:**
- `lg` (18px) ya coincide con "secciones" y `md` (14px) ya coincide con "controles" — no se tocan.
- `sm` (12px) cubre "información secundaria"; `xs` (11px) queda como el único tamaño realmente redundante — candidato a fundirse con `sm` salvo en las etiquetas en mayúsculas con `letter-spacing` (`SectionTitle`, `.label` de `Metric`) donde el tamaño más pequeño compensa visualmente el tracking añadido. Se revisa caso por caso al implementar, no se elimina a ciegas.
- `xl` (24px) no llega a los 30px que pide el título. Se añade un tamaño nuevo — `display`, 30px — reservado para el `<h1>` del header exclusivamente. `xl` se mantiene para donde ya se usa hoy.

**A decidir en implementación:** `SectionTitle` hoy renderiza a 11px (`xs`), pensado como etiqueta discreta ("PACIENTE" en mayúsculas). Si se sube a 18px como sugiere literalmente el sketch, deja de leerse como etiqueta y empieza a competir con el título del header. Recomendación: mantener `SectionTitle` como está y reservar el nivel de 18px para dónde ya se usa (encabezados de tarjeta, nombres de pestaña), no forzar el cambio solo por igualar el número del sketch.

## 9. Iconografía

Ya resuelta en su planteamiento — `Icon.tsx` es exactamente la filosofía "discreta, sin Material Icons enormes, tipo Lucide" que pide el punto 8 de la propuesta, con 10 trazados propios (`play`, `pause`, `stop`, `ecg`, `signal`, `warning`, `error`, `download`, `settings`, `heart`).

**Nuevo:** faltan los iconos que necesitan las pestañas nuevas de la sidebar (sección 3) — algo tipo píldora/jeringuilla para "Fármacos" y un trazado de gráfico para "Historial". Se añaden al mismo `PATHS` de `Icon.tsx` cuando se implementen esas pestañas, no antes.

## 10. Color — ajuste de paleta, no sustitución

La paleta que propone el punto 9 está a un ajuste fino, no a una ruptura, de la que ya existe en `tokens.ts:12-37`:

| Rol | Pedido | Actual (`palette`) | Diferencia |
|---|---|---|---|
| Fondo | `#111418` | `ink900` `#111315` | mínima |
| Panel | `#181D22` | `ink850` `#181B20` | mínima |
| Bordes | `#2B323B` | `ink700` `#2E3440` | mínima |
| Texto primario | `#E7ECF3` | `ink100` `#F4F5F7` | el actual es más blanco/frío; el pedido reduce fatiga visual en sesiones largas |
| Texto secundario | `#9AA6B2` | `ink300` `#B6BDC8` | el pedido es más oscuro — más contraste de jerarquía frente al primario |
| Verde ECG | `#2CFF88` | `phosphorGreen` `#37FF90` | prácticamente intercambiables |

**Cambia:** se actualizan los seis valores de `palette` en `tokens.ts` a los pedidos exactos. Al vivir en un único fichero fuente (según su propio comentario, "de él se genera el CSS que consume React, y de él importan directamente el renderer de Canvas y, en su día, Three.js"), el cambio se propaga solo — no hay que tocar CSS modules individuales.

**Nuevo — y esto sí toca dos capas, no solo tokens:**
- El punto 13 de la propuesta (color por estado según el ritmo: sinusal verde, taquicardia ámbar, TV rojo, FV rojo intenso, asistolia gris) necesita un tono `critical-intenso` y un tono `neutral`/apagado que hoy no existen en `Theme.inspector` (`types.ts:20`, solo `ok`/`warning`/`critical`).
- Más importante: **de dónde sale el mapeo ritmo → tono**. El spec de fase 1 fija como principio arquitectónico que "el catálogo describe ritmos; el código no contiene casos especiales por ritmo" — ni un `if rhythm_id == "..."`. Codificar el color por ritmo con un switch en el frontend violaría ese principio tan directamente como hacerlo en el motor. La solución consistente con el resto del proyecto es añadir un campo de severidad clínica (`severity` o similar) a cada entrada del catálogo que devuelve `GET /api/rhythms`, y que el frontend se limite a leerlo. Esto convierte una tarea aparentemente solo visual en un cambio pequeño de **`apps/api`** también — se señala aquí para que no se descubra a mitad de implementación.

## 11. Microanimaciones

Los tokens de movimiento ya existen (`tokens.ts:83-87`: `fast` 120ms, `normal` 200ms, `slow` 320ms) y ya se pueden aplicar a los tres casos que pide el punto 11 de la propuesta sin inventar nada: hover suave (`fast`), transición de color por estado (`normal`), expansión de panel al abrir una pestaña de la sidebar (`slow`). No se añaden animaciones nuevas ni se anima nunca el propio trazado o el grid del ECG — ahí la regla sigue siendo la de la fase C: redibujar solo el segmento nuevo, nunca transiciones decorativas sobre el Canvas.

## 12. Hueco para el corazón 3D — una discrepancia a resolver, no ahora

El sketch de la propuesta dibuja el corazón 3D como una fila nueva bajo el área de ECG, dentro de la misma columna central. El `AppShell` ya construido en fase C reserva ese hueco de otra forma: rotando el contenido del **panel derecho** (inspector → corazón 3D → farmacología), sin tocar la columna central ni el grid.

Son dos decisiones de layout distintas y no se decide aquí cuál gana — la fase D todavía no tiene spec propio. Por ahora se recomienda no tocar el grid: mantener el diseño ya construido (rotación del panel derecho) porque es el que ya existe y no reabre una decisión de arquitectura ya tomada y documentada. Si al llegar la fase D se prefiere la fila bajo el ECG del sketch, ese spec futuro lo decide con el corazón 3D delante, no en abstracto.

## 13. Farmacología

Cubierto por la pestaña "Fármacos" de la sidebar (sección 3). Sin backend ni lógica de dominio para farmacología, la pestaña existe pero permanece inerte — igual que "Historial" ya lo está hoy conceptualmente al no consumir `GET /api/sessions`.

## 14. No-objetivos explícitos de esta fase

| No hay | Por qué | Cuándo |
|---|---|---|
| Corazón 3D funcional | No hay spec ni motor de renderizado 3D todavía | Fase D |
| Farmacología funcional | Sin modelo de dominio ni backend para fármacos | Fase futura, no numerada aún |
| Historial de sesiones funcional | Ya era no-objetivo en la fase C (`GET /api/sessions` existe pero no se consume) | Sigue sin fecha |
| Cambio de familia tipográfica | Inter/IBM Plex Sans ya cumplen; el problema era la escala, no la fuente | Nunca, salvo decisión de marca explícita |
| Animaciones sobre el trazado o el grid del ECG | El renderer de Canvas redibuja solo el segmento nuevo por diseño (fase C); una transición decorativa ahí competiría con la lectura clínica | No aplica |
| Resolver la ubicación exacta del corazón 3D (fila vs. panel rotado) | Depende de decisiones que solo tiene sentido tomar con el spec de fase D delante | Fase D |

## 15. Orden de implementación sugerido

El orden que propone la conclusión original se mantiene, con el matiz de que el "paso 1" es mucho más corto de lo que suena porque el design system ya existe:

1. **Tokens** (sección 10 y 8): actualizar `palette` y añadir el tamaño `display` y los tonos de estado que faltan. Un par de ficheros, sin tocar componentes.
2. **Espaciado de la shell** (sección 7): un cambio de una línea en `AppShell.module.css` con el mayor impacto visual del documento.
3. **Header y status bar** (secciones 2 y 6): indicador de conexión, ritmo activo visible, traducción de estados; la instrumentación de fps y buffer se planifica aparte por tocar el runtime, no solo la UI.
4. **Sidebar con pestañas** (sección 3): el único componente nuevo de verdad de esta fase (`TabBar`).
5. **Contenedor del ECG como instrumento** (sección 4): borde, sombra, fondo propio; validar visualmente el reparto de ancho hacia el 70%.
6. **Color por estado de ritmo** (sección 10): requiere primero decidir el campo de severidad en el catálogo de `apps/api` — es la única pieza de este documento que no es solo frontend.

## 16. Verificación

Sin cambios de comportamiento ni de contrato de datos (salvo el campo de severidad del punto 10, que sí necesita su propio test de contrato en `apps/api`), la verificación de esta fase es sobre todo visual y de accesibilidad:

- `accessibility-contract.test.tsx` (ya existe en `apps/web/src/ui/`) sigue pasando sin cambios — ningún ajuste de esta fase retira un `role` o un landmark existente.
- Contraste WCAG AA de los nuevos valores de texto (`#E7ECF3` y `#9AA6B2`) sobre los nuevos fondos (`#111418`, `#181D22`) se verifica antes de dar por cerrada la sección 10 — un ajuste "para reducir fatiga visual" que rompiera contraste sería un paso atrás.
- Revisión visual manual en ambos temas (`dark`/`light`) tras cada cambio de tokens — el tema claro comparte los mismos roles semánticos y un ajuste mal aislado en `palette` puede afectarlo sin que nadie lo esté mirando.
