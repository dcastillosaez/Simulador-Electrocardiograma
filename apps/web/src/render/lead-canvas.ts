import type { EcgTheme } from "@ui-system/themes/types";
import { voltageToPx } from "./grid-layer";
import type { LayoutMetrics } from "./layout-engine";
import type { SweepBuffer } from "./sweep-buffer";

/** Todo lo que el dibujo de una tira necesita saber. Las escalas llegan ya
 * resueltas en `metrics` y el color en `theme`: el renderer no deriva escalas
 * por su cuenta ni consulta el DOM, así que sigue siendo puro. */
export interface LeadCanvasOptions {
  metrics: LayoutMetrics;
  theme: EcgTheme;
}

/** Ancho del hueco que se borra por delante del cursor de escritura, en
 * milímetros de papel. Es lo que separa visualmente el trazo nuevo del de la
 * vuelta anterior — el efecto de barrido de un monitor de cabecera.
 *
 * En milímetros y no en píxeles: con escala variable, un hueco fijo en píxeles
 * se ve enorme en una vista comprimida y ridículo en 4K. */
export const ERASE_BAND_MM = 2;

/** Escribe las muestras nuevas de este tick en el anillo de la derivación y
 * dibuja SOLO ese segmento, en la posición de píxel que le marca el cursor.
 *
 * El canvas nunca se borra entero: el trazo de la vuelta anterior sigue
 * pintado hasta que el cursor pasa por encima. Por eso escribir en el anillo
 * y dibujar ocurren aquí juntos — si el llamante empujase por su cuenta, el
 * cursor y la banda de borrado podrían desincronizarse con lo que se pinta. */
export function drawSweepSegment(
  ctx: CanvasRenderingContext2D,
  sweep: SweepBuffer,
  newSamples: Float32Array,
  sampleRateHz: number,
  options: LeadCanvasOptions,
  heightPx: number,
  hadGap = false
): void {
  if (newSamples.length === 0) {
    return;
  }

  const pxPerSample = options.metrics.pixelsPerSecond / sampleRateHz;
  const capacity = sweep.capacity;
  const sweepWidthPx = capacity * pxPerSample;
  const baselineY = heightPx / 2;

  const startIndex = sweep.writeCursor;
  // El enlace con el segmento del tick anterior solo existe si ya hay trazo
  // escrito, no acabamos de envolver (unir la posición 0 con la capacity-1
  // dibujaría una línea atravesando todo el canvas de derecha a izquierda) y
  // no hay un hueco real por delante: pérdida de frame en red o descarte por
  // overrun. Un hueco no se interpola nunca (spec §4) -- se levanta el lápiz
  // y el trazo nuevo empieza con su propio moveTo, igual que al envolver.
  const linksToPrevious = !hadGap && sweep.hasSamples && startIndex > 0;
  const previousY = linksToPrevious
    ? baselineY - voltageToPx(sweep.at(startIndex - 1), options.metrics)
    : 0;

  sweep.push(newSamples, { gapBefore: hadGap });
  // La banda borrada debe cubrir COMO MÍNIMO el tramo que se va a dibujar
  // ahora mismo (startIndex..writeCursor), no solo un hueco fijo por
  // delante del cursor nuevo: con trozos reales de 100ms (50 muestras) el
  // cursor avanza más que la banda, y una banda más estrecha que el avance
  // deja sin limpiar la cola de cada trozo — el trazo de la vuelta anterior
  // se queda ahí, mezclado con el nuevo, en cuanto se completa una vuelta.
  const eraseWidthPx =
    newSamples.length * pxPerSample + ERASE_BAND_MM * options.metrics.viewportScalePxPerMm;
  eraseBandAhead(ctx, startIndex * pxPerSample, eraseWidthPx, sweepWidthPx, heightPx);

  ctx.strokeStyle = options.theme.trace;
  ctx.lineWidth = 1;
  ctx.beginPath();

  let penDown = false;
  if (linksToPrevious) {
    ctx.moveTo((startIndex - 1) * pxPerSample, previousY);
    penDown = true;
  }
  for (let i = 0; i < newSamples.length; i++) {
    const ringIndex = (startIndex + i) % capacity;
    const x = ringIndex * pxPerSample;
    const y = baselineY - voltageToPx(newSamples[i], options.metrics);
    if (penDown && ringIndex !== 0) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      penDown = true;
    }
  }

  ctx.stroke();
}

/** Limpia una banda de `bandWidthPx` a partir de `cursorX`, envolviendo al
 * borde derecho si no cabe entera.
 *
 * Exportada para que el repintado completo (`sweep-rebuilder.ts`) reproduzca
 * el mismo hueco de barrido sin duplicar la aritmética de envolvimiento. */
export function eraseBandAhead(
  ctx: CanvasRenderingContext2D,
  cursorX: number,
  bandWidthPx: number,
  sweepWidthPx: number,
  heightPx: number
): void {
  const bandPx = Math.min(bandWidthPx, sweepWidthPx);
  const overflowPx = cursorX + bandPx - sweepWidthPx;
  if (overflowPx > 0) {
    ctx.clearRect(cursorX, 0, bandPx - overflowPx, heightPx);
    ctx.clearRect(0, 0, overflowPx, heightPx);
  } else {
    ctx.clearRect(cursorX, 0, bandPx, heightPx);
  }
}

/** Capa superior para medidas e interacción (cursores, calipers). Sin
 * funcionalidad en esta fase — el hueco existe en la arquitectura para no
 * tener que replanificar el layout cuando se implemente. */
export class OverlayLayer {
  draw(_ctx: CanvasRenderingContext2D, _widthPx: number, _heightPx: number): void {
    // Reservado.
  }
}
