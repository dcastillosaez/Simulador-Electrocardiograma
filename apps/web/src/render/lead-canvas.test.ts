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

  it("borra desde donde empieza a dibujar, con un hueco extra por delante del cursor nuevo", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.clearRect).toHaveBeenCalled();
    const [x, y, width, height] = (ctx.clearRect as any).mock.calls[0];
    // Arranca en el cursor ANTERIOR al push (0, sweep vacío), no en el
    // nuevo: si arrancara en el cursor nuevo, el tramo recién dibujado
    // (0..50 muestras) se quedaría sin limpiar.
    expect(x).toBeCloseTo(0);
    expect(y).toBe(0);
    expect(width).toBeCloseTo(50 * PX_PER_SAMPLE + ERASE_BAND_PX);
    expect(height).toBe(HEIGHT_PX);
  });

  it("el borrado de cada tick cubre por completo lo que ese mismo tick dibuja encima", () => {
    // Es la propiedad que motiva el arreglo: con la banda fija anterior
    // (8px) un trozo real de 100ms (50 muestras, ~9,45px) dejaba sin
    // limpiar la cola de cada tick, y el trazo de la vuelta anterior se
    // veía mezclado con el nuevo.
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));
    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);
    (ctx.moveTo as any).mockClear();
    (ctx.lineTo as any).mockClear();
    (ctx.clearRect as any).mockClear();

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    // Solo los `lineTo` son territorio nuevo de este tick (las 50 muestras
    // recién empujadas). El `moveTo` inicial de enlace reutiliza el último
    // punto del tick ANTERIOR (índice 49) -- ya limpiado por el borrado de
    // aquel tick, no por el de este, así que queda fuera de esta comprobación
    // a propósito.
    const drawnXs = xsOf(ctx.lineTo);
    const clearedRanges = (ctx.clearRect as any).mock.calls.map(
      ([x, , width]: number[]) => [x, x + width]
    );
    for (const drawnX of drawnXs) {
      expect(
        clearedRanges.some(
          ([lo, hi]: number[]) => drawnX >= lo - 1e-6 && drawnX <= hi + 1e-6
        )
      ).toBe(true);
    }
  });

  it("nunca borra el canvas entero: el trazo de la vuelta anterior persiste", () => {
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    for (const call of (ctx.clearRect as any).mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(50 * PX_PER_SAMPLE + ERASE_BAND_PX);
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
    // Deja el cursor a 5 muestras del final del anillo (95/100) con un
    // primer push, y en el segundo empuja 4 muestras mas: la banda de ese
    // tick (4 muestras + ERASE_BAND_PX) no cabe entera y se parte entre la
    // cola y la cabeza, como en un monitor real.
    const ctx = makeCtx();
    const sampleRateHz = 100;
    const pxPerSample = (PX_PER_MM * OPTIONS.paperSpeedMmS) / sampleRateHz;
    const capacity = 100;
    const sweepWidthPx = capacity * pxPerSample;
    const sweep = new SweepBuffer(capacity);

    drawSweepSegment(ctx, sweep, new Float32Array(95), sampleRateHz, OPTIONS, HEIGHT_PX);
    (ctx.clearRect as any).mockClear();

    drawSweepSegment(ctx, sweep, new Float32Array(4), sampleRateHz, OPTIONS, HEIGHT_PX);

    expect(sweep.writeCursor).toBe(99);
    const calls = (ctx.clearRect as any).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toBeCloseTo(95 * pxPerSample);
    expect(calls[1][0]).toBe(0);
    const clearedWidth = calls.reduce((sum: number, call: number[]) => sum + call[2], 0);
    expect(clearedWidth).toBeCloseTo(4 * pxPerSample + ERASE_BAND_PX);
    for (const call of calls) {
      expect(call[0] + call[2]).toBeLessThanOrEqual(sweepWidthPx + 1e-9);
    }
  });

  it("con hadGap=true no enlaza con el tick anterior: levanta el lapiz en vez de interpolar el hueco", () => {
    // Spec §4: un hueco (perdida de frame en red o descarte por overrun)
    // nunca se interpola. Antes de este fix drawSweepSegment siempre unia el
    // trazo nuevo con el ultimo punto dibujado, sin importar si entre medias
    // faltaba señal real.
    const ctx = makeCtx();
    const sweep = new SweepBuffer(sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ));
    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);
    (ctx.moveTo as any).mockClear();
    (ctx.lineTo as any).mockClear();

    drawSweepSegment(ctx, sweep, new Float32Array(50), SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX, true);

    // Sin el enlace de union (indice 49 del tick anterior), el unico moveTo
    // es el de la primera muestra nueva (indice 50) y las 49 restantes son
    // lineTo -- un lapiz levantado, no una linea recta sobre el hueco.
    expect((ctx.moveTo as any).mock.calls.length).toBe(1);
    expect((ctx.moveTo as any).mock.calls[0][0]).toBeCloseTo(50 * PX_PER_SAMPLE);
    expect((ctx.lineTo as any).mock.calls.length).toBe(49);
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
