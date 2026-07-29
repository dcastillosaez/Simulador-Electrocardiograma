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
   * real, así que se puede testear sin temporizadores. */
  advance(elapsedS: number): void {
    let remaining = elapsedS;
    while (remaining > 0 && this.frames.length > 0) {
      const oldest = this.frames[0];
      const duration = this.frameDurationS(oldest);
      if (duration > remaining) {
        break;
      }
      this.frames.shift();
      remaining -= duration;
    }
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
  }
}
