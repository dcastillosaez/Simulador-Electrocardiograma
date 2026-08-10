import { HEART_NODE_NAMES, type HeartNodeName, type HeartNodes } from "./heart-nodes";

export interface Excursions {
  atria: number;
  ventricles: number;
}

/** Cuánto se deforma cada estructura por unidad de excursión.
 *
 * `longitudinal` es negativo porque contraerse es acortarse; `radial` es
 * positivo porque el volumen que sale por el eje largo entra por el corto.
 * Los valores salen del spec (escala longitudinal 0,96 y radial 1,04 para el
 * ventrículo) y se atenúan para el resto: una aurícula se mueve bastante
 * menos que un ventrículo, y un gran vaso apenas pulsa.
 *
 * Es una tabla, no una cadena de condicionales, y por eso añadir una
 * estructura al modelo es añadir una fila. */
const DEFORMATION: Record<
  HeartNodeName,
  { driver: keyof Excursions; longitudinal: number; radial: number }
> = {
  LeftVentricle: { driver: "ventricles", longitudinal: -0.04, radial: 0.04 },
  RightVentricle: { driver: "ventricles", longitudinal: -0.04, radial: 0.04 },
  Septum: { driver: "ventricles", longitudinal: -0.03, radial: 0.02 },
  LeftAtrium: { driver: "atria", longitudinal: -0.02, radial: 0.02 },
  RightAtrium: { driver: "atria", longitudinal: -0.02, radial: 0.02 },
  Aorta: { driver: "ventricles", longitudinal: 0.004, radial: 0.008 },
  PulmonaryArtery: { driver: "ventricles", longitudinal: 0.004, radial: 0.008 },
  PulmonaryVeins: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  SuperiorVenaCava: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  InferiorVenaCava: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
};

/** Escala mínima admisible. Con excursiones acotadas a [-1, 1] y factores por
 * debajo de 0,05 no se alcanza nunca, pero una escala nula o negativa
 * invierte las normales de la malla y el modelo se vería del revés: más vale
 * que sea imposible por construcción. */
const MIN_SCALE = 0.5;

/** Escribe la deformación en los nodos. Muta a propósito: corre en cada
 * fotograma y asignar tres números es más barato que construir objetos.
 *
 * Idempotente: la escala se calcula siempre desde 1, nunca multiplicando la
 * anterior. Acumular sería una deriva lenta e invisible en una sesión corta y
 * un corazón encogido a la nada en una larga. */
export function applyExcursion(nodes: HeartNodes, excursions: Excursions): void {
  for (const name of HEART_NODE_NAMES) {
    const rule = DEFORMATION[name];
    const value = excursions[rule.driver];
    const node = nodes[name];
    node.scale.y = Math.max(MIN_SCALE, 1 + rule.longitudinal * value);
    const radial = Math.max(MIN_SCALE, 1 + rule.radial * value);
    node.scale.x = radial;
    node.scale.z = radial;
  }
}
