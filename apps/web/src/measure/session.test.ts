import { describe, expect, it } from "vitest";
import { apply, createSession, isColdChange } from "./session";
import type { MeasurePoint } from "./tools";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

function point(sampleIndex: number, mv = 0): MeasurePoint {
  return {
    ringPos: sampleIndex % 1000,
    sampleIndex,
    timestampS: sampleIndex / 500,
    voltageV: mv / 1000,
    lead: "II",
  };
}

describe("sesion de medicion", () => {
  it("arranca sin marcas ni resultado, con el snap por defecto de la herramienta", () => {
    const s = createSession("caliper");
    expect(s.markers).toEqual([]);
    expect(s.result).toBeNull();
    expect(s.snapMode).toBe("signal");
  });

  it("la herramienta RR arranca con snap a pico R", () => {
    expect(createSession("rr").snapMode).toBe("rpeak");
  });

  it("hover no toca marcas ni resultado", () => {
    // Es la propiedad que mantiene a React fuera del camino del puntero.
    const s = apply(createSession("caliper"), { type: "hover", point: point(10) }, CTX);
    expect(s.hover).not.toBeNull();
    expect(s.markers).toEqual([]);
    expect(s.result).toBeNull();
  });

  it("hover NO es un cambio frio", () => {
    const antes = createSession("caliper");
    const despues = apply(antes, { type: "hover", point: point(10) }, CTX);
    expect(isColdChange(antes, despues)).toBe(false);
  });

  it("la regla produce resultado con una sola marca", () => {
    const s = apply(createSession("ruler"), { type: "place", point: point(1157, 0.84) }, CTX);

    expect(s.markers).toHaveLength(1);
    expect(s.result).toEqual({
      kind: "cursor",
      lead: "II",
      timestampS: 1157 / 500,
      voltageV: 0.84 / 1000,
    });
  });

  it("el calibrador no produce resultado hasta la segunda marca", () => {
    let s = apply(createSession("caliper"), { type: "place", point: point(1000) }, CTX);
    expect(s.result).toBeNull();

    s = apply(s, { type: "place", point: point(1082, 1.21) }, CTX);
    expect(s.result?.kind).toBe("caliper");
    if (s.result?.kind !== "caliper") throw new Error("resultado inesperado");
    expect(s.result.readout.deltaMs).toBeCloseTo(164, 9);
  });

  it("una tercera marca empieza una medida nueva", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    s = apply(s, { type: "place", point: point(2000) }, CTX);

    expect(s.markers).toHaveLength(1);
    expect(s.markers[0].sampleIndex).toBe(2000);
    expect(s.result).toBeNull();
  });

  it("anchor es siempre la ultima marca puesta", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    expect(s.anchor?.sampleIndex).toBe(1000);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    expect(s.anchor?.sampleIndex).toBe(1082);
  });

  it("arrastrar una marca recalcula el resultado", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    s = apply(s, { type: "dragMarker", index: 1, point: point(1430) }, CTX);

    if (s.result?.kind !== "caliper") throw new Error("resultado inesperado");
    expect(s.result.readout.deltaMs).toBeCloseTo(860, 9);
  });

  it("clear vacia marcas, ancla y resultado pero conserva herramienta y snap", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "setSnap", snapMode: "grid" }, CTX);
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "clear" }, CTX);

    expect(s.markers).toEqual([]);
    expect(s.anchor).toBeNull();
    expect(s.result).toBeNull();
    expect(s.tool).toBe("caliper");
    expect(s.snapMode).toBe("grid");
  });

  it("cambiar de herramienta descarta las marcas de la anterior", () => {
    // Dos marcas de calibrador no significan lo mismo bajo la regla: heredarlas
    // dejaria en pantalla un resultado que ya nadie sabe de que herramienta es.
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "setTool", tool: "ruler" }, CTX);

    expect(s.tool).toBe("ruler");
    expect(s.markers).toEqual([]);
    expect(s.snapMode).toBe("signal");
  });

  it("cambiar el snap NO mueve las marcas ya puestas", () => {
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000) }, CTX);
    s = apply(s, { type: "place", point: point(1082) }, CTX);
    const antes = s.result;
    s = apply(s, { type: "setSnap", snapMode: "grid" }, CTX);

    expect(s.result).toEqual(antes);
  });

  it("colocar SI es un cambio frio", () => {
    const antes = createSession("ruler");
    const despues = apply(antes, { type: "place", point: point(10) }, CTX);
    expect(isColdChange(antes, despues)).toBe(true);
  });
});
