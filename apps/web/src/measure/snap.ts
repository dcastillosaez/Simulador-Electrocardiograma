import type { LayoutMetrics } from "../render/layout-engine";
import type { TraceView } from "../render/measure-geometry";
import type { SweepBuffer } from "../render/sweep-buffer";

export type SnapMode = "signal" | "grid" | "rpeak";

/** Media ventana de búsqueda del pico R, en segundos. 150 ms a cada lado cubre
 * el QRS más ancho sin llegar a la T del latido anterior. */
export const RPEAK_WINDOW_S = 0.15;

/** Amplitud mínima para considerar que hay una R. Por debajo no se engancha:
 * es preferible no enganchar a enganchar en un artefacto. */
export const RPEAK_MIN_MV = 0.25;

export interface SnapInput {
  rawRingPos: number;
  rawVoltageV: number;
}

export interface SnapContext {
  sweep: SweepBuffer;
  sampleRateHz: number;
  metrics: LayoutMetrics;
  view: TraceView;
  capacity: number;
}

export interface SnapResult {
  ringPos: number;
  voltageV: number;
  /** `false` cuando el modo pedía enganchar y no había dónde. La interfaz lo
   * muestra: un snap que falla en silencio hace creer que se midió una R
   * cuando se midió un punto cualquiera. */
  snapped: boolean;
}

/** Dónde cae realmente la marca.
 *
 * El modo `rpeak` de esta fase es una AYUDA A LA INTERACCIÓN, no una detección
 * de QRS: busca el máximo en valor absoluto de una ventana. En la fase F2 pasa
 * a usar el fiducial que publica el motor y deja de ser una heurística; la
 * interfaz no cambia, cambia de dónde sale el número. */
export function snap(input: SnapInput, mode: SnapMode, ctx: SnapContext): SnapResult {
  switch (mode) {
    case "grid":
      return snapToGrid(input, ctx);
    case "rpeak":
      return snapToRPeak(input, ctx);
    default:
      return snapToSignal(input.rawRingPos, ctx, true);
  }
}

/** El voltaje sale del trazo, nunca del puntero: así no se mide el fondo. */
function snapToSignal(ringPos: number, ctx: SnapContext, snapped: boolean): SnapResult {
  return { ringPos, voltageV: ctx.sweep.at(ringPos), snapped };
}

function snapToGrid(input: SnapInput, ctx: SnapContext): SnapResult {
  const samplesPerMm = ctx.sampleRateHz / paperSpeedOf(ctx.metrics);
  const offset = wrap(input.rawRingPos - ctx.view.startRingPos, ctx.capacity);
  const snappedOffset = Math.round(offset / samplesPerMm) * samplesPerMm;

  const mvPerMm = 1 / ctx.metrics.clinicalGainMmPerMv;
  const mv = input.rawVoltageV * 1000;

  return {
    ringPos: wrap(ctx.view.startRingPos + Math.round(snappedOffset), ctx.capacity),
    voltageV: (Math.round(mv / mvPerMm) * mvPerMm) / 1000,
    snapped: true,
  };
}

function snapToRPeak(input: SnapInput, ctx: SnapContext): SnapResult {
  const halfWindow = Math.round(RPEAK_WINDOW_S * ctx.sampleRateHz);
  const threshold = RPEAK_MIN_MV / 1000;

  let bestPos = -1;
  let bestAbs = 0;
  for (let offset = -halfWindow; offset <= halfWindow; offset++) {
    const pos = wrap(input.rawRingPos + offset, ctx.capacity);
    const abs = Math.abs(ctx.sweep.at(pos));
    if (abs > bestAbs) {
      bestAbs = abs;
      bestPos = pos;
    }
  }

  const isLocalMax =
    bestPos >= 0 &&
    bestAbs >= Math.abs(ctx.sweep.at(wrap(bestPos - 1, ctx.capacity))) &&
    bestAbs >= Math.abs(ctx.sweep.at(wrap(bestPos + 1, ctx.capacity)));

  if (bestAbs < threshold || !isLocalMax) {
    return snapToSignal(input.rawRingPos, ctx, false);
  }
  return snapToSignal(bestPos, ctx, true);
}

/** La velocidad vigente, recuperada de las métricas: `pixelsPerSecond` son
 * milímetros por segundo multiplicados por la escala. */
function paperSpeedOf(metrics: LayoutMetrics): number {
  return metrics.pixelsPerSecond / metrics.viewportScalePxPerMm;
}

function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
