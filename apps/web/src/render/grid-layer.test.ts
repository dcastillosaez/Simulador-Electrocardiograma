import { describe, expect, it, vi } from "vitest";
import { PX_PER_MM, computeGridLines, drawGrid, timeToPx, voltageToPx } from "./grid-layer";

describe("timeToPx / voltageToPx", () => {
  it("a 25mm/s, 1mm equivale a 40ms (seccion 9 del spec)", () => {
    const pxPerMm = PX_PER_MM;
    const px40ms = timeToPx(0.04, 25);
    expect(px40ms).toBeCloseTo(pxPerMm, 5);
  });

  it("voltageToPx convierte voltios a mm con la calibracion 10mm/mV", () => {
    // 1 mV con ganancia 10mm/mV -> 10mm
    const px = voltageToPx(0.001, 10);
    expect(px).toBeCloseTo(10 * PX_PER_MM, 5);
  });
});

describe("computeGridLines", () => {
  it("coloca una linea mayor cada 5 menores", () => {
    const widthPx = PX_PER_MM * 10; // 10mm de ancho -> 11 lineas menores (0..10mm)
    const lines = computeGridLines(widthPx, widthPx);

    expect(lines.verticalMinor.length).toBeGreaterThan(lines.verticalMajor.length);
    // la primera linea mayor coincide con la primera menor (x=0)
    expect(lines.verticalMajor[0]).toBeCloseTo(0);
    // la segunda linea mayor esta 5mm mas alla
    expect(lines.verticalMajor[1]).toBeCloseTo(5 * PX_PER_MM, 5);
  });
});

describe("drawGrid", () => {
  it("dibuja tantos segmentos como lineas devuelve computeGridLines", () => {
    const widthPx = PX_PER_MM * 10;
    const heightPx = PX_PER_MM * 10;
    const lines = computeGridLines(widthPx, heightPx);
    const expectedSegments =
      lines.verticalMinor.length + lines.horizontalMinor.length +
      lines.verticalMajor.length + lines.horizontalMajor.length;

    const ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, widthPx, heightPx);

    expect(ctx.moveTo).toHaveBeenCalledTimes(expectedSegments);
    expect(ctx.lineTo).toHaveBeenCalledTimes(expectedSegments);
  });
});
