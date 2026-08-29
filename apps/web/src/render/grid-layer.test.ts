import { describe, expect, it, vi } from "vitest";
import { PX_PER_MM, computeGridLines, drawGrid, timeToPx, voltageToPx } from "./grid-layer";
import { computeLayoutMetrics } from "./layout-engine";
import { getTheme } from "@ui-system/themes/index";

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


const GAIN = 10;
// Alto de sobra: asi la escala la manda el ancho y un milimetro son
// exactamente PX_PER_MM pixeles, que es la referencia en la que estan escritas
// las cifras de este fichero.
const METRICS = metricsOf(152, 1, GAIN);
const THEME = getTheme("dark").ecg;

describe("timeToPx / voltageToPx", () => {
  it("a 25mm/s, 1mm equivale a 40ms (seccion 9 del spec)", () => {
    expect(timeToPx(0.04, METRICS)).toBeCloseTo(PX_PER_MM, 5);
  });

  it("voltageToPx convierte voltios a pixeles con la calibracion 10mm/mV", () => {
    // 1mV con ganancia 10mm/mV -> 10mm
    expect(voltageToPx(0.001, METRICS)).toBeCloseTo(10 * METRICS.viewportScalePxPerMm, 5);
  });

  it("1mV son 10mm de papel, encoja lo que encoja el papel", () => {
    // Al comprimir la ventana el milimetro mide menos pixeles y el trazo se
    // dibuja mas pequeno, pero encoge con su cuadricula: 1mV sigue midiendo
    // diez cuadros pequenos, que es lo que se cuenta al medir un voltaje.
    const comprimida = metricsOf(46, 1, GAIN);
    expect(comprimida.viewportScalePxPerMm).toBeLessThan(
      METRICS.viewportScalePxPerMm
    );
    expect(voltageToPx(0.001, comprimida)).toBeCloseTo(
      10 * comprimida.viewportScalePxPerMm,
      5
    );
  });

  it("voltageToPx escala con la ganancia", () => {
    const mediaGanancia = metricsOf(152, 1, GAIN / 2);
    expect(voltageToPx(0.001, mediaGanancia)).toBeCloseTo(
      voltageToPx(0.001, METRICS) / 2,
      5
    );
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

  it("al comprimir la ventana la cuadricula encoge entera, sin deformarse", () => {
    // La cuadricula representa milimetros de papel. Puede dibujarse mas
    // pequena —eso es encoger el papel— pero nunca estirarse en un eje y no en
    // el otro: en cuanto la celda deja de ser cuadrada, medir sobre ella pasa
    // a ser mentira.
    const comprimida = metricsOf(46, 1, "auto");
    const lines = computeGridLines(200, 200, comprimida);
    expect(lines.verticalMinor[1] - lines.verticalMinor[0]).toBeCloseTo(
      comprimida.viewportScalePxPerMm,
      5
    );
    expect(lines.verticalMinor[1] - lines.verticalMinor[0]).toBeCloseTo(
      lines.horizontalMinor[1] - lines.horizontalMinor[0],
      5
    );
  });

  it("la celda es cuadrada: el mismo espaciado en los dos ejes", () => {
    const lines = computeGridLines(200, 200, METRICS);
    expect(lines.verticalMinor[1]).toBeCloseTo(lines.horizontalMinor[1], 5);
  });

  it("cinco cuadros grandes cubren exactamente un segundo a 25mm/s", () => {
    // La comprobacion de cabecera: el clinico cuenta cuadros para medir el RR.
    const lines = computeGridLines(1000, 200, METRICS);
    const bigSquarePx = lines.verticalMajor[1] - lines.verticalMajor[0];
    expect(5 * bigSquarePx).toBeCloseTo(METRICS.pixelsPerSecond, 5);
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
