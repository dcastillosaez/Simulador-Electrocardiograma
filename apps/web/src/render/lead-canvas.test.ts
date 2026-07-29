import { describe, expect, it, vi } from "vitest";
import { OverlayLayer, drawLeadTrace } from "./lead-canvas";
import { timeToPx, voltageToPx } from "./grid-layer";

function makeCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
    canvas: { width: 800 },
  } as unknown as CanvasRenderingContext2D;
}

describe("drawLeadTrace", () => {
  it("mueve al primer punto y traza una linea al resto, con las coordenadas esperadas", () => {
    const ctx = makeCtx();
    const samples = new Float32Array([0, 0.001, -0.001]); // voltios
    const heightPx = 100;
    const options = { paperSpeedMmS: 25, gainMmPerMv: 10 };

    drawLeadTrace(ctx, samples, 500, options, heightPx);

    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);

    const baselineY = heightPx / 2;
    const [x0, y0] = (ctx.moveTo as any).mock.calls[0];
    expect(x0).toBeCloseTo(timeToPx(0, 25));
    expect(y0).toBeCloseTo(baselineY - voltageToPx(0, 10));

    const [x1, y1] = (ctx.lineTo as any).mock.calls[0];
    expect(x1).toBeCloseTo(timeToPx(1 / 500, 25));
    expect(y1).toBeCloseTo(baselineY - voltageToPx(0.001, 10));
  });

  it("no dibuja nada con un array vacio", () => {
    const ctx = makeCtx();
    drawLeadTrace(ctx, new Float32Array([]), 500, { paperSpeedMmS: 25, gainMmPerMv: 10 }, 100);
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });
});

describe("OverlayLayer", () => {
  it("draw() es inerte: no lanza y no dibuja nada (reservado para esta fase)", () => {
    const ctx = makeCtx();
    const overlay = new OverlayLayer();

    expect(() => overlay.draw(ctx, 800, 100)).not.toThrow();
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
