import type { EcgTheme } from "@ui-system/themes/types";
// Solo el tipo: `layout-engine.ts` importa `PX_PER_MM` de aquí, así que un
// import de valor cerraría un ciclo en tiempo de ejecución. `import type` se
// borra al compilar y no crea dependencia real.
import type { LayoutMetrics } from "./layout-engine";

/** Píxeles por milímetro que asume el navegador para la unidad `px` (96 dpi).
 *
 * Ya no lo consume el dibujo: es el `viewportScale` por defecto, la referencia
 * de la que parte `computeLayoutMetrics`. Que 96 dpi sea ficción en casi
 * cualquier monitor actual es cierto y asumido; los simuladores comerciales
 * tampoco logran escala física exacta, mantienen proporciones y ofrecen
 * calibración a quien la necesite. */
export const PX_PER_MM = 96 / 25.4;

export function timeToPx(tS: number, metrics: LayoutMetrics): number {
  return tS * metrics.pixelsPerSecond;
}

export function voltageToPx(vVolts: number, metrics: LayoutMetrics): number {
  return vVolts * 1000 * metrics.pixelsPerMillivolt;
}

export interface GridLines {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
}

const MINOR_SPACING_MM = 1;
const MAJOR_EVERY_N_MINOR = 5;

export function computeGridLines(
  widthPx: number,
  heightPx: number,
  metrics: LayoutMetrics
): GridLines {
  const spacingPx = MINOR_SPACING_MM * metrics.viewportScalePxPerMm;

  const verticalMinor: number[] = [];
  const verticalMajor: number[] = [];
  for (let i = 0; i * spacingPx <= widthPx; i++) {
    const x = i * spacingPx;
    verticalMinor.push(x);
    if (i % MAJOR_EVERY_N_MINOR === 0) verticalMajor.push(x);
  }

  const horizontalMinor: number[] = [];
  const horizontalMajor: number[] = [];
  for (let i = 0; i * spacingPx <= heightPx; i++) {
    const y = i * spacingPx;
    horizontalMinor.push(y);
    if (i % MAJOR_EVERY_N_MINOR === 0) horizontalMajor.push(y);
  }

  return { verticalMinor, verticalMajor, horizontalMinor, horizontalMajor };
}

/** Dibuja fondo y rejilla de UNA tira, con sus dimensiones reales.
 *
 * Antes había un único canvas de rejilla de 800x600 posicionado en absoluto que
 * no se alineaba con las tiras de debajo. Por tira, además de cuadrar, hace
 * cada derivación autónoma: se puede ampliar, congelar o resaltar una sin
 * tocar el resto. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  metrics: LayoutMetrics,
  theme: EcgTheme
): void {
  const lines = computeGridLines(widthPx, heightPx, metrics);

  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.strokeStyle = theme.gridMinor;
  ctx.lineWidth = 0.5;
  for (const x of lines.verticalMinor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMinor) drawLine(ctx, 0, y, widthPx, y);

  ctx.strokeStyle = theme.gridMajor;
  ctx.lineWidth = 1;
  for (const x of lines.verticalMajor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMajor) drawLine(ctx, 0, y, widthPx, y);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
