import type { DecodedFrame } from "./frame-decoder";

export interface FrameBufferOptions {
  targetS?: number;
  minS?: number;
  maxS?: number;
}

export class FrameBuffer {
  readonly targetS: number;
  readonly minS: number;
  readonly maxS: number;

  private frames: DecodedFrame[] = [];
  private pendingS = 0;

  constructor(options: FrameBufferOptions = {}) {
    this.targetS = options.targetS ?? 0.5;
    this.minS = options.minS ?? 0.3;
    this.maxS = options.maxS ?? 0.7;
  }

  private frameDurationS(frame: DecodedFrame): number {
    return frame.nSamplesPerChannel / frame.sampleRateHz;
  }

  get bufferedDurationS(): number {
    return this.frames.reduce((sum, frame) => sum + this.frameDurationS(frame), 0);
  }

  get isUnderrun(): boolean {
    return this.frames.length === 0;
  }

  push(frame: DecodedFrame): void {
    this.frames.push(frame);
    while (this.bufferedDurationS > this.maxS && this.frames.length > 1) {
      this.frames.shift();
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
    let remaining = this.pendingS + elapsedS;
    while (this.frames.length > 0) {
      const duration = this.frameDurationS(this.frames[0]);
      if (duration > remaining) {
        break;
      }
      this.frames.shift();
      remaining -= duration;
    }
    // Si el buffer se vació durante el drenaje, no se acumula deuda: una
    // parada prolongada del streaming no debe hacer que el primer frame
    // que llegue después se consuma al instante sin llegar a dibujarse.
    this.pendingS = this.frames.length > 0 ? remaining : 0;
  }

  getVisibleSamples(leadIndex: number): Float32Array {
    const totalSamples = this.frames.reduce(
      (sum, frame) => sum + frame.nSamplesPerChannel,
      0
    );
    const result = new Float32Array(totalSamples);
    let offset = 0;
    for (const frame of this.frames) {
      const start = leadIndex * frame.nSamplesPerChannel;
      result.set(
        frame.channelsV.subarray(start, start + frame.nSamplesPerChannel),
        offset
      );
      offset += frame.nSamplesPerChannel;
    }
    return result;
  }

  clear(): void {
    this.frames = [];
    this.pendingS = 0;
  }
}
