import type { ValveGroup } from "../../cardiac/valve-timeline";
import type { Object3DLike } from "./heart-nodes";

/** Las cuatro válvulas del corazón, con las valvas que trae el modelo.
 *
 * Van aparte de `HEART_NODE_NAMES` y no dentro, y no por comodidad: una
 * estructura de aquella lista es un sólido que se deforma con el latido y que
 * el corte anatómico tapa con una sección maciza. Una valva no es ninguna de
 * las dos cosas — es una membrana de medio milímetro que gira sobre su anillo
 * y que, al no ser un sólido cerrado, rompería la cuenta de stencil con la que
 * se dibujan esas tapas. Mezclarlas costaría veintidós pasadas de stencil para
 * producir artefactos.
 *
 * El orden dentro de cada válvula es el anatómico, no el del `.glb`: los
 * nombres son el contrato con `docs/fase-d/add-heart-valves.py`, y si el
 * modelo deja de traer uno la carga falla diciendo cuál.
 *
 * Las valvas salen de BodyParts3D como conceptos propios, pero ninguna de las
 * dos poses del ciclo: la fuente las modela entreabiertas, en una posición
 * neutra que no es ni la cerrada ni la abierta. Las dos se sintetizan girando
 * cada valva sobre su anillo, y viajan en el `.glb` como *morph targets*.
 * Ver `docs/fase-d/valvulas.md`. */
export const HEART_VALVES = {
  Mitral: {
    label: "Mitral",
    group: "atrioventricular",
    leaflets: ["MitralAnterior", "MitralPosterior"],
  },
  Tricuspid: {
    label: "Tricúspide",
    group: "atrioventricular",
    leaflets: ["TricuspidAnterior", "TricuspidPosterior", "TricuspidSeptal"],
  },
  Aortic: {
    label: "Aórtica",
    group: "semilunar",
    leaflets: ["AorticLeft", "AorticRight", "AorticAnterior"],
  },
  Pulmonary: {
    label: "Pulmonar",
    group: "semilunar",
    leaflets: ["PulmonaryLeft", "PulmonaryPosterior", "PulmonaryRight"],
  },
} as const satisfies Record<
  string,
  { label: string; group: ValveGroup; leaflets: readonly string[] }
>;

export type ValveName = keyof typeof HEART_VALVES;

/** Orden en que se enseñan. Izquierda antes que derecha y entrada antes que
 * salida: es el recorrido de la sangre por el corazón izquierdo y luego por el
 * derecho, que es como se explican. */
export const VALVE_ORDER = ["Mitral", "Aortic", "Tricuspid", "Pulmonary"] as const;

export type ValveLeafletName =
  (typeof HEART_VALVES)[ValveName]["leaflets"][number];

export const VALVE_LEAFLET_NAMES: readonly ValveLeafletName[] = VALVE_ORDER.flatMap(
  (valve) => HEART_VALVES[valve].leaflets as readonly ValveLeafletName[]
);

/** A qué válvula pertenece cada valva. Se deriva de la tabla en vez de
 * escribirse aparte: dos listas que hay que mantener a la vez se
 * desincronizan siempre. */
export const VALVE_OF_LEAFLET = Object.fromEntries(
  VALVE_ORDER.flatMap((valve) =>
    HEART_VALVES[valve].leaflets.map((leaflet) => [leaflet, valve])
  )
) as Record<ValveLeafletName, ValveName>;

/** Lo mínimo que el animador necesita de una valva.
 *
 * `morphTargetInfluences` es lo único que la mueve: el `.glb` trae la pose
 * abierta —y la comba que hace del recorrido un arco y no una cuerda— como
 * diferencias de vértices, así que animar una válvula es escribir dos números
 * que salen de uno solo y dejar que la interpolación la haga la GPU. Ni una
 * matriz que componer ni un vértice que tocar por fotograma.
 *
 * Tiparlo así en vez de contra `THREE.Mesh` mantiene este módulo y su animador
 * testeables sin instanciar Three.js. */
export interface MorphableLike extends Object3DLike {
  morphTargetInfluences?: number[];
}

export type ValveNodes = Record<ValveLeafletName, MorphableLike>;

export function bindValveNodes(root: Object3DLike): ValveNodes {
  const wanted = new Set<string>(VALVE_LEAFLET_NAMES);
  const found: Partial<ValveNodes> = {};

  const visit = (node: Object3DLike): void => {
    if (wanted.has(node.name)) {
      found[node.name as ValveLeafletName] = node as MorphableLike;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);

  const missing = VALVE_LEAFLET_NAMES.filter((name) => found[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `El modelo no trae estas valvas: ${missing.join(", ")}. ` +
        "Ejecuta docs/fase-d/add-heart-valves.py para reconstruir heart.glb."
    );
  }

  const flat = VALVE_LEAFLET_NAMES.filter(
    (name) => (found[name] as MorphableLike).morphTargetInfluences === undefined
  );
  if (flat.length > 0) {
    throw new Error(
      `Estas valvas vienen sin pose abierta: ${flat.join(", ")}. ` +
        "El .glb se escribió sin morph targets."
    );
  }

  return found as ValveNodes;
}
