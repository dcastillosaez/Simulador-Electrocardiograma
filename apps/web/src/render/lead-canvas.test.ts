import { describe, expect, it, vi } from "vitest";
import { ERASE_BAND_PX, OverlayLayer, drawSweepSegment } from "./lead-canvas";
import { PX_PER_MM, voltageToPx } from "./grid-layer";
import { SweepBuffer, sweepCapacitySamples } from "./sweep-buffer";

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

const OPTIONS = { paperSpeedMmS: 25, gainMmPerMv: 10 };
const SAMPLE_RATE_HZ = 500;
const HEIGHT_PX = 100;
const PX_PER_SAMPLE = (PX_PER_MM * OPTIONS.paperSpeedMmS) / SAMPLE_RATE_HZ;

function xsOf(fn: unknown): number[] {
  return (fn as any).mock.calls.map((call: number[]) => call[0]);
}

describe("drawSweepSegment", () => {
  it("dibuja las muestras nuevas en la posicion de pixel que marca el cursor del anillo", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));
    const samples = new Float32Array([0, 0.001, -0.001]); // voltios

    drawSweepSegment(ctx, sweep, samples, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const baselineY = HEIGHT_PX / 2;
    const [x0, y0] = (ctx.moveTo as any).mock.calls[0];
    expect(x0).toBeCloseTo(0);
    expect(y0).toBeCloseTo(baselineY - voltageToPx(0, 10));

    const [x1, y1] = (ctx.lineTo as any).mock.calls[0];
    expect(x1).toBeCloseTo(PX_PER_SAMPLE);
    expect(y1).toBeCloseTo(baselineY - voltageToPx(0.001, 10));

    // El anillo queda con esas muestras escritas y el cursor avanzado.
    expect(sweep.writeCursor).toBe(3);
    expect(sweep.at(1)).toBeCloseTo(0.001);
  });

  it("el numero de lineTo es proporcional a las muestras NUEVAS, no a la capacidad del anillo", () => {
    // Esta es la propiedad de rendimiento que motiva todo el rediseño: antes
    // se redibujaba la ventana entera en cada tick.
    const ctx = makeCtx();
    const capacity = sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ); // 4233
    const sweep = new SweepBuffer(capacity);

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const drawn = (ctx.lineTo as any).mock.calls.length + (ctx.moveTo as any).mock.calls.length;
    expect(drawn).toBe(50);
    expect(drawn).toBeLessThan(capacity / 10);
  });

  it("enlaza el segmento de este tick con el del anterior, sin repintar lo ya dibujado", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));
    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);
    (ctx.moveTo as any).mockClear();
    (ctx.lineTo as any).mockClear();

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    // Un único moveTo: el de la muestra anterior (índice 49) desde la que se
    // continúa la línea. Las 50 muestras nuevas son lineTo.
    expect((ctx.moveTo as any).mock.calls.length).toBe(1);
    expect((ctx.lineTo as any).mock.calls.length).toBe(50);
    expect((ctx.moveTo as any).mock.calls[0][0]).toBeCloseTo(49 * PX_PER_SAMPLE);
    expect((ctx.lineTo as any).mock.calls[0][0]).toBeCloseTo(50 * PX_PER_SAMPLE);
  });

  it("borra una banda estrecha por delante del nuevo cursor de escritura", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.clearRect).toHaveBeenCalled();
    const [x, y, width, height] = (ctx.clearRect as any).mock.calls[0];
    expect(x).toBeCloseTo(sweep.writeCursor * PX_PER_SAMPLE);
    expect(y).toBe(0);
    expect(width).toBeCloseTo(ERASE_BAND_PX);
    expect(height).toBe(HEIGHT_PX);
  });

  it("nunca borra el canvas entero: el trazo de la vuelta anterior persiste", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    for (const call of (ctx.clearRect as any).mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(ERASE_BAND_PX);
    }
  });

  it("las coordenadas del trazo envuelven al llegar al borde derecho, no crecen sin limite", () => {
    // Capacidad pequeña a proposito para forzar el envolvimiento en pocas
    // muestras. A 10Hz cada muestra ocupa ~9,45px, asi que el anillo de 8
    // muestras mide ~75,6px de ancho.
    const ctx = makeCtx();
    const sampleRateHz = 10;
    const pxPerSample = (PX_PER_MM * OPTIONS.paperSpeedMmS) / sampleRateHz;
    const capacity = 8;
    const sweepWidthPx = capacity * pxPerSample;
    const sweep = new SweepBuffer(capacity);

    drawSweepSegment(ctx, sweep, new Float32Array(6), sampleRateHz, OPTIONS, HEIGHT_PX);
    (ctx.moveTo as any).mockClear();
    (ctx.lineTo as any).mockClear();
    (ctx.clearRect as any).mockClear();

    // 5 muestras mas: 6,7 al final del anillo y 8,9,10 ya envueltas a 0,1,2.
    drawSweepSegment(ctx, sweep, new Float32Array(5), sampleRateHz, OPTIONS, HEIGHT_PX);

    const drawnXs = [...xsOf(ctx.moveTo), ...xsOf(ctx.lineTo)];
    for (const x of drawnXs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(sweepWidthPx);
    }
    // Se ha vuelto al origen: hay puntos dibujados en la primera muestra del
    // anillo tras haber pasado por la ultima.
    expect(drawnXs.some((x) => x < pxPerSample / 2)).toBe(true);
    expect(Math.max(...drawnXs)).toBeGreaterThan(sweepWidthPx - 2 * pxPerSample);

    // Y el cursor tambien envolvio: 6 + 5 = 11, 11 % 8 = 3.
    expect(sweep.writeCursor).toBe(3);
    for (const call of (ctx.clearRect as any).mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(0);
      expect(call[0] + call[2]).toBeLessThanOrEqual(sweepWidthPx + 1e-9);
    }
  });

  it("no enlaza a traves del borde: al envolver empieza un trazo nuevo en x=0", () => {
    const ctx = makeCtx();
    const sampleRateHz = 10;
    const capacity = 8;
    const sweep = new SweepBuffer(capacity);
    drawSweepSegment(ctx, sweep, new Float32Array(6), sampleRateHz, OPTIONS, HEIGHT_PX);
    (ctx.moveTo as any).mockClear();
    (ctx.lineTo as any).mockClear();

    drawSweepSegment(ctx, sweep, new Float32Array(5), sampleRateHz, OPTIONS, HEIGHT_PX);

    // Dos moveTo: el enlace con la muestra anterior (indice 5) y el salto al
    // origen del anillo tras envolver. Sin este segundo moveTo se dibujaria
    // una linea atravesando todo el canvas de derecha a izquierda.
    const moveXs = xsOf(ctx.moveTo);
    expect(moveXs.length).toBe(2);
    expect(moveXs[1]).toBeCloseTo(0);
  });

  it("la banda de borrado envuelve al borde derecho en dos trozos", () => {
    // Cursor a 0,94px del final del anillo: la banda de 8px no cabe entera y
    // se parte entre la cola y la cabeza, como en un monitor real.
    const ctx = makeCtx();
    const sampleRateHz = 100;
    const pxPerSample = (PX_PER_MM * OPTIONS.paperSpeedMmS) / sampleRateHz;
    const capacity = 100;
    const sweepWidthPx = capacity * pxPerSample;
    const sweep = new SweepBuffer(capacity);

    drawSweepSegment(ctx, sweep, new Float32Array(99), sampleRateHz, OPTIONS, HEIGHT_PX);

    expect(sweep.writeCursor).toBe(99);
    const calls = (ctx.clearRect as any).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toBeCloseTo(99 * pxPerSample);
    expect(calls[1][0]).toBe(0);
    const clearedWidth = calls.reduce((sum: number, call: number[]) => sum + call[2], 0);
    expect(clearedWidth).toBeCloseTo(ERASE_BAND_PX);
    for (const call of calls) {
      expect(call[0] + call[2]).toBeLessThanOrEqual(sweepWidthPx + 1e-9);
    }
  });

  it("no dibuja nada con un array vacio de muestras nuevas", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(64);

    drawSweepSegment(ctx, sweep, new Float32Array([]), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(sweep.writeCursor).toBe(0);
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
