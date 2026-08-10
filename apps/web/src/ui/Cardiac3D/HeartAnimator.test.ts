import { describe, expect, it } from "vitest";
import { applyExcursion } from "./HeartAnimator";
import { HEART_NODE_NAMES, type HeartNodes } from "./heart-nodes";

function nodes(): HeartNodes {
  const result = {} as HeartNodes;
  for (const name of HEART_NODE_NAMES) {
    result[name] = { name, children: [], scale: { x: 1, y: 1, z: 1 } };
  }
  return result;
}

describe("applyExcursion", () => {
  it("en reposo deja todo a escala unidad", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 0 });

    for (const name of HEART_NODE_NAMES) {
      expect(heart[name].scale.y).toBeCloseTo(1, 5);
    }
  });

  it("acorta el ventrículo en el eje largo al contraerse", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.LeftVentricle.scale.y).toBeLessThan(1);
  });

  it("engorda el ventrículo en el eje radial al contraerse", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.LeftVentricle.scale.x).toBeGreaterThan(1);
    expect(heart.LeftVentricle.scale.z).toBeGreaterThan(1);
  });

  it("la aurícula se deforma menos que el ventrículo", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 1, ventricles: 1 });

    const auricula = 1 - heart.LeftAtrium.scale.y;
    const ventriculo = 1 - heart.LeftVentricle.scale.y;
    expect(auricula).toBeLessThan(ventriculo);
  });

  it("la contracción auricular no mueve los ventrículos", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 1, ventricles: 0 });

    expect(heart.LeftVentricle.scale.y).toBeCloseTo(1, 5);
    expect(heart.RightVentricle.scale.y).toBeCloseTo(1, 5);
  });

  it("los grandes vasos apenas se mueven", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 1, ventricles: 1 });

    expect(Math.abs(1 - heart.Aorta.scale.y)).toBeLessThan(0.02);
  });

  it("el septo sigue a los ventrículos", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.Septum.scale.y).toBeLessThan(1);
  });

  it("es idempotente: aplicar dos veces el mismo valor no acumula", () => {
    const heart = nodes();

    applyExcursion(heart, { atria: 0, ventricles: 1 });
    const primera = heart.LeftVentricle.scale.y;
    applyExcursion(heart, { atria: 0, ventricles: 1 });

    expect(heart.LeftVentricle.scale.y).toBeCloseTo(primera, 6);
  });

  it("acepta excursión negativa sin invertir la geometría", () => {
    // El temblor de una fibrilación oscila en torno a cero.
    const heart = nodes();

    applyExcursion(heart, { atria: -0.06, ventricles: 0 });

    expect(heart.LeftAtrium.scale.y).toBeGreaterThan(0);
  });
});
