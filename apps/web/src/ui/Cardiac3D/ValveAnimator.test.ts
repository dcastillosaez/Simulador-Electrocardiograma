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
      {
        name,
        children: [],
        scale: { x: 1, y: 1, z: 1 },
        morphTargetInfluences: [0, 0],
      },
    ])
  ) as ValveNodes;
}

const influence = (target: ValveNodes, name: string) =>
  (target as Record<string, MorphableLike>)[name].morphTargetInfluences?.[0];

const bulge = (target: ValveNodes, name: string) =>
  (target as Record<string, MorphableLike>)[name].morphTargetInfluences?.[1];

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

  it("comba el recorrido por el medio y nada en los extremos", () => {
    // La GPU interpola en línea recta entre las dos poses, y la cuerda de un
    // arco de cien grados se mete un 38% por dentro: sin esto el velo se
    // acorta a media apertura y se ve encogerse en cada latido. La comba tiene
    // que valer cero justo donde las poses son exactas —cerrada y abierta— o
    // desplazaría también los extremos.
    const target = nodes();

    applyAperture(target, { atrioventricular: 0, semilunar: 1 });
    expect(bulge(target, "MitralAnterior")).toBe(0);
    expect(bulge(target, "AorticLeft")).toBe(0);

    applyAperture(target, { atrioventricular: 0.5, semilunar: 0.25 });
    expect(bulge(target, "MitralAnterior")).toBe(1);
    expect(bulge(target, "AorticLeft")).toBeCloseTo(0.75, 10);
  });

  it("no falla si el modelo trae una sola pose alternativa", () => {
    // Un `.glb` anterior a la comba sigue cargando: se anima con el recorrido
    // y sin corregir la cuerda, que es exactamente lo que hacía antes.
    const target = nodes();
    for (const name of VALVE_LEAFLET_NAMES) {
      (target as Record<string, MorphableLike>)[name].morphTargetInfluences = [0];
    }

    applyAperture(target, { atrioventricular: 0.5, semilunar: 0.5 });

    expect(influence(target, "MitralAnterior")).toBe(0.5);
    expect(bulge(target, "MitralAnterior")).toBeUndefined();
  });
});
