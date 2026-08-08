import type { EcgTheme } from "@ui-system/themes/types";
import { formatMv, formatSeconds } from "../measure/formulas";
import type { MeasurementSession } from "../measure/session";
import type { MeasurePoint } from "../measure/tools";
import { voltageToPx } from "./grid-layer";
import type { LeadName } from "./layout";
import { COLUMN_GAP_PX, STRIP_GAP_PX } from "./layout-engine";
import type { SweepBuffer } from "./sweep-buffer";
import {
  pxPerSample,
  ringPosToPx,
  type StripLayout,
  type TraceView,
} from "./measure-geometry";

export const CURSOR_LABEL_PX = 11;
const LABEL_LINE_HEIGHT_PX = 13;
const LABEL_MARGIN_PX = 8;
const LABEL_BLOCK_WIDTH_PX = 120;
export const MARKER_HANDLE_PX = 5;
/** Trazo discontinuo del cursor vivo. Lo que distingue de un vistazo «dónde
 * está el puntero» de «dónde he dejado una marca». */
const CURSOR_DASH = [4, 3];

export const MAGNIFIER_WIDTH_PX = 180;
export const MAGNIFIER_HEIGHT_PX = 180;
export const MAGNIFIER_FACTOR = 4;
const MAGNIFIER_MARGIN_PX = 12;
/** Aire entre la señal y el canto del recuadro al encuadrar. Un pico que cabe
 * justo pegado al borde se lee como un pico cortado. */
const MAGNIFIER_PADDING_PX = 10;
/** Brazo de la cruz que marca la muestra bajo el cursor dentro de la lupa. */
const MAGNIFIER_CROSS_PX = 4;

/** Qué altura de señal —en píxeles de lupa, positivos hacia arriba— queda en el
 * centro del recuadro.
 *
 * La lupa estaba clavada en el 0 mV: a ×4, cualquier R de tamaño normal se
 * salía por arriba y el recuadro enseñaba el tramo plano de al lado. Encuadrar
 * sobre lo que hay en la ventana no toca la escala —sigue siendo ×4 y la
 * rejilla sigue contando milímetros—, solo mueve por dónde está cortada.
 *
 * Cuando ni desplazando cabe la onda entera manda el cursor: el punto que se
 * está midiendo tiene que verse aunque el resto de la onda no quepa. */
export function magnifierCenterPx(
  minPx: number,
  maxPx: number,
  cursorPx: number,
  heightPx: number = MAGNIFIER_HEIGHT_PX
): number {
  if (maxPx - minPx > heightPx - 2 * MAGNIFIER_PADDING_PX) return cursorPx;
  return (minPx + maxPx) / 2;
}

/** Dónde ha quedado la lupa. `onRight` lo necesita el rótulo del cursor para
 * irse al lado contrario en vez de quedarse debajo. */
interface MagnifierBox {
  left: number;
  top: number;
  onRight: boolean;
}

export interface OverlayFrame {
  session: MeasurementSession;
  layout: StripLayout;
  view: TraceView;
  sampleRateHz: number;
  capacity: number;
  /** Muestras escritas en el anillo. Por debajo de `capacity` hay una zona sin
   * señal que no se puede medir. */
  writtenCount: number;
  /** La señal de cada derivación. La lupa la vuelve a dibujar a otra escala en
   * vez de ampliar píxeles del canvas. */
  sweeps: ReadonlyMap<LeadName, SweepBuffer>;
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

  drawUnwrittenRegion(ctx, frame, pps, heightPx);

  for (const marker of frame.session.markers) {
    drawTimeLine(ctx, marker.ringPos, frame, pps, heightPx, false);
    drawHandle(ctx, marker, frame, pps);
  }

  const hover = frame.session.hover;
  if (!hover) {
    return;
  }
  drawTimeLine(ctx, hover.ringPos, frame, pps, heightPx, true);
  drawVoltageLine(ctx, hover, frame, widthPx);

  // La lupa se coloca ANTES de escribir el rótulo, porque el rótulo necesita
  // saber de qué lado ha quedado para no acabar debajo.
  const magnifier = frame.magnifier
    ? placeMagnifier(hover, frame, pps, widthPx, heightPx)
    : null;
  if (magnifier) {
    drawMagnifier(ctx, hover, frame, pps, magnifier);
  }
  drawCursorLabel(ctx, hover, frame, pps, widthPx, magnifier);
}

/** Dónde cabe la lupa, o `null` si la derivación no está en pantalla. */
function placeMagnifier(
  hover: MeasurePoint,
  frame: OverlayFrame,
  pps: number,
  widthPx: number,
  heightPx: number
): MagnifierBox | null {
  const position = locate(hover, frame);
  if (!position) return null;

  const cursorX = position.left + ringPosToPx(hover.ringPos, frame.view, pps, frame.capacity);
  // Al lado opuesto del cursor, y volteada cerca de los bordes: la lupa no
  // puede tapar justo lo que se está mirando.
  const onRight = cursorX + MAGNIFIER_MARGIN_PX + MAGNIFIER_WIDTH_PX <= widthPx;
  return {
    left: onRight
      ? cursorX + MAGNIFIER_MARGIN_PX
      : cursorX - MAGNIFIER_MARGIN_PX - MAGNIFIER_WIDTH_PX,
    top: Math.min(Math.max(0, position.top), Math.max(0, heightPx - MAGNIFIER_HEIGHT_PX)),
    onRight,
  };
}

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
 * salen siempre de las muestras, nunca de lo que se ve aquí.
 *
 * Dentro va también el cursor con su lectura: colocar una marca con precisión
 * exige ver a la vez el punto ampliado y el número que va a quedar registrado,
 * y el rótulo de fuera queda a tamaño de pantalla, lejos del pico. */
function drawMagnifier(
  ctx: CanvasRenderingContext2D,
  hover: MeasurePoint,
  frame: OverlayFrame,
  pps: number,
  box: MagnifierBox
): void {
  const sweep = frame.sweeps.get(hover.lead);
  if (!sweep) return;

  const { left, top } = box;
  const { metrics } = frame.layout;
  const zoomPxPerSample = pps * MAGNIFIER_FACTOR;
  const zoomPxPerMm = metrics.viewportScalePxPerMm * MAGNIFIER_FACTOR;
  const centerX = left + MAGNIFIER_WIDTH_PX / 2;

  // Media ventana EN ENTERO. Con un número impar de muestras visibles, una
  // mitad fraccionaria produce un índice de anillo fraccionario, y
  // `Float32Array[173.5]` es `undefined`: se propaga como NaN hasta `lineTo` y
  // el canvas no pinta nada — recuadro negro con su rótulo y sin trazo.
  const halfSamples = Math.max(1, Math.floor(MAGNIFIER_WIDTH_PX / zoomPxPerSample / 2));

  // Encuadre: primero se mira qué hay en la ventana, después se decide por
  // dónde cortarla. Al revés —dibujar y recortar— es lo que dejaba el pico de
  // la R fuera del recuadro.
  const cursorPx = voltageToPx(hover.voltageV, metrics) * MAGNIFIER_FACTOR;
  let minPx = cursorPx;
  let maxPx = cursorPx;
  for (let i = -halfSamples; i <= halfSamples; i++) {
    const value =
      voltageToPx(sweep.at(wrapIndex(hover.ringPos + i, frame.capacity)), metrics) *
      MAGNIFIER_FACTOR;
    if (value < minPx) minPx = value;
    if (value > maxPx) maxPx = value;
  }
  const centerPx = magnifierCenterPx(minPx, maxPx, cursorPx);
  const toY = (signalPx: number) => top + MAGNIFIER_HEIGHT_PX / 2 - (signalPx - centerPx);
  const baselineY = toY(0);
  const cursorY = toY(cursorPx);

  // Se recorta al recuadro: aun encuadrada, una onda más alta que la ventana
  // se sale, y sin recorte se pintaría encima del ECG de al lado.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, MAGNIFIER_WIDTH_PX, MAGNIFIER_HEIGHT_PX);
  ctx.clip();

  ctx.fillStyle = frame.theme.background;
  ctx.fillRect(left, top, MAGNIFIER_WIDTH_PX, MAGNIFIER_HEIGHT_PX);

  // Rejilla propia, a la escala propia y en LOS DOS EJES: solo con verticales
  // se contaría tiempo pero no amplitud, y la lupa está para mirar ondas
  // pequeñas. Las horizontales cuelgan del 0 mV y no del centro del recuadro:
  // con el encuadre móvil, una rejilla anclada al centro contaría milímetros
  // desde una altura que no significa nada.
  if (zoomPxPerMm >= 1) {
    ctx.strokeStyle = frame.theme.gridMinor;
    ctx.lineWidth = 0.5;
    for (
      let x = firstGridLine(centerX, left, zoomPxPerMm);
      x <= left + MAGNIFIER_WIDTH_PX;
      x += zoomPxPerMm
    ) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + MAGNIFIER_HEIGHT_PX);
      ctx.stroke();
    }
    for (
      let y = firstGridLine(baselineY, top, zoomPxPerMm);
      y <= top + MAGNIFIER_HEIGHT_PX;
      y += zoomPxPerMm
    ) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + MAGNIFIER_WIDTH_PX, y);
      ctx.stroke();
    }
  }

  // El 0 mV, marcado: es la referencia desde la que se lee cualquier
  // desnivel, y con el encuadre móvil ya no se sabe de memoria dónde cae.
  ctx.strokeStyle = frame.theme.gridMajor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, baselineY);
  ctx.lineTo(left + MAGNIFIER_WIDTH_PX, baselineY);
  ctx.stroke();

  ctx.strokeStyle = frame.theme.trace;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -halfSamples; i <= halfSamples; i++) {
    const ringPos = wrapIndex(hover.ringPos + i, frame.capacity);
    const x = centerX + i * zoomPxPerSample;
    const y = toY(voltageToPx(sweep.at(ringPos), metrics) * MAGNIFIER_FACTOR);
    if (i === -halfSamples) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // El cursor, ampliado. La vertical cae en la muestra medida y la horizontal
  // en su voltaje: es el mismo punto que van a registrar las marcas, visto al
  // aumento al que se está decidiendo.
  ctx.strokeStyle = frame.theme.cursor;
  ctx.lineWidth = 1;
  ctx.setLineDash(CURSOR_DASH);
  ctx.beginPath();
  ctx.moveTo(centerX, top);
  ctx.lineTo(centerX, top + MAGNIFIER_HEIGHT_PX);
  ctx.moveTo(left, cursorY);
  ctx.lineTo(left + MAGNIFIER_WIDTH_PX, cursorY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(centerX - MAGNIFIER_CROSS_PX, cursorY);
  ctx.lineTo(centerX + MAGNIFIER_CROSS_PX, cursorY);
  ctx.moveTo(centerX, cursorY - MAGNIFIER_CROSS_PX);
  ctx.lineTo(centerX, cursorY + MAGNIFIER_CROSS_PX);
  ctx.stroke();

  ctx.restore();

  ctx.font = `${CURSOR_LABEL_PX}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = frame.theme.trace;
  ctx.textAlign = "left";
  ctx.fillText(`×${MAGNIFIER_FACTOR}`, left + 4, top + 4);

  // La lectura, en la esquina opuesta al rótulo de aumento y con el color del
  // cursor: dice de qué punto son estos números.
  ctx.fillStyle = frame.theme.cursor;
  ctx.textAlign = "right";
  const readout = [formatSeconds(hover.timestampS), formatMv(hover.voltageV * 1000)];
  readout.forEach((line, index) => {
    ctx.fillText(
      line,
      left + MAGNIFIER_WIDTH_PX - 4,
      top + 4 + index * LABEL_LINE_HEIGHT_PX
    );
  });
}

/** Primera línea de rejilla que cae dentro del recuadro, contando desde el
 * anclaje —el cursor a lo ancho, el 0 mV a lo alto— hacia el canto. */
function firstGridLine(anchor: number, edge: number, stepPx: number): number {
  return anchor - Math.ceil((anchor - edge) / stepPx) * stepPx;
}

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

/** Una vertical POR COLUMNA, todas al mismo desplazamiento dentro de su tira:
 * las columnas muestran el mismo instante con derivaciones distintas. */
function drawTimeLine(
  ctx: CanvasRenderingContext2D,
  ringPos: number,
  frame: OverlayFrame,
  pps: number,
  heightPx: number,
  isHover: boolean
): void {
  const { metrics } = frame.layout;
  const xInStrip = ringPosToPx(ringPos, frame.view, pps, frame.capacity);
  if (xInStrip < 0 || xInStrip > metrics.stripWidthPx) return;

  ctx.strokeStyle = frame.theme.cursor;
  ctx.lineWidth = 1;
  ctx.setLineDash(isHover ? CURSOR_DASH : []);
  for (let column = 0; column < frame.layout.leadColumns.length; column++) {
    const x = column * (metrics.stripWidthPx + COLUMN_GAP_PX) + xInStrip;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, heightPx);
    ctx.stroke();
  }
  ctx.setLineDash([]);
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
  const y =
    position.top +
    frame.layout.metrics.stripHeightPx / 2 -
    voltageToPx(point.voltageV, frame.layout.metrics);

  ctx.strokeStyle = frame.theme.cursor;
  ctx.lineWidth = 1;
  ctx.setLineDash(CURSOR_DASH);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(widthPx, y);
  ctx.stroke();
  ctx.setLineDash([]);
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
  const y =
    position.top +
    frame.layout.metrics.stripHeightPx / 2 -
    voltageToPx(marker.voltageV, frame.layout.metrics);

  ctx.strokeStyle = frame.theme.cursor;
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
  widthPx: number,
  magnifier: MagnifierBox | null
): void {
  const position = locate(point, frame);
  if (!position) return;
  const x = position.left + ringPosToPx(point.ringPos, frame.view, pps, frame.capacity);
  // Con la lupa puesta manda ella: el rótulo se va al lado contrario. Si no,
  // la lupa —que es mucho más ancha que el rótulo— lo taparía entero.
  const flip = magnifier ? magnifier.onRight : x > widthPx - LABEL_BLOCK_WIDTH_PX;

  ctx.fillStyle = frame.theme.cursor;
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

function wrapIndex(index: number, modulus: number): number {
  return ((index % modulus) + modulus) % modulus;
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
