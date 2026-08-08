import { describe, expect, it, vi } from "vitest";
import { getTheme } from "@ui-system/themes/index";
import { computeLayoutMetrics } from "./layout-engine";
import { PX_PER_MM } from "./grid-layer";
import {
  drawOverlay,
  magnifierCenterPx,
  MAGNIFIER_HEIGHT_PX,
  MAGNIFIER_WIDTH_PX,
} from "./overlay-layer";
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
    rect: vi.fn(),
    clip: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;
}

/** Como `makeCtx`, pero conservando el ORDEN de los trazos: para saber cuál de
 * las polilíneas es la señal hay que ver qué `lineTo` van seguidos. */
function makeTracingCtx() {
  const ops: Array<[string, number, number]> = [];
  const record = (name: string) =>
    vi.fn((x: number, y: number) => {
      ops.push([name, x, y]);
    });
  const ctx = {
    ...(makeCtx() as unknown as Record<string, unknown>),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    beginPath: vi.fn(() => {
      ops.push(["beginPath", 0, 0]);
    }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

/** El trazo de la señal: la tirada más larga de `lineTo` consecutivos. La
 * rejilla son segmentos sueltos y el cursor son dos; la señal, decenas. */
function longestPolyline(ops: Array<[string, number, number]>): Array<[number, number]> {
  let best: Array<[number, number]> = [];
  let current: Array<[number, number]> = [];
  for (const [name, x, y] of ops) {
    if (name === "lineTo") {
      current.push([x, y]);
      if (current.length > best.length) best = current;
    } else {
      current = [];
    }
  }
  return best;
}

/** Esquina de la lupa, deducida del anclaje de su rótulo de aumento. */
function magnifierCorner(ctx: CanvasRenderingContext2D): { left: number; top: number } {
  const label = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.find(
    (c) => c[0] === "×4"
  )!;
  return { left: label[1] - 4, top: label[2] - 4 };
}

/** Todas las coordenadas por las que ha pasado el lápiz. */
function penCoords(ctx: CanvasRenderingContext2D): Array<[number, number]> {
  const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls;
  return [...calls(ctx.moveTo), ...calls(ctx.lineTo)] as Array<[number, number]>;
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

function makeSweeps(peakV = 0.0012) {
  const sweep = new SweepBuffer(CAPACITY);
  const samples = new Float32Array(CAPACITY);
  samples[500] = peakV;
  sweep.push(samples);
  return new Map<LeadName, SweepBuffer>([["II", sweep]]);
}

function frameWith(session: ReturnType<typeof createSession>, peakV?: number) {
  return {
    session,
    layout: LAYOUT,
    view: { startRingPos: 0, visibleSamples: CAPACITY },
    sampleRateHz: SAMPLE_RATE_HZ,
    capacity: CAPACITY,
    writtenCount: CAPACITY,
    sweeps: makeSweeps(peakV),
    theme: getTheme("dark").ecg,
    magnifier: false,
  };
}

/** Voltaje cuyo trazo ocupa `zoomPx` píxeles dentro de la lupa. */
function voltsForZoomPx(zoomPx: number): number {
  return zoomPx / 4 / METRICS.pixelsPerMillivolt / 1000;
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

describe("encuadre de la lupa", () => {
  it("centra la ventana en la señal cuando cabe", () => {
    expect(magnifierCenterPx(-20, 40, 0, 200)).toBe(10);
  });

  it("manda el cursor cuando la señal no cabe", () => {
    // Preferir el punto medido a la onda entera no es una rendicion: es lo que
    // garantiza que se ve lo que se va a registrar al hacer clic.
    expect(magnifierCenterPx(-200, 200, 150, 200)).toBe(150);
  });

  it("deja aire entre la señal y el canto del recuadro", () => {
    // Un pico que cabe justo pegado al borde se lee como un pico cortado, que
    // es exactamente lo que hay que evitar.
    expect(magnifierCenterPx(0, 190, 190, 200)).toBe(190);
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

  it("dibuja el trazo con coordenadas finitas sea cual sea el ancho de tira", () => {
    // Las muestras que caben en la lupa dependen del ancho. Si sale un numero
    // IMPAR, media ventana es fraccionaria; un indice de anillo fraccionario
    // hace que `Float32Array[173.5]` devuelva `undefined`, que se propaga como
    // NaN hasta `lineTo` y deja el canvas SIN PINTAR NADA: recuadro negro con
    // su rotulo y ni un trazo dentro.
    //
    // Se recorren varios anchos a proposito: el defecto no es de un ancho
    // concreto, es de la paridad, y con un solo caso se cuela.
    for (const availableWidthPx of [648, 944.88, 1285, 1600]) {
      const metrics = computeLayoutMetrics({
        availableWidthPx,
        availableHeightPx: 600,
        rowCount: 6,
        columnCount: 1,
        gain: 5,
        paperSpeedMmS: 25,
      });
      const ctx = makeCtx();
      drawOverlay(ctx, {
        ...frameWith({ ...createSession("caliper"), hover: point(500) }),
        layout: { leadColumns: [["I", "II", "III", "aVR", "aVL", "aVF"]], metrics },
        magnifier: true,
      });

      const ys = penCoords(ctx).map(([, y]) => y);
      expect(ys.length, `ancho ${availableWidthPx}`).toBeGreaterThan(0);
      expect(
        ys.every((y) => Number.isFinite(y)),
        `ancho ${availableWidthPx}: hay coordenadas no finitas`
      ).toBe(true);
    }
  });

  it("recorta su contenido al recuadro", () => {
    // A ganancia 5mm/mV, una R de 1,2mV amplificada x4 se sale del alto de la
    // lupa. Sin recorte, el trazo se pintaria por encima del ECG de al lado.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: true });

    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("la rejilla tiene lineas en los dos ejes", () => {
    // Solo con verticales se puede contar tiempo pero no amplitud, y la lupa
    // esta justamente para mirar ondas pequeñas.
    //
    // Se busca el tramo COMPLETO de lado a lado del recuadro: una linea base
    // plana tambien produce puntos consecutivos a la misma altura, asi que
    // comparar solo "misma y" daria por buena una rejilla sin horizontales.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: true });

    const moves = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls;
    const lines = (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls;
    const horizontalCompleta = moves.some(([mx, my]) =>
      lines.some(([lx, ly]) => ly === my && Math.abs(lx - mx) === MAGNIFIER_WIDTH_PX)
    );
    expect(horizontalCompleta).toBe(true);
  });

  it("encuadra la onda entera cuando cabe en el recuadro", () => {
    // El encuadre estaba clavado en el 0 mV: a x4, una R normal se salia por
    // arriba y el recuadro ensenaba el tramo plano de al lado. Ahora la ventana
    // se desplaza —la escala no cambia— para que la onda quepa.
    const peakZoomPx = MAGNIFIER_HEIGHT_PX / 2;
    const peakV = voltsForZoomPx(peakZoomPx);
    const { ctx, ops } = makeTracingCtx();
    const hover = { ...point(500), voltageV: peakV };
    drawOverlay(ctx, { ...frameWith({ ...createSession("caliper"), hover }, peakV), magnifier: true });

    const { top } = magnifierCorner(ctx);
    const trazo = longestPolyline(ops);
    expect(trazo.length).toBeGreaterThan(10);
    const fuera = trazo.filter(([, y]) => y < top || y > top + MAGNIFIER_HEIGHT_PX);
    expect(fuera, "hay tramo de señal fuera del recuadro").toHaveLength(0);
  });

  it("con una onda mas alta que el recuadro deja el punto medido en el centro", () => {
    // Cuando ni desplazando cabe entera, lo que no puede faltar es el punto que
    // se esta midiendo: es el que va a quedar registrado al hacer clic.
    const peakV = voltsForZoomPx(MAGNIFIER_HEIGHT_PX * 1.5);
    const { ctx, ops } = makeTracingCtx();
    const hover = { ...point(500), voltageV: peakV };
    drawOverlay(ctx, { ...frameWith({ ...createSession("caliper"), hover }, peakV), magnifier: true });

    const { left, top } = magnifierCorner(ctx);
    const centerX = left + MAGNIFIER_WIDTH_PX / 2;
    const trazo = longestPolyline(ops);
    const enElCursor = trazo.reduce((best, p) =>
      Math.abs(p[0] - centerX) < Math.abs(best[0] - centerX) ? p : best
    );
    // Con holgura de decimas: el anillo guarda en `Float32Array` y el voltaje
    // del cursor viene del punto, no de la muestra redondeada.
    expect(enElCursor[1]).toBeCloseTo(top + MAGNIFIER_HEIGHT_PX / 2, 3);
  });

  it("dibuja dentro el cursor con su lectura", () => {
    // Colocar una marca con precision exige ver a la vez el punto ampliado y el
    // numero que va a quedar registrado.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(157) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: true });

    const { left, top } = magnifierCorner(ctx);
    const dentro = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, x, y]) =>
        x > left && x <= left + MAGNIFIER_WIDTH_PX && y >= top && y < top + MAGNIFIER_HEIGHT_PX
    );
    const textos = dentro.map((c) => c[0]);
    expect(textos).toContain("0.314 s");
    expect(textos).toContain("+0.84 mV");
  });

  it("no tapa la lectura del cursor", () => {
    // El rotulo se dibuja a 8px del cursor y la lupa a 12px: si van al mismo
    // lado, la lupa se come el unico sitio donde se lee el voltaje.
    const ctx = makeCtx();
    const session = { ...createSession("caliper"), hover: point(500) };
    drawOverlay(ctx, { ...frameWith(session), magnifier: true });

    const textos = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    const rotuloCursor = textos.find((c) => c[0] === "II");
    const rotuloLupa = textos.find((c) => c[0] === "×4");
    expect(rotuloCursor, "falta la lectura del cursor").toBeDefined();
    expect(rotuloLupa).toBeDefined();

    // El rotulo del cursor va alineado a la derecha cuando la lupa esta a su
    // derecha, asi que crece hacia la IZQUIERDA desde su anclaje: comparar los
    // dos anclajes no dice nada. Lo que importa es que su anclaje quede fuera
    // del recuadro de la lupa.
    const lupaLeft = rotuloLupa![1] - 4;
    expect(rotuloCursor![1]).toBeLessThanOrEqual(lupaLeft);
  });
});
