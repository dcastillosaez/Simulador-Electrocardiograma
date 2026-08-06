import { describe, expect, it } from "vitest";
import { composeSnapshotLines } from "./useSweepRenderer";
import { createSession, apply } from "../../measure/session";
import type { MeasurePoint } from "../../measure/tools";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

function point(sampleIndex: number, mv: number): MeasurePoint {
  return {
    ringPos: sampleIndex,
    sampleIndex,
    timestampS: sampleIndex / 500,
    voltageV: mv / 1000,
    lead: "II",
  };
}

describe("composeSnapshotLines", () => {
  it("sin medida no estampa nada", () => {
    expect(composeSnapshotLines(null)).toEqual([]);
  });

  it("estampa la lectura del calibrador", () => {
    // Un PNG con dos marcas y ningun numero obliga a volver a medir sobre la
    // imagen, que es justo lo que se acaba de hacer.
    let s = createSession("caliper");
    s = apply(s, { type: "place", point: point(1000, 0) }, CTX);
    s = apply(s, { type: "place", point: point(1082, 1.21) }, CTX);

    expect(composeSnapshotLines(s)).toEqual([
      "Δt 164 ms",
      "ΔV +1.21 mV",
      "366 lpm",
    ]);
  });

  it("estampa la lectura de la regla", () => {
    const s = apply(createSession("ruler"), { type: "place", point: point(1157, 0.84) }, CTX);
    expect(composeSnapshotLines(s)).toEqual(["II", "2.314 s", "+0.84 mV"]);
  });
});
