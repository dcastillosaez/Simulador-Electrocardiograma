import { HEART_NODE_NAMES, type HeartNodeName, type HeartNodes } from "./heart-nodes";
import type { ConductionChamber } from "./ConductionSystem/conduction-structures";

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
interface DeformationRule {
  driver: keyof Excursions;
  longitudinal: number;
  radial: number;
}

const ANATOMY: Record<HeartNodeName, DeformationRule> = {
  LeftVentricle: { driver: "ventricles", longitudinal: -0.04, radial: 0.04 },
  RightVentricle: { driver: "ventricles", longitudinal: -0.04, radial: 0.04 },
  LeftAtrium: { driver: "atria", longitudinal: -0.02, radial: 0.02 },
  RightAtrium: { driver: "atria", longitudinal: -0.02, radial: 0.02 },
  Aorta: { driver: "ventricles", longitudinal: 0.004, radial: 0.008 },
  PulmonaryArtery: { driver: "ventricles", longitudinal: 0.004, radial: 0.008 },
  PulmonaryVeins: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  SuperiorVenaCava: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  InferiorVenaCava: { driver: "atria", longitudinal: 0.002, radial: 0.004 },
  // El miocardio envuelve las cuatro camaras, asi que no tiene un solo motor.
  // Se le da el ventricular porque es el movimiento dominante con diferencia:
  // la sistole auricular apenas mueve la masa del organo. Es una
  // aproximacion, y la consecuencia es que en la sistole auricular el musculo
  // no acompana del todo a la auricula que hay debajo.
  Myocardium: { driver: "ventricles", longitudinal: -0.03, radial: 0.03 },
};

/** Los grupos del sistema de conducción, uno por cámara.
 *
 * Uno por cámara y no uno auricular y otro ventricular, porque los nodos del
 * `.glb` tienen pivotes distintos —31 mm entre los dos ventrículos— y una
 * escala respecto a otro punto mueve lo mismo de forma distinta: un único
 * grupo ventricular se habría despegado de uno de los dos moldes en cada
 * latido. Cada grupo se coloca en el pivote de su cámara y recibe **su misma
 * fila**, por referencia y no copiada: si la fila de la cámara cambia, la
 * conducción la sigue sin que nadie se acuerde de tocarla. */
export const CONDUCTION_GROUPS = {
  ConductionRightAtrium: "RightAtrium",
  ConductionLeftAtrium: "LeftAtrium",
  ConductionRightVentricle: "RightVentricle",
  ConductionLeftVentricle: "LeftVentricle",
} as const satisfies Record<string, ConductionChamber>;

export type ConductionGroupName = keyof typeof CONDUCTION_GROUPS;

export const CONDUCTION_GROUP_NAMES = Object.keys(
  CONDUCTION_GROUPS
) as ConductionGroupName[];

export function conductionGroupOf(chamber: ConductionChamber): ConductionGroupName {
  return CONDUCTION_GROUP_NAMES.find((name) => CONDUCTION_GROUPS[name] === chamber)!;
}

export const DEFORMATION: Record<HeartNodeName | ConductionGroupName, DeformationRule> = {
  ...ANATOMY,
  ConductionRightAtrium: ANATOMY.RightAtrium,
  ConductionLeftAtrium: ANATOMY.LeftAtrium,
  ConductionRightVentricle: ANATOMY.RightVentricle,
  ConductionLeftVentricle: ANATOMY.LeftVentricle,
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
export function applyExcursion(
  nodes: HeartNodes,
  excursions: Excursions,
  conduction?: Partial<Record<ConductionGroupName, { scale: Vector3Like }>>
): void {
  for (const name of HEART_NODE_NAMES) {
    writeScale(nodes[name].scale, DEFORMATION[name], excursions);
  }
  if (conduction === undefined) return;
  for (const name of CONDUCTION_GROUP_NAMES) {
    const group = conduction[name];
    if (group) writeScale(group.scale, DEFORMATION[name], excursions);
  }
}

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

function scaleFor(rule: DeformationRule, excursions: Excursions, out: Vector3Like): void {
  const value = excursions[rule.driver];
  out.y = Math.max(MIN_SCALE, 1 + rule.longitudinal * value);
  const radial = Math.max(MIN_SCALE, 1 + rule.radial * value);
  out.x = radial;
  out.z = radial;
}

function writeScale(scale: Vector3Like, rule: DeformationRule, excursions: Excursions): void {
  scaleFor(rule, excursions, scale);
}

/** Dónde acaba un punto de la escena cuando la estructura `name`, con pivote
 * `pivot`, recibe estas excursiones. Es la cuenta que hace la GPU con la
 * escala del nodo, escrita para poder medirla: con ella se fija en un test
 * cuánto se separan dos grupos en una unión. */
export function deformPoint(
  point: readonly [number, number, number],
  pivot: readonly [number, number, number],
  name: HeartNodeName | ConductionGroupName,
  excursions: Excursions
): [number, number, number] {
  const scale = { x: 1, y: 1, z: 1 };
  scaleFor(DEFORMATION[name], excursions, scale);
  return [
    pivot[0] + (point[0] - pivot[0]) * scale.x,
    pivot[1] + (point[1] - pivot[1]) * scale.y,
    pivot[2] + (point[2] - pivot[2]) * scale.z,
  ];
}
