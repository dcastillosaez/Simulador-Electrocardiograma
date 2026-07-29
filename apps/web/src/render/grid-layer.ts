// Asume 96 CSS px por pulgada (estándar del navegador para `px`), como
// unidad de referencia para pasar de milímetros de papel a píxeles.
export const PX_PER_MM = 96 / 25.4;

export function timeToPx(tS: number, paperSpeedMmS: number): number {
  return tS * paperSpeedMmS * PX_PER_MM;
}

export function voltageToPx(vVolts: number, gainMmPerMv: number): number {
  const mv = vVolts * 1000;
  return mv * gainMmPerMv * PX_PER_MM;
}

export interface GridLines {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
}

const MINOR_SPACING_MM = 1;
const MAJOR_EVERY_N_MINOR = 5;

export function computeGridLines(widthPx: number, heightPx: number): GridLines {
  const spacingPx = MINOR_SPACING_MM * PX_PER_MM;

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

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number
): void {
  const lines = computeGridLines(widthPx, heightPx);
  ctx.clearRect(0, 0, widthPx, heightPx);

  ctx.strokeStyle = "#f4c6c6";
  ctx.lineWidth = 0.5;
  for (const x of lines.verticalMinor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMinor) drawLine(ctx, 0, y, widthPx, y);

  ctx.strokeStyle = "#e08080";
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
