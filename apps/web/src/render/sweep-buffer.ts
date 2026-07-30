/** Cuántas muestras caben a lo ancho de `widthPx` a la escala horizontal dada.
 *
 * Recibe `pixelsPerSecond` (de `LayoutMetrics`) y no la velocidad de papel:
 * quien decide cuántos píxeles vale un segundo es el `LayoutEngine`, y pasarle
 * la velocidad en milímetros obligaría a esta función a rederivar la escala por
 * su cuenta, que es como se acaba teniendo dos escalas distintas en la misma
 * pantalla.
 *
 * Es el tamaño de la VENTANA VISIBLE, no el del amortiguador de jitter de red
 * (`simulation-runtime/frame-buffer.ts`): con los valores por defecto del
 * proyecto (800px, 25mm/s, 500Hz) son 4233 muestras, unos 8,5 segundos de
 * papel — dos órdenes de magnitud más que los 0,7s del buffer de red. */
export function sweepCapacitySamples(
  widthPx: number,
  pixelsPerSecond: number,
  sampleRateHz: number
): number {
  const pxPerSample = pixelsPerSecond / sampleRateHz;
  return Math.max(1, Math.round(widthPx / pxPerSample));
}

export interface SweepPushOptions {
  /** Hay un hueco real de señal justo antes de estas muestras: pérdida de
   * frame en red o descarte por overrun. */
  gapBefore?: boolean;
}

/** Anillo circular de una derivación: la ventana de señal que hay pintada en
 * pantalla. Escribe avanzando y envolviendo un `Float32Array` de tamaño fijo,
 * sin asignar memoria por llamada — el trazo viejo se sobrescribe poco a poco
 * por delante del cursor, que es exactamente el barrido de un monitor de
 * cabecera.
 *
 * Guarda dos cosas por posición: el valor y si ahí empieza una discontinuidad.
 * Mientras el dibujo era solo incremental, la continuidad era un detalle del
 * renderer; en cuanto hay que reconstruir la imagen entera desde el anillo
 * pasa a ser estado de la señal, porque sin ella el repintado uniría con línea
 * recta huecos que se dibujaron con el lápiz levantado. */
export class SweepBuffer {
  readonly capacity: number;

  private readonly samples: Float32Array;
  /** Paralelo a `samples`: 1 donde empieza una discontinuidad. No se llama
   * `gapMask` porque el mismo mecanismo servirá para cambio de sesión, pausa y
   * discontinuidades intencionadas. */
  private readonly continuityMask: Uint8Array;
  private cursor = 0;
  private written = false;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.samples = new Float32Array(this.capacity);
    this.continuityMask = new Uint8Array(this.capacity);
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

  /** Muestras escritas desde el último `reset()`, saturado en `capacity`. Lo
   * necesita el repintado completo para no pintar como línea plana la parte
   * del anillo que todavía no se ha escrito nunca. */
  get writtenCount(): number {
    return this.count;
  }

  push(samples: Float32Array, options: SweepPushOptions = {}): void {
    if (samples.length === 0) {
      return;
    }
    for (let i = 0; i < samples.length; i++) {
      this.samples[this.cursor] = samples[i];
      // Solo la primera muestra del trozo hereda la marca; el resto la limpia.
      // Limpiar es imprescindible: el anillo se reescribe cada vuelta, y una
      // marca vieja sin borrar reaparecería como un corte fantasma.
      this.continuityMask[this.cursor] = i === 0 && options.gapBefore ? 1 : 0;
      this.cursor = this.cursor + 1 === this.capacity ? 0 : this.cursor + 1;
    }
    this.written = true;
    this.count = Math.min(this.capacity, this.count + samples.length);
  }

  /** Lee una posición del anillo. Acepta índices fuera de rango (incluidos
   * negativos) y los envuelve por módulo. */
  at(index: number): number {
    return this.samples[this.wrap(index)];
  }

  /** `true` si en esa posición empieza una discontinuidad y por tanto no debe
   * unirse con la muestra anterior. */
  isDiscontinuityAt(index: number): boolean {
    return this.continuityMask[this.wrap(index)] === 1;
  }

  /** Vacía el anillo. Al cambiar de ritmo o reiniciarse la sesión arranca un
   * eje de tiempo nuevo: mezclarlo con el trazo anterior dejaría dos ritmos
   * distintos en pantalla a la vez. */
  reset(): void {
    this.samples.fill(0);
    this.continuityMask.fill(0);
    this.cursor = 0;
    this.written = false;
    this.count = 0;
  }

  private wrap(index: number): number {
    return ((index % this.capacity) + this.capacity) % this.capacity;
  }
}
