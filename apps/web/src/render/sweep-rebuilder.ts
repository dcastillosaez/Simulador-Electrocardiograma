import { voltageToPx } from "./grid-layer";
import { ERASE_BAND_MM, eraseBandAhead, type LeadCanvasOptions } from "./lead-canvas";
import { fullView, type TraceView } from "./measure-geometry";
import type { SweepBuffer } from "./sweep-buffer";

/** Repinta el anillo completo sobre un canvas recién invalidado.
 *
 * Es un subsistema y no una función suelta porque el mismo algoritmo va a
 * hacer falta para bastantes cosas: cambio de tema, de layout, de zoom, de
 * velocidad de papel, de ganancia, exportar a PNG o PDF, replay y congelado.
 *
 * **Eventos que fuerzan repintado completo:** redimensionado, cambio de tema,
 * cambio de layout y cambio de `viewportScale`. Un cambio de tema no se arregla
 * reasignando `strokeStyle`: hay que reconstruir rejilla, trazo, cursor y
 * calibración.
 *
 * **Nunca entra en el camino caliente.** Jamás dentro de
 * `requestAnimationFrame`. */
export class SweepRebuilder {
  rebuild(
    ctx: CanvasRenderingContext2D,
    sweep: SweepBuffer,
    sampleRateHz: number,
    options: LeadCanvasOptions,
    heightPx: number,
    view?: TraceView
  ): void {
    const pxPerSampleValue = options.metrics.pixelsPerSecond / sampleRateHz;
    const capacity = sweep.capacity;
    const window = view ?? fullView(capacity);
    const sweepWidthPx = window.visibleSamples * pxPerSampleValue;
    const baselineY = heightPx / 2;

    ctx.clearRect(0, 0, sweepWidthPx, heightPx);
    if (!sweep.hasSamples) {
      return;
    }

    const isFull = sweep.writtenCount >= capacity;
    const cursor = sweep.writeCursor;

    ctx.strokeStyle = options.theme.trace;
    ctx.lineWidth = 1;
    ctx.beginPath();

    let penDown = false;
    for (let k = 0; k < window.visibleSamples; k++) {
      const ringIndex = (window.startRingPos + k) % capacity;
      // Antes de dar la vuelta, solo [0, cursor) tiene señal escrita: el resto
      // son los ceros de relleno del Float32Array, y pintarlos sería una línea
      // plana en la parte de la tira que nunca se ha usado.
      if (!isFull && ringIndex >= cursor) {
        break;
      }

      const x = k * pxPerSampleValue;
      const y = baselineY - voltageToPx(sweep.at(ringIndex), options.metrics);

      // Se levanta el lápiz en tres sitios, y ninguno es negociable:
      //   - k = 0, el borde izquierdo de la ventana;
      //   - una discontinuidad marcada en el anillo (pérdida de frame o
      //     descarte por overrun), que no se interpola jamás;
      //   - la frontera del cursor con el anillo lleno, donde lo anterior es
      //     lo más nuevo y esta posición lo más viejo.
      const lift =
        k === 0 ||
        sweep.isDiscontinuityAt(ringIndex) ||
        (isFull && ringIndex === cursor);

      if (penDown && !lift) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        penDown = true;
      }
    }

    ctx.stroke();

    // El hueco de barrido por delante del cursor forma parte de la imagen: sin
    // reproducirlo, tras un redimensionado el trazo aparecería cerrado en
    // círculo y se perdería la referencia de dónde está escribiendo.
    eraseBandAhead(
      ctx,
      ((cursor - window.startRingPos + capacity) % capacity) * pxPerSampleValue,
      ERASE_BAND_MM * options.metrics.viewportScalePxPerMm,
      sweepWidthPx,
      heightPx
    );
  }
}
