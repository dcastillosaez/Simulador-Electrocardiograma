import { describe, expect, it } from "vitest";
import { FrameBuffer } from "./frame-buffer";
import type { DecodedFrame } from "./frame-decoder";

function makeFrame(overrides: Partial<DecodedFrame> = {}): DecodedFrame {
  const nSamplesPerChannel = overrides.nSamplesPerChannel ?? 50;
  const nChannels = overrides.nChannels ?? 2;
  return {
    version: 1,
    sampleRateHz: 500,
    nChannels,
    nSamplesPerChannel,
    sequenceNumber: 0,
    tStartS: 0,
    sessionId: "00000000-0000-0000-0000-000000000000",
    channelsV: new Float32Array(nChannels * nSamplesPerChannel),
    ...overrides,
  };
}

describe("FrameBuffer", () => {
  it("empieza vacío y en underrun", () => {
    const buffer = new FrameBuffer();
    expect(buffer.isUnderrun).toBe(true);
    expect(buffer.bufferedDurationS).toBe(0);
  });

  it("acumula duración al empujar trozos de 100ms (50 muestras a 500Hz)", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
    expect(buffer.isUnderrun).toBe(false);
  });

  it("descarta lo mas antiguo al superar el maximo (overrun)", () => {
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    for (let i = 0; i < 10; i++) {
      buffer.push(makeFrame({ sequenceNumber: i }));
    }
    expect(buffer.bufferedDurationS).toBeLessThanOrEqual(0.7);
  });

  it("advance() consume trozos completos y respeta los parciales", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ sequenceNumber: 0 }));
    buffer.push(makeFrame({ sequenceNumber: 1 }));
    expect(buffer.bufferedDurationS).toBeCloseTo(0.2);

    buffer.advance(0.05); // menos que un trozo (0.1s): no descarta nada
    expect(buffer.bufferedDurationS).toBeCloseTo(0.2);

    buffer.advance(0.1); // consume el primer trozo entero
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
  });

  it("advance() mas alla de lo disponible deja el buffer vacio (underrun)", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    buffer.advance(10);
    expect(buffer.bufferedDurationS).toBe(0);
    expect(buffer.isUnderrun).toBe(true);
  });

  it("advance() acumula el resto entre llamadas: a cadencia real de rAF (~16.7ms) SI drena el buffer", () => {
    // Sin acumular el resto, duration(0.1s) > remaining(1/60s) es cierto en
    // CADA tick y advance() nunca consume nada -- el buffer no drenaria
    // jamas por reproduccion a la cadencia real con la que ECGWorkspace lo
    // llama, y el indicador de underrun seria decorativo.
    const buffer = new FrameBuffer();
    for (let i = 0; i < 10; i++) {
      buffer.push(makeFrame({ sequenceNumber: i })); // 10 x 100ms = 1.0s
    }
    expect(buffer.bufferedDurationS).toBeGreaterThan(0);

    for (let tick = 0; tick < 70; tick++) {
      buffer.advance(1 / 60);
    }
    // 70 ticks a 1/60s = 1,1667s de reproduccion simulada, mas que
    // suficiente para drenar 1,0s de contenido sin que llegue nada nuevo.
    expect(buffer.bufferedDurationS).toBe(0);
    expect(buffer.isUnderrun).toBe(true);
  });

  it("advance() no acumula deuda tras un underrun: un frame nuevo no se consume al instante", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ sequenceNumber: 0 })); // 0.1s
    buffer.advance(5); // agota el buffer y, si acumulase deuda, dejaria ~4.9s pendientes
    expect(buffer.isUnderrun).toBe(true);

    buffer.push(makeFrame({ sequenceNumber: 1 })); // llega un frame nuevo tras el underrun
    expect(buffer.isUnderrun).toBe(false);
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
  });

  it("getVisibleSamples concatena las muestras del canal pedido, en orden de llegada", () => {
    const buffer = new FrameBuffer();
    buffer.push(
      makeFrame({
        nChannels: 2,
        nSamplesPerChannel: 2,
        channelsV: new Float32Array([1, 2, 10, 20]), // canal 0: [1,2], canal 1: [10,20]
      })
    );
    buffer.push(
      makeFrame({
        nChannels: 2,
        nSamplesPerChannel: 2,
        channelsV: new Float32Array([3, 4, 30, 40]),
      })
    );

    expect(Array.from(buffer.getVisibleSamples(0))).toEqual([1, 2, 3, 4]);
    expect(Array.from(buffer.getVisibleSamples(1))).toEqual([10, 20, 30, 40]);
  });

  it("clear() vacia el buffer", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    buffer.clear();
    expect(buffer.isUnderrun).toBe(true);
  });

  it("el coste de push()+advance() no crece con el numero de operaciones", () => {
    // Mismo patrón que el benchmark del motor Python (fase A, tarea 17):
    // medianas de N operaciones antes y después de una ventana larga,
    // umbral relativo en vez de un suelo fijo que un jitter cualquiera
    // dejaría siempre por debajo.
    const buffer = new FrameBuffer();
    const median = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const timeNOperations = (n: number): number[] => {
      const durations: number[] = [];
      for (let i = 0; i < n; i++) {
        const start = performance.now();
        buffer.push(makeFrame({ sequenceNumber: i }));
        buffer.advance(0.1);
        durations.push(performance.now() - start);
      }
      return durations;
    };

    const early = median(timeNOperations(25));
    for (let i = 0; i < 5000; i++) {
      buffer.push(makeFrame({ sequenceNumber: i }));
      buffer.advance(0.1);
    }
    const late = median(timeNOperations(25));

    expect(late).toBeLessThan(Math.max(early * 4, 1));
  });
});
