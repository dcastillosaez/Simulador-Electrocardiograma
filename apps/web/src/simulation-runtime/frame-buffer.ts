import type { DecodedFrame } from "./frame-decoder";

export interface FrameBufferOptions {
  targetS?: number;
  minS?: number;
  maxS?: number;
}

export interface PushOptions {
  /** Hueco real por delante de este trozo: perdida de frame detectada en la
   * red (secuencia no consecutiva). El renderer lo usa para no unir este
   * trozo con el trazo anterior mediante una línea recta. */
  gapBefore?: boolean;
}

interface BufferEntry {
  frame: DecodedFrame;
  gapBefore: boolean;
}

/** Devuelto por `consumeNewSamples` cuando no hay nada que consumir. Es
 * inmutable de facto (longitud 0) y se comparte para no asignar un
 * `Float32Array` por derivación en cada uno de los ~60 ticks por segundo en
 * los que no se completa ningún trozo. */
const NO_SAMPLES = new Float32Array(0);

/** Igual que `NO_SAMPLES`, para la lista de índices. */
const NO_INDICES = new Float64Array(0);

/** Amortiguador de jitter de RED: absorbe la variación con la que llegan los
 * trozos del backend (objetivo 500ms, rango sano 300-700ms). NO es la ventana
 * visible en pantalla — esa es `render/sweep-buffer.ts`, que se dimensiona en
 * segundos de papel al ancho del canvas y es dos órdenes de magnitud mayor.
 * Confundir ambos fue la causa raíz del trazo de 9px parpadeante. */
export class FrameBuffer {
  readonly targetS: number;
  readonly minS: number;
  readonly maxS: number;

  private entries: BufferEntry[] = [];
  private pendingS = 0;
  private preRolled = false;
  /** Trozos desalojados por la ÚLTIMA llamada a `advance()`. Se sobrescribe
   * en cada llamada: representa lo nuevo de este tick, no un histórico. */
  private justConsumed: BufferEntry[] = [];

  constructor(options: FrameBufferOptions = {}) {
    this.targetS = options.targetS ?? 0.5;
    this.minS = options.minS ?? 0.3;
    this.maxS = options.maxS ?? 0.7;
  }

  private frameDurationS(frame: DecodedFrame): number {
    return frame.nSamplesPerChannel / frame.sampleRateHz;
  }

  get bufferedDurationS(): number {
    return this.entries.reduce((sum, entry) => sum + this.frameDurationS(entry.frame), 0);
  }

  get isUnderrun(): boolean {
    return this.entries.length === 0;
  }

  /** `true` desde que lo acumulado alcanza `targetS` por primera vez (y tras
   * cada vaciado, desde que vuelve a alcanzarlo). Concepto distinto de
   * `isUnderrun`: este dice "aún no hay reserva suficiente para empezar",
   * aquel dice "ya no queda nada". Ambos hacen esperar señal en la interfaz,
   * pero por motivos opuestos. */
  get isPreRolled(): boolean {
    return this.preRolled;
  }

  push(frame: DecodedFrame, options: PushOptions = {}): void {
    this.entries.push({ frame, gapBefore: options.gapBefore ?? false });
    let buffered = this.bufferedDurationS;
    // El disparador de la limpieza es superar `maxS`, pero el punto de parada
    // es `targetS` (spec §4: "descartar lo más antiguo hasta volver al
    // objetivo"). Parar en `maxS` dejaba el buffer pegado al techo tras cada
    // aluvión, sin margen para el siguiente pico de jitter.
    if (buffered > this.maxS) {
      let discardedAny = false;
      while (buffered > this.targetS && this.entries.length > 1) {
        this.entries.shift();
        discardedAny = true;
        buffered = this.bufferedDurationS;
      }
      // El propio descarte por overrun abre un hueco real en la señal: el
      // trozo que sobrevive ya no es contiguo con lo último dibujado, igual
      // que si se hubiese perdido en la red. Sin esto, el renderer uniría
      // ambos lados con una línea recta que finge continuidad donde en
      // realidad falta señal (spec §4: nunca interpolar).
      if (discardedAny) {
        this.entries[0].gapBefore = true;
      }
    }
    if (!this.preRolled && buffered >= this.targetS) {
      this.preRolled = true;
    }
  }

  /** Simula el paso de `elapsedS` segundos de reproducción, descartando los
   * trozos ya consumidos por completo. Determinista: no depende del reloj
   * real, así que se puede testear sin temporizadores.
   *
   * El resto fraccionario se acumula en `pendingS` de una llamada a la
   * siguiente. Sin esto, invocado a cadencia de `requestAnimationFrame`
   * (~16,7ms) contra trozos de 100ms, `duration > remaining` es cierto en
   * CADA tick y la función nunca consume nada: el buffer no drena jamás
   * por reproducción, solo por el descarte de `push()` al superar `maxS`,
   * y el underrun (`isUnderrun`) nunca se detecta en la práctica salvo
   * antes del primer frame o tras `clear()`. */
  advance(elapsedS: number): void {
    this.justConsumed = [];
    // Mientras no se haya hecho pre-roll no se reproduce nada: los trozos se
    // siguen acumulando vía `push()`, simplemente no se consumen todavía.
    // Sin esto, en régimen normal (trozos de 100ms cada 100ms) el buffer
    // arranca con el primero que llega y vive al borde del underrun, sin
    // reserva alguna que gastar cuando la red hipa.
    if (!this.preRolled) {
      return;
    }
    let remaining = this.pendingS + elapsedS;
    while (this.entries.length > 0) {
      const duration = this.frameDurationS(this.entries[0].frame);
      if (duration > remaining) {
        break;
      }
      this.justConsumed.push(this.entries.shift()!);
      remaining -= duration;
    }
    // Si el buffer se vació durante el drenaje, no se acumula deuda: una
    // parada prolongada del streaming no debe hacer que el primer frame
    // que llegue después se consuma al instante sin llegar a dibujarse.
    this.pendingS = this.entries.length > 0 ? remaining : 0;
    if (this.entries.length === 0) {
      this.preRolled = false;
    }
  }

  /** Muestras de la derivación `leadIndex` desalojadas por la última llamada
   * a `advance()`, en orden cronológico. Vacío si `advance()` no ha corrido,
   * fue un no-op por falta de pre-roll, o no completó ningún trozo esa vez.
   *
   * Es seguro llamarlo una vez por derivación en el mismo tick: no consume
   * nada por sí mismo, solo lee lo que `advance()` apartó. */
  consumeNewSamples(leadIndex: number): Float32Array {
    if (this.justConsumed.length === 0) {
      return NO_SAMPLES;
    }
    const totalSamples = this.justConsumed.reduce(
      (sum, entry) => sum + entry.frame.nSamplesPerChannel,
      0
    );
    const result = new Float32Array(totalSamples);
    let offset = 0;
    for (const entry of this.justConsumed) {
      const frame = entry.frame;
      const start = leadIndex * frame.nSamplesPerChannel;
      result.set(
        frame.channelsV.subarray(start, start + frame.nSamplesPerChannel),
        offset
      );
      offset += frame.nSamplesPerChannel;
    }
    return result;
  }

  /** Índices absolutos de las muestras desalojadas por el último `advance()`,
   * en el mismo orden y con la misma longitud que `consumeNewSamples()`.
   *
   * Se apoya en un invariante del backend: el motor genera de forma contigua
   * desde `t = 0` en trozos de tamaño fijo (`simulation.py:117`), así que
   * `tStartS * sampleRateHz` es exactamente el índice de la primera muestra
   * del trozo.
   *
   * Con un hueco de red los índices SALTAN, que es justo lo que ocurrió:
   * seguir contando fingiría una continuidad que no existe, y las medidas que
   * se tomen a caballo del hueco saldrían cortas.
   *
   * Se lee una vez por tick, no una por derivación: las doce comparten eje. */
  consumedSampleIndices(): Float64Array {
    if (this.justConsumed.length === 0) {
      return NO_INDICES;
    }
    const totalSamples = this.justConsumed.reduce(
      (sum, entry) => sum + entry.frame.nSamplesPerChannel,
      0
    );
    const result = new Float64Array(totalSamples);
    let offset = 0;
    for (const entry of this.justConsumed) {
      const frame = entry.frame;
      const base = Math.round(frame.tStartS * frame.sampleRateHz);
      for (let i = 0; i < frame.nSamplesPerChannel; i++) {
        result[offset + i] = base + i;
      }
      offset += frame.nSamplesPerChannel;
    }
    return result;
  }

  /** `true` si algún trozo desalojado por el último `advance()` traía un
   * hueco real por delante (pérdida de red o descarte por overrun). El
   * renderer lo usa para levantar el lápiz en vez de unir el trazo nuevo con
   * el del tick anterior mediante una línea recta. */
  get justConsumedHadGap(): boolean {
    return this.justConsumed.some((entry) => entry.gapBefore);
  }

  clear(): void {
    this.entries = [];
    this.pendingS = 0;
    this.preRolled = false;
    this.justConsumed = [];
  }
}
