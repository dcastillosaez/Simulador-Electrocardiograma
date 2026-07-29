import { PX_PER_MM, voltageToPx } from "./grid-layer";
import type { SweepBuffer } from "./sweep-buffer";

export interface LeadCanvasOptions {
  paperSpeedMmS: number;
  gainMmPerMv: number;
}

/** Ancho del hueco que se borra por delante del cursor de escritura. Es lo
 * que separa visualmente el trazo nuevo del de la vuelta anterior — el efecto
 * de barrido de un monitor de cabecera. A 25mm/s son unos 2mm de papel. */
export const ERASE_BAND_PX = 8;

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

  const pxPerSample = (PX_PER_MM * options.paperSpeedMmS) / sampleRateHz;
  const capacity = sweep.capacity;
  const sweepWidthPx = capacity * pxPerSample;
  const baselineY = heightPx / 2;

  const startIndex = sweep.writeCursor;
  // El enlace con el segmento del tick anterior solo existe si ya hay trazo
  // escrito, no acabamos de envolver (unir la posición 0 con la capacity-1
  // dibujaría una línea atravesando todo el canvas de derecha a izquierda) y
  // no hay un hueco real por delante: perdida de frame en red o descarte por
  // overrun. Un hueco no se interpola nunca (spec §4) -- se levanta el lapiz
  // y el trazo nuevo empieza con su propio moveTo, igual que al envolver.
  const linksToPrevious = !hadGap && sweep.hasSamples && startIndex > 0;
  const previousY = linksToPrevious
    ? baselineY - voltageToPx(sweep.at(startIndex - 1), options.gainMmPerMv)
    : 0;

  sweep.push(newSamples);
  // La banda borrada debe cubrir COMO MÍNIMO el tramo que se va a dibujar
  // ahora mismo (startIndex..writeCursor), no solo un hueco fijo por
  // delante del cursor nuevo: con trozos reales de 100ms (50 muestras) el
  // cursor avanza ~9,45px por tick, más que ERASE_BAND_PX (8px) — una banda
  // más estrecha que el avance deja sin limpiar la cola de cada trozo, y el
  // trazo de la vuelta anterior se queda ahí, mezclado con el nuevo, en
  // cuanto se completa una vuelta.
  const eraseWidthPx = newSamples.length * pxPerSample + ERASE_BAND_PX;
  eraseBandAhead(ctx, startIndex * pxPerSample, eraseWidthPx, sweepWidthPx, heightPx);

  ctx.strokeStyle = "#000000";
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
    const y = baselineY - voltageToPx(newSamples[i], options.gainMmPerMv);
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
 * borde derecho si no cabe entera. */
function eraseBandAhead(
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
