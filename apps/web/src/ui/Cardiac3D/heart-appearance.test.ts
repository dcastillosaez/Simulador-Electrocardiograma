import { describe, expect, it } from "vitest";
import { HEART_NODE_NAMES } from "./heart-nodes";
import {
  APPEARANCE,
  GHOST_OPACITY,
  HEART_GROUPS,
  nodesInGroup,
  opacityFor,
  visibleNodes,
  type HeartGroup,
} from "./heart-appearance";

describe("APPEARANCE", () => {
  it("cubre las nueve estructuras del contrato", () => {
    expect(Object.keys(APPEARANCE).sort()).toEqual([...HEART_NODE_NAMES].sort());
  });

  it("reparte los circuitos como manda la anatomía", () => {
    // El lado izquierdo lleva sangre oxigenada y el derecho no. Si alguien
    // mueve una cámara de familia, el color deja de significar lo que
    // significa en cualquier atlas.
    expect(APPEARANCE.LeftAtrium.circuit).toBe("systemic");
    expect(APPEARANCE.LeftVentricle.circuit).toBe("systemic");
    expect(APPEARANCE.Aorta.circuit).toBe("systemic");
    expect(APPEARANCE.PulmonaryVeins.circuit).toBe("systemic");

    expect(APPEARANCE.RightAtrium.circuit).toBe("pulmonary");
    expect(APPEARANCE.RightVentricle.circuit).toBe("pulmonary");
    expect(APPEARANCE.PulmonaryArtery.circuit).toBe("pulmonary");
    expect(APPEARANCE.SuperiorVenaCava.circuit).toBe("pulmonary");
    expect(APPEARANCE.InferiorVenaCava.circuit).toBe("pulmonary");
  });

  it("las venas pulmonares son del circuito sistémico pese al nombre", () => {
    // El error clásico: se llaman pulmonares y se pintan de azul. Llevan la
    // sangre ya oxigenada de vuelta al corazón, así que van en rojo.
    expect(APPEARANCE.PulmonaryVeins.circuit).toBe("systemic");
    expect(APPEARANCE.PulmonaryArtery.circuit).toBe("pulmonary");
  });

  it("distingue el acabado de una cámara del de un vaso", () => {
    expect(APPEARANCE.LeftVentricle.roughness).toBeGreaterThan(
      APPEARANCE.Aorta.roughness
    );
  });
});

describe("nodesInGroup", () => {
  it("reparte las nueve estructuras entre los tres grupos, sin solapes", () => {
    const all = HEART_GROUPS.flatMap((group) => nodesInGroup(group));
    expect(all).toHaveLength(HEART_NODE_NAMES.length);
    expect(new Set(all).size).toBe(HEART_NODE_NAMES.length);
  });

  it("agrupa los dos ventrículos juntos", () => {
    expect(nodesInGroup("ventricles").sort()).toEqual([
      "LeftVentricle",
      "RightVentricle",
    ]);
  });
});

describe("visibleNodes", () => {
  it("sin ningún grupo activo enseña el corazón entero", () => {
    // Un filtro vacío no filtra nada. La alternativa —pantalla en negro— es
    // indistinguible de un fallo de carga.
    expect(visibleNodes(new Set()).size).toBe(HEART_NODE_NAMES.length);
  });

  it("con un grupo activo enseña solo ese grupo", () => {
    const visible = visibleNodes(new Set<HeartGroup>(["atria"]));
    expect([...visible].sort()).toEqual(["LeftAtrium", "RightAtrium"]);
  });

  it("acumula varios grupos", () => {
    const visible = visibleNodes(new Set<HeartGroup>(["atria", "ventricles"]));
    expect(visible.size).toBe(4);
    expect(visible.has("Aorta")).toBe(false);
  });
});

describe("opacityFor", () => {
  it("deja lo visible en la opacidad pedida", () => {
    const visible = visibleNodes(new Set<HeartGroup>(["ventricles"]));
    expect(opacityFor("LeftVentricle", visible, 1)).toBe(1);
    expect(opacityFor("LeftVentricle", visible, 0.4)).toBe(0.4);
  });

  it("deja lo oculto como fantasma y no como vacío", () => {
    // Ocultar del todo pierde la referencia de dónde estaba la cámara
    // aislada; recuperarla cuesta un giro de cámara entero.
    const visible = visibleNodes(new Set<HeartGroup>(["ventricles"]));
    expect(opacityFor("Aorta", visible, 1)).toBe(GHOST_OPACITY);
    expect(GHOST_OPACITY).toBeGreaterThan(0);
  });
});
