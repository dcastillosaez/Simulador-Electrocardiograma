import { describe, expect, it } from "vitest";
import { computeLayoutMetrics } from "./layout-engine";
import { voltageToPx, PX_PER_MM } from "./grid-layer";
import {
  fullView,
  hitTest,
  pxPerSample,
  pxToRingPos,
  pxToVoltage,
  ringPosToPx,
} from "./measure-geometry";

const SAMPLE_RATE_HZ = 500;
const WIDTH = 10 * 25 * PX_PER_MM;

function metricsFor(columnCount: number, paperSpeedMmS = 25) {
  return computeLayoutMetrics({
    availableWidthPx: WIDTH,
    availableHeightPx: 600,
    rowCount: 6,
    columnCount,
    gain: 10,
    paperSpeedMmS,
  });
}

describe("conversiones de tiempo", () => {
  it("la posicion 0 del anillo cae en x = 0 con la vista completa", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    expect(ringPosToPx(0, fullView(5000), pps, 5000)).toBe(0);
  });

  it("pixel y muestra son inversos entre si", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    const view = fullView(5000);
    for (const ringPos of [0, 1, 137, 2500, 4999]) {
      const x = ringPosToPx(ringPos, view, pps, 5000);
      expect(pxToRingPos(x, view, pps, 5000)).toBe(ringPos);
    }
  });

  it("con una vista desplazada, el inicio de la ventana cae en x = 0", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    const view = { startRingPos: 1000, visibleSamples: 1250 };
    expect(ringPosToPx(1000, view, pps, 5000)).toBe(0);
    expect(pxToRingPos(0, view, pps, 5000)).toBe(1000);
  });

  it("una vista desplazada envuelve por el final del anillo", () => {
    const metrics = metricsFor(1);
    const pps = pxPerSample(metrics, SAMPLE_RATE_HZ);
    const view = { startRingPos: 4900, visibleSamples: 200 };
    expect(pxToRingPos(200 * pps, view, pps, 5000)).toBe(100);
  });
});

describe("conversiones de voltaje", () => {
  it("la linea media de la tira son cero milivoltios", () => {
    const metrics = metricsFor(1);
    expect(pxToVoltage(metrics.stripHeightPx / 2, metrics.stripHeightPx, metrics)).toBe(0);
  });

  it("es la inversa exacta de voltageToPx", () => {
    const metrics = metricsFor(1);
    const height = metrics.stripHeightPx;
    for (const mv of [-1.5, -0.2, 0, 0.84, 1.21]) {
      const volts = mv / 1000;
      const y = height / 2 - voltageToPx(volts, metrics);
      expect(pxToVoltage(y, height, metrics) * 1000).toBeCloseTo(mv, 9);
    }
  });

  it("arriba es positivo", () => {
    const metrics = metricsFor(1);
    expect(pxToVoltage(0, metrics.stripHeightPx, metrics)).toBeGreaterThan(0);
  });
});

describe("hitTest", () => {
  const leadColumns = [
    ["I", "II", "III"],
    ["aVR", "aVL", "aVF"],
  ] as const;

  it("localiza derivacion, columna y fila", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    const hit = hitTest(5, metrics.stripHeightPx + 4 + 3, layout);

    expect(hit).not.toBeNull();
    expect(hit!.lead).toBe("II");
    expect(hit!.column).toBe(0);
    expect(hit!.row).toBe(1);
    expect(hit!.xInStrip).toBeCloseTo(5);
    expect(hit!.yInStrip).toBeCloseTo(3);
  });

  it("la segunda columna empieza tras el hueco", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    const hit = hitTest(metrics.stripWidthPx + 8 + 2, 1, layout);

    expect(hit!.lead).toBe("aVR");
    expect(hit!.column).toBe(1);
    expect(hit!.xInStrip).toBeCloseTo(2);
  });

  it("devuelve null dentro del hueco entre columnas", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    expect(hitTest(metrics.stripWidthPx + 2, 1, layout)).toBeNull();
  });

  it("devuelve null dentro del hueco entre tiras", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    expect(hitTest(5, metrics.stripHeightPx + 1, layout)).toBeNull();
  });

  it("devuelve null fuera del area", () => {
    const metrics = metricsFor(2);
    const layout = { leadColumns, metrics };
    expect(hitTest(-1, 1, layout)).toBeNull();
    expect(hitTest(5, 100000, layout)).toBeNull();
  });
});
