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

  it("el overrun descarta hasta volver al OBJETIVO, no solo hasta el maximo", () => {
    // Spec §4: "se descarta lo más antiguo hasta recuperar el objetivo".
    // Parar en `maxS` dejaba el buffer pegado al techo tras cada aluvión
    // (p. ej. al volver de una pestaña en segundo plano), sin margen para
    // el siguiente pico de jitter.
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    // 8 trozos de 100ms = 0,8s: el octavo push es el que dispara el overrun.
    for (let i = 0; i < 8; i++) {
      buffer.push(makeFrame({ sequenceNumber: i }));
    }
    // Con la política antigua (parar en `maxS`) aquí quedarían 0,7s.
    expect(buffer.bufferedDurationS).toBeLessThanOrEqual(0.5 + 1e-9);
    // Y no se pasa de frenada: queda dentro de un trozo (0,1s) del objetivo.
    expect(buffer.bufferedDurationS).toBeGreaterThan(0.5 - 0.1 - 1e-9);
  });

  it("no descarta nada por debajo del maximo, aunque ya se haya superado el objetivo", () => {
    // El disparador del overrun es superar `maxS`, no `targetS` -- sin este
    // test, cambiar la condicion de `push()` a `> targetS` habria dejado
    // pasar los dos tests de arriba igual (ambos superan tambien `maxS`).
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    // 6 trozos de 100ms = 0,6s: por encima de targetS (0,5s), por debajo de
    // maxS (0,7s).
    for (let i = 0; i < 6; i++) {
      buffer.push(makeFrame({ sequenceNumber: i }));
    }
    expect(buffer.bufferedDurationS).toBeCloseTo(0.6);
  });

  it("advance() consume trozos completos y respeta los parciales", () => {
    // `targetS` explícito y pequeño para aislar la mecánica de consumo de la
    // del pre-roll (que se cubre en sus propios tests).
    const buffer = new FrameBuffer({ targetS: 0.1, minS: 0.05, maxS: 0.7 });
    buffer.push(makeFrame({ sequenceNumber: 0 }));
    buffer.push(makeFrame({ sequenceNumber: 1 }));
    expect(buffer.bufferedDurationS).toBeCloseTo(0.2);

    buffer.advance(0.05); // menos que un trozo (0.1s): no descarta nada
    expect(buffer.bufferedDurationS).toBeCloseTo(0.2);

    buffer.advance(0.1); // consume el primer trozo entero
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
  });

  it("advance() mas alla de lo disponible deja el buffer vacio (underrun)", () => {
    const buffer = new FrameBuffer({ targetS: 0.1, minS: 0.05, maxS: 0.7 });
    buffer.push(makeFrame());
    buffer.advance(10);
    expect(buffer.bufferedDurationS).toBe(0);
    expect(buffer.isUnderrun).toBe(true);
  });

  it("no reproduce nada hasta hacer pre-roll: por debajo del objetivo, advance() es un no-op", () => {
    // Sin pre-roll el buffer arranca con el primer trozo que llega y vive
    // permanentemente al borde del underrun: no tiene reserva que gastar.
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    for (let i = 0; i < 4; i++) {
      buffer.push(makeFrame({ sequenceNumber: i })); // 0,4s < 0,5s
    }
    expect(buffer.isPreRolled).toBe(false);

    buffer.advance(1); // de sobra para drenarlo entero si se reprodujese

    expect(buffer.bufferedDurationS).toBeCloseTo(0.4);
    expect(buffer.isUnderrun).toBe(false);
  });

  it("empieza a reproducir en cuanto el buffer alcanza el objetivo", () => {
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    for (let i = 0; i < 5; i++) {
      buffer.push(makeFrame({ sequenceNumber: i })); // 0,5s = objetivo
    }
    expect(buffer.isPreRolled).toBe(true);

    buffer.advance(0.1);

    expect(buffer.bufferedDurationS).toBeCloseTo(0.4);
  });

  it("tras vaciarse hay que volver a alcanzar el objetivo antes de reanudar", () => {
    const buffer = new FrameBuffer({ targetS: 0.2, minS: 0.1, maxS: 0.7 });
    buffer.push(makeFrame({ sequenceNumber: 0 }));
    buffer.push(makeFrame({ sequenceNumber: 1 })); // 0,2s = objetivo
    expect(buffer.isPreRolled).toBe(true);

    buffer.advance(1); // lo vacía
    expect(buffer.isUnderrun).toBe(true);
    expect(buffer.isPreRolled).toBe(false);

    buffer.push(makeFrame({ sequenceNumber: 2 })); // 0,1s: aún por debajo
    expect(buffer.isPreRolled).toBe(false);
    buffer.advance(1);
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1); // no se consumió nada

    buffer.push(makeFrame({ sequenceNumber: 3 })); // 0,2s: objetivo de nuevo
    expect(buffer.isPreRolled).toBe(true);
    buffer.advance(0.1);
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
  });

  it("clear() vuelve a exigir pre-roll", () => {
    const buffer = new FrameBuffer({ targetS: 0.2, minS: 0.1, maxS: 0.7 });
    buffer.push(makeFrame({ sequenceNumber: 0 }));
    buffer.push(makeFrame({ sequenceNumber: 1 }));
    expect(buffer.isPreRolled).toBe(true);

    buffer.clear();

    expect(buffer.isPreRolled).toBe(false);
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
    const buffer = new FrameBuffer({ targetS: 0.1, minS: 0.05, maxS: 0.7 });
    buffer.push(makeFrame({ sequenceNumber: 0 })); // 0.1s
    buffer.advance(5); // agota el buffer y, si acumulase deuda, dejaria ~4.9s pendientes
    expect(buffer.isUnderrun).toBe(true);

    buffer.push(makeFrame({ sequenceNumber: 1 })); // llega un frame nuevo tras el underrun
    expect(buffer.isUnderrun).toBe(false);
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
  });

  it("consumeNewSamples devuelve solo lo desalojado por el ultimo advance(), por derivacion y en orden", () => {
    // 2 muestras a 500Hz = 4ms por trozo; el objetivo se fija a dos trozos
    // para que el pre-roll no sea el objeto de este test.
    const buffer = new FrameBuffer({ targetS: 0.008, minS: 0.004, maxS: 0.02 });
    buffer.push(
      makeFrame({
        nChannels: 2,
        nSamplesPerChannel: 2,
        channelsV: new Float32Array([1, 2, 10, 20]), // canal 0: [1,2], canal 1: [10,20]
      })
    );
    buffer.push(
      makeFrame({
        sequenceNumber: 1,
        nChannels: 2,
        nSamplesPerChannel: 2,
        channelsV: new Float32Array([3, 4, 30, 40]),
      })
    );
    expect(buffer.isPreRolled).toBe(true);

    buffer.advance(0.008); // consume los dos trozos

    expect(Array.from(buffer.consumeNewSamples(0))).toEqual([1, 2, 3, 4]);
    expect(Array.from(buffer.consumeNewSamples(1))).toEqual([10, 20, 30, 40]);
  });

  it("consumeNewSamples queda vacio si el ultimo advance() no completo ningun trozo", () => {
    const buffer = new FrameBuffer({ targetS: 0.008, minS: 0.004, maxS: 0.02 });
    for (let i = 0; i < 3; i++) {
      buffer.push(
        makeFrame({
          sequenceNumber: i,
          nChannels: 2,
          nSamplesPerChannel: 2,
          channelsV: new Float32Array([1, 2, 10, 20]),
        })
      );
    }

    buffer.advance(0.004); // consume un trozo
    expect(buffer.consumeNewSamples(0).length).toBe(2);

    buffer.advance(0.001); // menos que un trozo: no completa ninguno
    expect(buffer.consumeNewSamples(0).length).toBe(0);
  });

  it("consumeNewSamples queda vacio mientras el buffer no ha hecho pre-roll", () => {
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    buffer.push(makeFrame({ nSamplesPerChannel: 2, channelsV: new Float32Array([1, 2, 10, 20]) }));

    buffer.advance(1);

    expect(buffer.consumeNewSamples(0).length).toBe(0);
  });

  it("clear() vacia el buffer", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    buffer.clear();
    expect(buffer.isUnderrun).toBe(true);
  });

  it("justConsumedHadGap es falso sin perdidas ni overrun", () => {
    const buffer = new FrameBuffer({ targetS: 0.1, minS: 0.05, maxS: 0.7 });
    buffer.push(makeFrame({ sequenceNumber: 0 }));
    buffer.advance(0.1);
    expect(buffer.justConsumedHadGap).toBe(false);
  });

  it("justConsumedHadGap es verdadero cuando el trozo desalojado venia marcado con gapBefore (perdida de red)", () => {
    const buffer = new FrameBuffer({ targetS: 0.1, minS: 0.05, maxS: 0.7 });
    buffer.push(makeFrame({ sequenceNumber: 5 }), { gapBefore: true });
    buffer.advance(0.1);
    expect(buffer.justConsumedHadGap).toBe(true);
  });

  it("el descarte por overrun marca el trozo superviviente con gapBefore, aunque llegase sin perdida de red", () => {
    // Spec §4: el overrun tambien es un hueco real -- el trozo que sobrevive
    // ya no es contiguo con lo ultimo dibujado, igual que si se hubiese
    // perdido en la red. Sin esto el renderer uniria ambos lados con una
    // linea recta que finge continuidad donde falta señal.
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    for (let i = 0; i < 8; i++) {
      buffer.push(makeFrame({ sequenceNumber: i })); // el 8º dispara el overrun
    }
    buffer.advance(0.5); // consume lo que sobrevivio al descarte

    expect(buffer.justConsumedHadGap).toBe(true);
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
