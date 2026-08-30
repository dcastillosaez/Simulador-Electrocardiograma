import { describe, expect, it } from "vitest";
import { HEART_NODE_NAMES } from "./heart-nodes";
import { driverFor } from "./HeartAnimator";
import {
  APPEARANCE,
  GHOST_OPACITY,
  HEART_GROUPS,
  nodesInGroup,
  opacityFor,
  visibleNodes,
  VESSEL_GLOW_MAX,
  vesselGlow,
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

describe("vesselGlow", () => {
  it("sigue a la excursión de la cámara que llena el vaso", () => {
    expect(vesselGlow(0, true)).toBe(0);
    expect(vesselGlow(1, true)).toBe(VESSEL_GLOW_MAX);
    expect(vesselGlow(0.5, true)).toBeCloseTo(VESSEL_GLOW_MAX / 2);
  });

  it("se apaga cuando la cámara tiembla en vez de expulsar", () => {
    // En una fibrilación ventricular el ventrículo se mueve mucho y no bombea
    // nada. Que la aorta se apague no es un efecto: es el hallazgo.
    expect(vesselGlow(1, false)).toBe(0);
    expect(vesselGlow(0.7, false)).toBe(0);
  });

  it("acota la excursión, venga como venga", () => {
    expect(vesselGlow(3, true)).toBe(VESSEL_GLOW_MAX);
    expect(vesselGlow(-2, true)).toBe(0);
  });
});

describe("driverFor", () => {
  it("enciende cada vaso con la cámara que de verdad lo llena", () => {
    // La aorta con el ventrículo izquierdo, las cavas con la aurícula. Si esto
    // se invirtiera, el destello iría a contratiempo del latido.
    expect(driverFor("Aorta")).toBe("ventricles");
    expect(driverFor("PulmonaryArtery")).toBe("ventricles");
    expect(driverFor("SuperiorVenaCava")).toBe("atria");
    expect(driverFor("InferiorVenaCava")).toBe("atria");
    expect(driverFor("PulmonaryVeins")).toBe("atria");
  });
});
