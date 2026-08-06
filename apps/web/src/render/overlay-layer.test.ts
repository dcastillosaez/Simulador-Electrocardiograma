import { describe, expect, it, vi } from "vitest";
import { getTheme } from "@ui-system/themes/index";
import { computeLayoutMetrics } from "./layout-engine";
import { PX_PER_MM } from "./grid-layer";
import { drawOverlay } from "./overlay-layer";
import { createSession } from "../measure/session";
import type { MeasurePoint } from "../measure/tools";
import { SweepBuffer } from "./sweep-buffer";
import type { LeadName } from "./layout";

const CAPACITY = 1000;
const SAMPLE_RATE_HZ = 500;

function makeCtx() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;
}

const METRICS = computeLayoutMetrics({
  availableWidthPx: 10 * 25 * PX_PER_MM,
  availableHeightPx: 600,
  rowCount: 6,
  columnCount: 2,
  gain: 10,
  paperSpeedMmS: 25,
});

const LAYOUT = {
  leadColumns: [
    ["I", "II", "III", "aVR", "aVL", "aVF"],
    ["V1", "V2", "V3", "V4", "V5", "V6"],
  ],
  metrics: METRICS,
} as const;

function point(ringPos: number, lead = "II"): MeasurePoint {
  return {
    ringPos,
    sampleIndex: ringPos,
    timestampS: ringPos / SAMPLE_RATE_HZ,
    voltageV: 0.00084,
    lead: lead as MeasurePoint["lead"],
  };
}

function makeSweeps() {
  const sweep = new SweepBuffer(CAPACITY);
  const samples = new Float32Array(CAPACITY);
  samples[500] = 0.0012;
  sweep.push(samples);
  return new Map<LeadName, SweepBuffer>([["II", sweep]]);
}

function frameWith(session: ReturnType<typeof createSession>) {
  return {
    session,
    layout: LAYOUT,
    view: { startRingPos: 0, visibleSamples: CAPACITY },
    sampleRateHz: SAMPLE_RATE_HZ,
    capacity: CAPACITY,
    writtenCount: CAPACITY,
    sweeps: makeSweeps(),
    theme: getTheme("dark").ecg,
    magnifier: false,
  };
}

describe("drawOverlay", () => {
  it("limpia el canvas y no dibuja nada sin cursor ni marcas", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, frameWith(createSession("caliper")));

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("la linea de tiempo cruza TODAS las columnas", () => {
    // Es la razon de que el overlay sea uno solo y no doce: un cursor
    // sincronizado es una linea, no doce dibujos coordinados.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, frameWith(session));

    // Una vertical por columna, mas la horizontal de voltaje.
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("las dos columnas dibujan la linea al mismo desplazamiento dentro de su tira", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, frameWith(session));

    const xs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const enPrimera = xs.find((x) => x > 0 && x < METRICS.stripWidthPx)!;
    const enSegunda = xs.find((x) => x > METRICS.stripWidthPx)!;
    expect(enSegunda - enPrimera).toBeCloseTo(METRICS.stripWidthPx + 8, 6);
  });

  it("escribe la lectura del cursor con derivacion, tiempo y voltaje", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(157) };
    drawOverlay(ctx, frameWith(session));

    const textos = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(textos).toContain("II");
    expect(textos).toContain("0.314 s");
    expect(textos).toContain("+0.84 mV");
  });

  it("dibuja una marca por cada punto fijado", () => {
    const ctx = makeCtx();
    const session = {
      ...createSession("caliper"),
      markers: [point(200), point(400)],
    };
    drawOverlay(ctx, frameWith(session));

    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("no dibuja el cursor fuera de la region medible", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: null };
    drawOverlay(ctx, frameWith(session));

    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

describe("region medible", () => {
  it("atenua la parte del anillo que nunca se ha escrito", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, { ...frameWith(createSession("caliper")), writtenCount: 400 });

    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("con el anillo lleno no atenua nada", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, { ...frameWith(createSession("caliper")), writtenCount: CAPACITY });

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe("lupa", () => {
  it("apagada no dibuja nada extra", () => {
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: false });

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("encendida dibuja su marco y su rotulo de aumento", () => {
    // El rotulo no es decoracion: una lupa sin declarar su escala invita a
    // contar cuadros sobre una rejilla que no es la de la pantalla.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: true });

    expect(ctx.fillRect).toHaveBeenCalled();
    const textos = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(textos).toContain("×4");
  });

  it("sin cursor no hay lupa", () => {
    const ctx = makeCtx();
    drawOverlay(ctx, { ...frameWith(createSession("caliper")), magnifier: true });

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
