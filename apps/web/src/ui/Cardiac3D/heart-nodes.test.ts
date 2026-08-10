import { describe, expect, it } from "vitest";
import { HEART_NODE_NAMES, bindHeartNodes } from "./heart-nodes";

/** Un árbol mínimo con la misma forma que expone Three.js. No se usa un
 * `Object3D` real: el binding solo recorre `name` e `children`, y traer
 * Three.js entero a un test de recorrido de árbol lo haría más lento sin
 * comprobar nada más. */
function node(name: string, children: unknown[] = []) {
  return { name, children, scale: { x: 1, y: 1, z: 1 } };
}

function fullHeart() {
  return node("Heart", HEART_NODE_NAMES.map((name) => node(name)));
}

describe("bindHeartNodes", () => {
  it("encuentra todas las estructuras del contrato", () => {
    const nodes = bindHeartNodes(fullHeart() as never);

    for (const name of HEART_NODE_NAMES) {
      expect(nodes[name]).toBeDefined();
    }
  });

  it("las busca en profundidad, no solo entre los hijos directos", () => {
    const anidado = node("Heart", [
      node("Chambers", HEART_NODE_NAMES.map((name) => node(name))),
    ]);

    const nodes = bindHeartNodes(anidado as never);

    expect(nodes.LeftVentricle).toBeDefined();
  });

  it("falla con un mensaje que nombra lo que falta", () => {
    const incompleto = node(
      "Heart",
      HEART_NODE_NAMES.filter((name) => name !== "LeftVentricle").map((name) =>
        node(name)
      )
    );

    expect(() => bindHeartNodes(incompleto as never)).toThrow(/LeftVentricle/);
  });

  it("enumera todo lo que falta, no solo lo primero", () => {
    const vacio = node("Heart", []);

    expect(() => bindHeartNodes(vacio as never)).toThrow(/LeftAtrium.*Aorta/s);
  });

  it("ignora mallas que no están en el contrato", () => {
    const conExtras = node("Heart", [
      ...HEART_NODE_NAMES.map((name) => node(name)),
      node("Pericardium"),
    ]);

    const nodes = bindHeartNodes(conExtras as never);

    expect(Object.keys(nodes)).toHaveLength(HEART_NODE_NAMES.length);
  });
});
