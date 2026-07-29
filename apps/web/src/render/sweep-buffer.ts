import { PX_PER_MM } from "./grid-layer";

/** Cuántas muestras caben a lo ancho de `widthPx` al ritmo de papel dado.
 *
 * Es el tamaño de la VENTANA VISIBLE, no el del amortiguador de jitter de red
 * (`simulation-runtime/frame-buffer.ts`): con los valores por defecto del
 * proyecto (800px, 25mm/s, 500Hz) son 4233 muestras, unos 8,5 segundos de
 * papel — dos órdenes de magnitud más que los 0,7s del buffer de red. */
export function sweepCapacitySamples(
  widthPx: number,
  paperSpeedMmS: number,
  sampleRateHz: number
): number {
  const pxPerSample = (PX_PER_MM * paperSpeedMmS) / sampleRateHz;
  return Math.max(1, Math.round(widthPx / pxPerSample));
}

/** Anillo circular de una derivación: la ventana de señal que hay pintada en
 * pantalla. Escribe avanzando y envolviendo un `Float32Array` de tamaño fijo,
 * sin asignar memoria por llamada — el trazo viejo se sobrescribe poco a poco
 * por delante del cursor, que es exactamente el barrido de un monitor de
 * cabecera. */
export class SweepBuffer {
  readonly capacity: number;

  private readonly samples: Float32Array;
  private cursor = 0;
  private written = false;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.samples = new Float32Array(this.capacity);
  }

  /** Posición del anillo donde se escribirá la próxima muestra. */
  get writeCursor(): number {
    return this.cursor;
  }

  /** `false` mientras no se haya escrito ninguna muestra desde el último
   * `reset()`. Lo necesita el dibujo incremental para no enlazar el primer
   * segmento con un cero de relleno del array. */
  get hasSamples(): boolean {
    return this.written;
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }
    for (let i = 0; i < samples.length; i++) {
      this.samples[this.cursor] = samples[i];
      this.cursor = this.cursor + 1 === this.capacity ? 0 : this.cursor + 1;
    }
    this.written = true;
  }

  /** Lee una posición del anillo. Acepta índices fuera de rango (incluidos
   * negativos) y los envuelve por módulo. */
  at(index: number): number {
    const wrapped = ((index % this.capacity) + this.capacity) % this.capacity;
    return this.samples[wrapped];
  }

  /** Vacía el anillo. Al cambiar de ritmo o reiniciarse la sesión arranca un
   * eje de tiempo nuevo: mezclarlo con el trazo anterior dejaría dos ritmos
   * distintos en pantalla a la vez. */
  reset(): void {
    this.samples.fill(0);
    this.cursor = 0;
    this.written = false;
  }
}
