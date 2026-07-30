import { describe, expect, it, vi } from "vitest";
import { PX_PER_MM, computeGridLines, drawGrid, timeToPx, voltageToPx } from "./grid-layer";
import { computeLayoutMetrics } from "./layout-engine";
import { getTheme } from "@ui-system/themes/index";

const GAIN = 10;
const SPEED = 25;
// 152px de tira dan viewportScale = 3,8 px/mm, que es PX_PER_MM: es el caso de
// referencia con el que los tests de abajo pueden seguir hablando en mm.
const METRICS = computeLayoutMetrics(152, 1, GAIN, SPEED);
const THEME = getTheme("dark").ecg;

describe("timeToPx / voltageToPx", () => {
  it("a 25mm/s, 1mm equivale a 40ms (seccion 9 del spec)", () => {
    expect(timeToPx(0.04, METRICS)).toBeCloseTo(PX_PER_MM, 5);
  });

  it("voltageToPx convierte voltios a pixeles con la calibracion 10mm/mV", () => {
    // 1mV con ganancia 10mm/mV -> 10mm
    expect(voltageToPx(0.001, METRICS)).toBeCloseTo(10 * METRICS.viewportScalePxPerMm, 5);
  });

  it("voltageToPx escala con el viewport, no con la fisiologia", () => {
    const comprimida = computeLayoutMetrics(46, 1, GAIN, SPEED);
    expect(voltageToPx(0.001, comprimida)).toBeLessThan(voltageToPx(0.001, METRICS));
  });
});

describe("computeGridLines", () => {
  it("coloca una linea mayor cada 5 menores", () => {
    const widthPx = METRICS.viewportScalePxPerMm * 10;
    const lines = computeGridLines(widthPx, widthPx, METRICS);

    expect(lines.verticalMinor.length).toBeGreaterThan(lines.verticalMajor.length);
    expect(lines.verticalMajor[0]).toBeCloseTo(0);
    expect(lines.verticalMajor[1]).toBeCloseTo(5 * METRICS.viewportScalePxPerMm, 5);
  });

  it("el espaciado sigue al viewportScale: comprimir junta las lineas", () => {
    const comprimida = computeLayoutMetrics(46, 1, GAIN, SPEED);
    const anchas = computeGridLines(200, 200, METRICS);
    const juntas = computeGridLines(200, 200, comprimida);
    expect(juntas.verticalMinor.length).toBeGreaterThan(anchas.verticalMinor.length);
  });
});

describe("drawGrid", () => {
  it("dibuja tantos segmentos como lineas devuelve computeGridLines", () => {
    const widthPx = METRICS.viewportScalePxPerMm * 10;
    const heightPx = widthPx;
    const lines = computeGridLines(widthPx, heightPx, METRICS);
    const expectedSegments =
      lines.verticalMinor.length + lines.horizontalMinor.length +
      lines.verticalMajor.length + lines.horizontalMajor.length;

    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, widthPx, heightPx, METRICS, THEME);

    expect(ctx.moveTo).toHaveBeenCalledTimes(expectedSegments);
    expect(ctx.lineTo).toHaveBeenCalledTimes(expectedSegments);
  });

  it("pinta el fondo del tema en vez de dejarlo transparente", () => {
    // El canvas de rejilla es el que da color al area de ECG: si no pinta
    // fondo, el trazo queda sobre el color del contenedor y el tema de papel
    // se ve gris.
    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, 100, 50, METRICS, THEME);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
  });
});
