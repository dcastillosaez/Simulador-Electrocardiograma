import { describe, expect, it } from "vitest";
import { applyAperture } from "./ValveAnimator";
import {
  VALVE_LEAFLET_NAMES,
  type MorphableLike,
  type ValveNodes,
} from "./heart-valves";

function nodes(): ValveNodes {
  return Object.fromEntries(
    VALVE_LEAFLET_NAMES.map((name): [string, MorphableLike] => [
      name,
      { name, children: [], scale: { x: 1, y: 1, z: 1 }, morphTargetInfluences: [0] },
    ])
  ) as ValveNodes;
}

const influence = (target: ValveNodes, name: string) =>
  (target as Record<string, MorphableLike>)[name].morphTargetInfluences?.[0];

describe("applyAperture", () => {
  it("abre las auriculoventriculares y cierra las sigmoideas en diástole", () => {
    const target = nodes();

    applyAperture(target, { atrioventricular: 1, semilunar: 0 });

    expect(influence(target, "MitralAnterior")).toBe(1);
    expect(influence(target, "TricuspidSeptal")).toBe(1);
    expect(influence(target, "AorticLeft")).toBe(0);
    expect(influence(target, "PulmonaryRight")).toBe(0);
  });

  it("las cambia de papel en sístole", () => {
    const target = nodes();

    applyAperture(target, { atrioventricular: 0, semilunar: 1 });

    expect(influence(target, "MitralPosterior")).toBe(0);
    expect(influence(target, "AorticAnterior")).toBe(1);
  });

  it("mueve juntas las valvas de una misma válvula", () => {
    const target = nodes();

    applyAperture(target, { atrioventricular: 0.42, semilunar: 0 });

    expect(influence(target, "TricuspidAnterior")).toBe(0.42);
    expect(influence(target, "TricuspidPosterior")).toBe(0.42);
    expect(influence(target, "TricuspidSeptal")).toBe(0.42);
  });

  it("escribe desde la apertura y no acumula", () => {
    // La pose de la fuente —la válvula cerrada— es siempre el cero. Acumular
    // dejaría la válvula cada vez más entreabierta a lo largo de una guardia.
    const target = nodes();

    applyAperture(target, { atrioventricular: 1, semilunar: 1 });
    applyAperture(target, { atrioventricular: 0, semilunar: 0 });

    expect(influence(target, "MitralAnterior")).toBe(0);
    expect(influence(target, "AorticLeft")).toBe(0);
  });

  it("acota el peso", () => {
    // Fuera de [0, 1] la GPU extrapola el desplazamiento y la valva atraviesa
    // la pared del ventrículo.
    const target = nodes();

    applyAperture(target, { atrioventricular: 1.4, semilunar: -0.3 });

    expect(influence(target, "MitralAnterior")).toBe(1);
    expect(influence(target, "AorticLeft")).toBe(0);
  });
});
