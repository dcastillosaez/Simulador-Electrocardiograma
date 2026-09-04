import { describe, expect, it } from "vitest";
import {
  HEART_VALVES,
  VALVE_LEAFLET_NAMES,
  VALVE_OF_LEAFLET,
  VALVE_ORDER,
  bindValveNodes,
  type MorphableLike,
} from "./heart-valves";
import { HEART_NODE_NAMES } from "./heart-nodes";

function leaflet(name: string): MorphableLike {
  return { name, children: [], scale: { x: 1, y: 1, z: 1 }, morphTargetInfluences: [0] };
}

function model(names: readonly string[] = VALVE_LEAFLET_NAMES): MorphableLike {
  return {
    name: "Heart",
    children: names.map(leaflet),
    scale: { x: 1, y: 1, z: 1 },
  };
}

describe("HEART_VALVES", () => {
  it("trae las once valvas del modelo", () => {
    expect(VALVE_LEAFLET_NAMES).toHaveLength(11);
    expect(new Set(VALVE_LEAFLET_NAMES).size).toBe(11);
  });

  it("cuenta las valvas que tiene cada válvula en la anatomía", () => {
    // La mitral tiene dos velos y por eso se llama bicúspide; las otras tres,
    // tres. Es la comprobación que caza que alguien haya perdido una valva al
    // reconstruir el modelo.
    expect(HEART_VALVES.Mitral.leaflets).toHaveLength(2);
    expect(HEART_VALVES.Tricuspid.leaflets).toHaveLength(3);
    expect(HEART_VALVES.Aortic.leaflets).toHaveLength(3);
    expect(HEART_VALVES.Pulmonary.leaflets).toHaveLength(3);
  });

  it("reparte las cuatro entre las dos familias que se mueven en contrafase", () => {
    expect(HEART_VALVES.Mitral.group).toBe("atrioventricular");
    expect(HEART_VALVES.Tricuspid.group).toBe("atrioventricular");
    expect(HEART_VALVES.Aortic.group).toBe("semilunar");
    expect(HEART_VALVES.Pulmonary.group).toBe("semilunar");
  });

  it("no se solapa con las estructuras que se deforman", () => {
    // Una valva es una membrana abierta: si entrara en aquella lista, la
    // cuenta de stencil del corte anatómico intentaría taparla como un sólido.
    const structures = new Set<string>(HEART_NODE_NAMES);
    for (const leafletName of VALVE_LEAFLET_NAMES) {
      expect(structures.has(leafletName)).toBe(false);
    }
  });

  it("deriva a qué válvula pertenece cada valva de la misma tabla", () => {
    for (const valve of VALVE_ORDER) {
      for (const name of HEART_VALVES[valve].leaflets) {
        expect(VALVE_OF_LEAFLET[name]).toBe(valve);
      }
    }
  });
});

describe("bindValveNodes", () => {
  it("encuentra las once por nombre", () => {
    const nodes = bindValveNodes(model());

    expect(Object.keys(nodes).sort()).toEqual([...VALVE_LEAFLET_NAMES].sort());
  });

  it("las busca en profundidad", () => {
    const root: MorphableLike = {
      name: "Scene",
      children: [model()],
      scale: { x: 1, y: 1, z: 1 },
    };

    expect(Object.keys(bindValveNodes(root))).toHaveLength(11);
  });

  it("dice cuál falta en vez de fallar callando", () => {
    const incompleto = model(VALVE_LEAFLET_NAMES.filter((n) => n !== "MitralAnterior"));

    expect(() => bindValveNodes(incompleto)).toThrow(/MitralAnterior/);
  });

  it("rechaza un modelo cuyas valvas no traen la pose abierta", () => {
    // Sin morph target la válvula se cargaría sin error y se quedaría quieta
    // para siempre, que es un fallo mucho más caro de encontrar.
    const sinPose = model();
    for (const child of sinPose.children as MorphableLike[]) {
      delete child.morphTargetInfluences;
    }

    expect(() => bindValveNodes(sinPose)).toThrow(/pose abierta/);
  });
});
