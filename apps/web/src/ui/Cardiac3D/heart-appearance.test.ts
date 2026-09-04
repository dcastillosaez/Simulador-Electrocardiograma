import { describe, expect, it } from "vitest";
import { HEART_NODE_NAMES } from "./heart-nodes";
import {
  APPEARANCE,
  GHOST_OPACITY,
  HEART_GROUPS,
  VALVE_APPEARANCE,
  groupIsVisible,
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

describe("VALVE_APPEARANCE", () => {
  it("saca las válvulas de las dos familias de color", () => {
    // Una valva no es sangre: es tejido fibroso, y en un corazón abierto se ve
    // blanco nacarado contra el rojo de todo lo demás. Es de las pocas cosas
    // de la anatomía cardíaca que se reconocen por el color antes que por la
    // forma, y por eso no lleva ni el rojo del lado izquierdo ni el azul del
    // derecho.
    const claridad = (color: number) =>
      ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255);

    for (const name of HEART_NODE_NAMES) {
      expect(VALVE_APPEARANCE.color).not.toBe(APPEARANCE[name].color);
      expect(claridad(VALVE_APPEARANCE.color)).toBeGreaterThan(
        claridad(APPEARANCE[name].color)
      );
    }
  });

  it("brilla más que cualquier cavidad", () => {
    // Una valva sana es lisa. Ese reflejo es lo que hace legible su
    // movimiento dentro de una cámara translúcida.
    expect(VALVE_APPEARANCE.roughness).toBeLessThan(APPEARANCE.LeftVentricle.roughness);
  });

  it("va en el grupo que se puede aislar", () => {
    expect(VALVE_APPEARANCE.group).toBe("valves");
    expect(HEART_GROUPS as readonly string[]).toContain("valves");
  });
});

describe("nodesInGroup", () => {
  it("reparte las estructuras anatómicas entre los grupos, sin solapes", () => {
    // El miocardio queda fuera: es geometría sintetizada con su propio
    // interruptor, no una alternativa a las cámaras.
    const all = HEART_GROUPS.flatMap((group) => nodesInGroup(group));
    const anatomicas = HEART_NODE_NAMES.filter((name) => name !== "Myocardium");
    expect(all).toHaveLength(anatomicas.length);
    expect(new Set(all).size).toBe(anatomicas.length);
    expect(all).not.toContain("Myocardium");
  });

  it("el miocardio tiene su propio grupo, fuera de los que se aíslan", () => {
    expect(APPEARANCE.Myocardium.group).toBe("myocardium");
    expect(HEART_GROUPS as readonly string[]).not.toContain("myocardium");
    expect(nodesInGroup("myocardium")).toEqual(["Myocardium"]);
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

  it("aislar las válvulas deja todas las estructuras en fantasma", () => {
    // Es el modo en que se usa este grupo: en el corazón entero las válvulas
    // quedan enterradas dentro de las cavidades, y con el resto insinuado se
    // ve exactamente lo que hacen.
    const visible = visibleNodes(new Set<HeartGroup>(["valves"]));

    expect(visible.size).toBe(0);
    expect(groupIsVisible("valves", new Set<HeartGroup>(["valves"]))).toBe(true);
  });
});

describe("groupIsVisible", () => {
  it("sin ningún grupo activo todo está visible", () => {
    // La misma regla que `visibleNodes`, y por eso está escrita una sola vez:
    // un filtro vacío no filtra nada.
    expect(groupIsVisible("valves", new Set())).toBe(true);
    expect(groupIsVisible("ventricles", new Set())).toBe(true);
  });

  it("con otro grupo activo, no", () => {
    expect(groupIsVisible("valves", new Set<HeartGroup>(["ventricles"]))).toBe(false);
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
