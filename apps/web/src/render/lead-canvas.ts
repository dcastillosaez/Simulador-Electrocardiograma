import { timeToPx, voltageToPx } from "./grid-layer";

export interface LeadCanvasOptions {
  paperSpeedMmS: number;
  gainMmPerMv: number;
}

export function drawLeadTrace(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  sampleRateHz: number,
  options: LeadCanvasOptions,
  heightPx: number
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, heightPx);
  if (samples.length === 0) {
    return;
  }

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.beginPath();

  const dtS = 1 / sampleRateHz;
  const baselineY = heightPx / 2;

  for (let i = 0; i < samples.length; i++) {
    const x = timeToPx(i * dtS, options.paperSpeedMmS);
    const y = baselineY - voltageToPx(samples[i], options.gainMmPerMv);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

/** Capa superior para medidas e interacción (cursores, calipers). Sin
 * funcionalidad en esta fase — el hueco existe en la arquitectura para no
 * tener que replanificar el layout cuando se implemente. */
export class OverlayLayer {
  draw(_ctx: CanvasRenderingContext2D, _widthPx: number, _heightPx: number): void {
    // Reservado.
  }
}
