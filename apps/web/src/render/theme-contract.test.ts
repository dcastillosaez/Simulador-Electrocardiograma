import { describe, expect, it, vi } from "vitest";
import type { EcgTheme } from "@ui-system/themes/types";
import { drawGrid } from "./grid-layer";
import { drawSweepSegment } from "./lead-canvas";
import { computeLayoutMetrics } from "./layout-engine";
import { SweepBuffer, sweepCapacitySamples } from "./sweep-buffer";

/** Metricas con el ancho que hace que un milimetro mida PX_PER_MM, para poder
 * seguir razonando en la escala fisica de referencia. */
function metricsOf(heightPx: number, rows: number, gain: "auto" | number) {
  return computeLayoutMetrics({
    availableWidthPx: 10 * 25 * (96 / 25.4),
    availableHeightPx: heightPx,
    rowCount: rows,
    columnCount: 1,
    gain,
    paperSpeedMmS: 25,
  });
}


/** Colores que no aparecen en ningun tema real ni en ningun sitio del codigo.
 * Si el renderer asigna algo que no este aqui, es que lo lleva escrito a
 * mano. */
const SENTINEL: EcgTheme = {
  background: "#FF00FF",
  gridMinor: "#00FFFF",
  gridMajor: "#FFFF00",
  trace: "#FF7F00",
  calibration: "#7F00FF",
  cursor: "#00FF7F",
};

const SENTINEL_VALUES = new Set(Object.values(SENTINEL));

/** Contexto que registra cada asignacion de color. `strokeStyle` y `fillStyle`
 * son propiedades, no metodos, asi que hay que interceptarlas con setters: un
 * `vi.fn()` no las ve. */
function makeRecordingCtx() {
  const assigned: string[] = [];
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    font: "",
    set strokeStyle(value: string) {
      assigned.push(value);
    },
    get strokeStyle() {
      return "";
    },
    set fillStyle(value: string) {
      assigned.push(value);
    },
    get fillStyle() {
      return "";
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, assigned };
}

const METRICS = metricsOf(152, 1, 10);

describe("contrato de tema del renderer", () => {
  it("drawGrid no asigna ningun color que no venga del tema", () => {
    const { ctx, assigned } = makeRecordingCtx();

    drawGrid(ctx, 200, 152, METRICS, SENTINEL);

    expect(assigned.length).toBeGreaterThan(0);
    for (const color of assigned) {
      expect(SENTINEL_VALUES, `color no tematizado: ${color}`).toContain(color);
    }
  });

  it("drawSweepSegment no asigna ningun color que no venga del tema", () => {
    // Es el test que le faltaba a los presets de ruido: aquel bug paso porque
    // ningun test afirmaba nada sobre los valores, solo sobre el round-trip.
    const { ctx, assigned } = makeRecordingCtx();
    const sweep = new SweepBuffer(
      sweepCapacitySamples(200, METRICS.pixelsPerSecond, 500)
    );

    drawSweepSegment(
      ctx,
      sweep,
      new Float32Array([0, 0.001, -0.0005]),
      500,
      { metrics: METRICS, theme: SENTINEL },
      152
    );

    expect(assigned.length).toBeGreaterThan(0);
    for (const color of assigned) {
      expect(SENTINEL_VALUES, `color no tematizado: ${color}`).toContain(color);
    }
  });
});
