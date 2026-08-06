import { describe, expect, it } from "vitest";
import { SweepBuffer } from "../render/sweep-buffer";
import { computeLayoutMetrics } from "../render/layout-engine";
import { PX_PER_MM } from "../render/grid-layer";
import { snap } from "./snap";

const SAMPLE_RATE_HZ = 500;
const CAPACITY = 1000;

const METRICS = computeLayoutMetrics({
  availableWidthPx: 10 * 25 * PX_PER_MM,
  availableHeightPx: 600,
  rowCount: 6,
  columnCount: 1,
  gain: 10,
  paperSpeedMmS: 25,
});

/** Una linea plana con una R de `peakMv` en la muestra `peakAt`. */
function sweepWithPeak(peakAt: number, peakMv: number): SweepBuffer {
  const sweep = new SweepBuffer(CAPACITY);
  const samples = new Float32Array(CAPACITY);
  samples[peakAt] = peakMv / 1000;
  sweep.push(samples);
  return sweep;
}

function ctxFor(sweep: SweepBuffer) {
  return {
    sweep,
    sampleRateHz: SAMPLE_RATE_HZ,
    metrics: METRICS,
    view: { startRingPos: 0, visibleSamples: CAPACITY },
    capacity: CAPACITY,
  };
}

describe("modo señal", () => {
  it("el voltaje sale del trazo, no de donde esta el puntero", () => {
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 500, rawVoltageV: -0.9 / 1000 }, "signal", ctxFor(sweep));

    expect(r.ringPos).toBe(500);
    expect(r.voltageV * 1000).toBeCloseTo(1.2, 6);
    expect(r.snapped).toBe(true);
  });
});

describe("modo rejilla", () => {
  it("la marca cae en un multiplo exacto de milimetro", () => {
    // A 500Hz y 25mm/s, un milimetro son 20 muestras.
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 507, rawVoltageV: 0 }, "grid", ctxFor(sweep));
    expect(r.ringPos).toBe(500);
  });

  it("redondea hacia arriba cuando toca", () => {
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 513, rawVoltageV: 0 }, "grid", ctxFor(sweep));
    expect(r.ringPos).toBe(520);
  });

  it("el voltaje tambien cae en la rejilla", () => {
    // Con ganancia 10mm/mV, un milimetro son 0,1mV.
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 500, rawVoltageV: 0.83 / 1000 }, "grid", ctxFor(sweep));
    expect(r.voltageV * 1000).toBeCloseTo(0.8, 6);
  });
});

describe("modo pico R", () => {
  it("engancha en la R cuando el cursor cae cerca", () => {
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 530, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(500);
    expect(r.snapped).toBe(true);
  });

  it("engancha en una R negativa: manda el valor absoluto", () => {
    // En aVR la deflexion principal es negativa y sigue siendo la R del latido.
    const sweep = sweepWithPeak(500, -1.4);
    const r = snap({ rawRingPos: 520, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(500);
    expect(r.snapped).toBe(true);
  });

  it("NO engancha si nada supera el umbral: cae al modo señal y lo declara", () => {
    const sweep = sweepWithPeak(500, 0.1);
    const r = snap({ rawRingPos: 520, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(520);
    expect(r.snapped).toBe(false);
  });

  it("NO engancha si la R esta fuera de la ventana de busqueda", () => {
    // 150ms a 500Hz son 75 muestras: la R en 500 queda fuera desde la 600.
    const sweep = sweepWithPeak(500, 1.2);
    const r = snap({ rawRingPos: 600, rawVoltageV: 0 }, "rpeak", ctxFor(sweep));

    expect(r.ringPos).toBe(600);
    expect(r.snapped).toBe(false);
  });
});
