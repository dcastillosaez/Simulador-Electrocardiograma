import { describe, expect, it, vi } from "vitest";
import { computeLayoutMetrics } from "./layout-engine";
import { drawSweepSegment } from "./lead-canvas";
import { SweepBuffer } from "./sweep-buffer";
import { SweepRebuilder } from "./sweep-rebuilder";
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


const SAMPLE_RATE_HZ = 500;
const HEIGHT_PX = 152;
const METRICS = metricsOf(HEIGHT_PX, 1, 10);
const OPTIONS = { metrics: METRICS, theme: getTheme("dark").ecg };

function makeCtx() {
  return {
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
}

/** Conexiones dibujadas, como pares "x1->x2". Es la propiedad que de verdad
 * importa: dos secuencias de llamadas distintas que produzcan las mismas
 * uniones dan el mismo resultado visual. Un `moveTo` corta la cadena; un
 * `lineTo` une el punto anterior con el nuevo. */
function connections(ctx: CanvasRenderingContext2D): Set<string> {
  const calls: Array<{ kind: "move" | "line"; x: number }> = [];
  for (const [x] of (ctx.moveTo as any).mock.calls) calls.push({ kind: "move", x });
  // Reconstruir el orden real exige intercalar por orden de invocacion, que
  // vitest expone con `mock.invocationCallOrder`.
  const ordered: Array<{ kind: "move" | "line"; x: number }> = [];
  const moves = (ctx.moveTo as any).mock;
  const lines = (ctx.lineTo as any).mock;
  const events = [
    ...moves.calls.map((c: number[], i: number) => ({
      order: moves.invocationCallOrder[i],
      kind: "move" as const,
      x: c[0],
    })),
    ...lines.calls.map((c: number[], i: number) => ({
      order: lines.invocationCallOrder[i],
      kind: "line" as const,
      x: c[0],
    })),
  ].sort((a, b) => a.order - b.order);
  ordered.push(...events.map(({ kind, x }) => ({ kind, x })));
  void calls;

  const out = new Set<string>();
  let previous: number | null = null;
  for (const event of ordered) {
    if (event.kind === "line" && previous !== null) {
      out.add(`${previous.toFixed(4)}->${event.x.toFixed(4)}`);
    }
    previous = event.x;
  }
  return out;
}

describe("SweepRebuilder", () => {
  it("reproduce las mismas uniones que el dibujo incremental antes de envolver", () => {
    // Se compara sobre un anillo que aun no ha dado la vuelta: ahi no hay
    // ambiguedad entre lo mas viejo y lo mas nuevo, y la equivalencia debe ser
    // exacta. Ata las dos rutas de dibujo para siempre.
    const capacity = 600;
    const incremental = new SweepBuffer(capacity);
    const ctxIncremental = makeCtx();
    for (let tick = 0; tick < 4; tick++) {
      const samples = new Float32Array(50);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin((tick * 50 + i) / 10) * 0.001;
      }
      drawSweepSegment(
        ctxIncremental, incremental, samples, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX
      );
    }

    const rebuilt = new SweepBuffer(capacity);
    for (let tick = 0; tick < 4; tick++) {
      const samples = new Float32Array(50);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin((tick * 50 + i) / 10) * 0.001;
      }
      rebuilt.push(samples);
    }
    const ctxRebuilt = makeCtx();
    new SweepRebuilder().rebuild(ctxRebuilt, rebuilt, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(connections(ctxRebuilt)).toEqual(connections(ctxIncremental));
  });

  it("no une a traves de una discontinuidad: levanta el lapiz", () => {
    // Es la red que impide que un resize deshaga el arreglo I-3.
    const sweep = new SweepBuffer(600);
    sweep.push(new Float32Array(50));
    sweep.push(new Float32Array(50), { gapBefore: true });

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const pxPerSample = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
    const gapX = 50 * pxPerSample;
    // La union 49->50 no debe existir: ahi empieza el hueco.
    const forbidden = `${(49 * pxPerSample).toFixed(4)}->${gapX.toFixed(4)}`;
    expect(connections(ctx)).not.toContain(forbidden);
    // Y en esa x hay un moveTo, no un lineTo.
    expect((ctx.moveTo as any).mock.calls.map((c: number[]) => c[0])).toContainEqual(gapX);
  });

  it("no pinta la parte del anillo que nunca se ha escrito", () => {
    // Sin writtenCount, los ceros de relleno del Float32Array se dibujarian
    // como una linea plana en la mitad derecha de la tira.
    const sweep = new SweepBuffer(600);
    sweep.push(new Float32Array(50));

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const pxPerSample = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
    const drawnXs = [
      ...(ctx.moveTo as any).mock.calls.map((c: number[]) => c[0]),
      ...(ctx.lineTo as any).mock.calls.map((c: number[]) => c[0]),
    ];
    expect(Math.max(...drawnXs)).toBeLessThan(50 * pxPerSample);
  });

  it("un anillo vacio no dibuja nada, pero si limpia el canvas", () => {
    const sweep = new SweepBuffer(600);
    const ctx = makeCtx();

    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it("con el anillo lleno levanta el lapiz en la frontera del cursor", () => {
    // Cuando ha dado la vuelta, la posicion del cursor guarda lo MAS VIEJO y
    // la anterior lo MAS NUEVO: unirlas seria un salto de una pantalla entera
    // hacia atras en el tiempo.
    const capacity = 100;
    const sweep = new SweepBuffer(capacity);
    sweep.push(new Float32Array(150)); // da mas de una vuelta
    expect(sweep.writtenCount).toBe(capacity);
    expect(sweep.writeCursor).toBe(50);

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const pxPerSample = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
    expect((ctx.moveTo as any).mock.calls.map((c: number[]) => c[0])).toContainEqual(
      50 * pxPerSample
    );
  });

  it("usa el color de trazo del tema", () => {
    const sweep = new SweepBuffer(600);
    sweep.push(new Float32Array(50));
    const ctx = makeCtx();

    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.strokeStyle).toBe(OPTIONS.theme.trace);
  });
});
