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
export const MAGNIFIER_HEIGHT_PX = 120;
export const MAGNIFIER_FACTOR = 4;
const MAGNIFIER_MARGIN_PX = 12;

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
  drawCursorLabel(ctx, hover, frame, pps, widthPx);
  if (frame.magnifier) {
    drawMagnifier(ctx, hover, frame, pps, widthPx, heightPx);
  }
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
  const left =
    cursorX + MAGNIFIER_MARGIN_PX + MAGNIFIER_WIDTH_PX > widthPx
      ? cursorX - MAGNIFIER_MARGIN_PX - MAGNIFIER_WIDTH_PX
      : cursorX + MAGNIFIER_MARGIN_PX;
  const top = Math.min(Math.max(0, position.top), heightPx - MAGNIFIER_HEIGHT_PX);

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
    const ringPos =
      (((hover.ringPos - samples / 2 + i) % frame.capacity) + frame.capacity) % frame.capacity;
    const x = left + i * zoomPxPerSample;
    const y =
      centerY - voltageToPx(sweep.at(ringPos), frame.layout.metrics) * MAGNIFIER_FACTOR;
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
  widthPx: number
): void {
  const position = locate(point, frame);
  if (!position) return;
  const x = position.left + ringPosToPx(point.ringPos, frame.view, pps, frame.capacity);
  const flip = x > widthPx - LABEL_BLOCK_WIDTH_PX;

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
