/** Estructuras del modelo, por nombre. El contrato con el modelo anatómico.
 *
 * Nunca por índice: el orden de los nodos de un GLB cambia al reexportar, y
 * el fallo sería silencioso —el ventrículo latiendo y la aorta encogiéndose—
 * en vez de un error. Aquí, si falta un nombre, la carga falla con un
 * mensaje que dice cuál.
 *
 * Son nueve y no diez: el brief listaba también `Septum`, pero BodyParts3D
 * no trae malla del tabique interventricular y no hay de dónde sacarla sin
 * inventarla. No se pierde nada en esta entrega —el tabique no se ve desde
 * fuera en un modelo sólido— y donde hará falta es en el corte anatómico de
 * la Entrega 3. Ver `docs/fase-d/anatomy-source.md`. */
export const HEART_NODE_NAMES = [
  "LeftAtrium",
  "RightAtrium",
  "LeftVentricle",
  "RightVentricle",
  "Aorta",
  "PulmonaryArtery",
  "PulmonaryVeins",
  "SuperiorVenaCava",
  "InferiorVenaCava",
  // Sintetizado, no anatomico. BodyParts3D no trae miocardio ventricular: sus
  // conceptos de "pared" son los musculos papilares y una membrana fina, y de
  // los 83 elementos del corazon los 61 que no son cavidad son vasos
  // coronarios. Esta malla se calcula engordando cada cavidad hacia fuera su
  // propio grosor —12 mm el ventriculo izquierdo, 5 el derecho, 2,5 las
  // auriculas— y repartiendo el espacio disputado por cercania. Ver
  // `docs/fase-d/miocardio-y-fuente.md`.
  //
  // Va en la lista, y no aparte, porque asi lo recogen solas las tablas de
  // deformacion, aspecto y tapas del corte. Lo que lo mantiene honesto es que
  // viene apagado y se enciende a proposito.
  "Myocardium",
] as const;

export type HeartNodeName = (typeof HEART_NODE_NAMES)[number];

/** Lo mínimo que el animador necesita de un `Object3D`. Tiparlo así en vez de
 * contra `THREE.Object3D` mantiene `HeartAnimator` y este módulo testeables
 * sin instanciar Three.js. */
export interface Object3DLike {
  name: string;
  children: Object3DLike[];
  scale: { x: number; y: number; z: number };
}

export type HeartNodes = Record<HeartNodeName, Object3DLike>;

export function bindHeartNodes(root: Object3DLike): HeartNodes {
  const wanted = new Set<string>(HEART_NODE_NAMES);
  const found: Partial<HeartNodes> = {};

  const visit = (node: Object3DLike): void => {
    if (wanted.has(node.name)) {
      found[node.name as HeartNodeName] = node;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);

  const missing = HEART_NODE_NAMES.filter((name) => found[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `El modelo no trae estas estructuras: ${missing.join(", ")}. ` +
        "Comprueba los nombres de objeto en Blender antes de exportar."
    );
  }

  return found as HeartNodes;
}
