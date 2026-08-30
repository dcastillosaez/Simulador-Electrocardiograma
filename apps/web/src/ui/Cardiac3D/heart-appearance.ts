import { HEART_NODE_NAMES, type HeartNodeName } from "./heart-nodes";

/** Aspecto y agrupación de cada estructura. Es la capa que convierte nueve
 * mallas grises indistinguibles en un corazón legible.
 *
 * El código de color es el convenio de cualquier atlas: circuito izquierdo en
 * rojo, derecho en azul. No es decorativo — es la única pista visual de qué
 * sangre lleva cada cámara, y un alumno la reconoce antes de leer un rótulo.
 *
 * Lo que el modelo enseña, conviene recordarlo, es el volumen sanguíneo y no
 * el músculo: las cuatro cavidades son moldes macizos de la sangre que
 * contienen, y solo las aurículas traen además su pared. Ver
 * `docs/fase-d/miocardio-y-fuente.md`. Por eso el rojo y el azul son aquí más
 * literales de lo que parecen. */

/** A qué circuito pertenece. Decide la familia de color. */
export type Circuit = "systemic" | "pulmonary";

/** Qué clase de estructura es. Decide el acabado: una cámara es músculo y
 * sangre vistos a través de una pared mate; un gran vaso es una superficie
 * tensa y algo más brillante. Separarlos evita que doce rojos distintos
 * acaben pareciendo el mismo. */
export type StructureKind = "chamber" | "vessel";

/** Grupos conmutables. Son los tres que un docente pide de verdad —"enséñame
 * solo los ventrículos"— y no una lista exhaustiva de nodos. */
export type HeartGroup = "ventricles" | "atria" | "vessels";

export interface Appearance {
  /** Color base en hexadecimal, listo para `THREE.Color`. */
  color: number;
  circuit: Circuit;
  kind: StructureKind;
  group: HeartGroup;
  /** Rugosidad del material. Las cámaras algo más mate que los vasos. */
  roughness: number;
}

/** Tabla, no cadena de condicionales, por el mismo motivo que `DEFORMATION` en
 * `HeartAnimator`: añadir una estructura al modelo tiene que ser añadir una
 * fila. Cuando el `.glb` se reconstruya con las coronarias, entran aquí.
 *
 * Los tonos dentro de cada familia no son arbitrarios: se oscurecen conforme
 * la sangre se aleja del capilar. La aorta es el rojo más profundo del lado
 * izquierdo y el tronco pulmonar el azul más profundo del derecho, que es
 * como se dibujan en un atlas. */
export const APPEARANCE: Record<HeartNodeName, Appearance> = {
  LeftVentricle: {
    color: 0xc03030,
    circuit: "systemic",
    kind: "chamber",
    group: "ventricles",
    roughness: 0.62,
  },
  LeftAtrium: {
    color: 0xd8685a,
    circuit: "systemic",
    kind: "chamber",
    group: "atria",
    roughness: 0.62,
  },
  Aorta: {
    color: 0xa01a28,
    circuit: "systemic",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  PulmonaryVeins: {
    // Más claro que la aurícula izquierda a propósito: son cuatro troncos que
    // desembocan justo en ella, y con tonos vecinos el punto de desembocadura
    // —que es lo que interesa ver— se pierde.
    color: 0xf0a08c,
    circuit: "systemic",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  RightVentricle: {
    color: 0x2e60a8,
    circuit: "pulmonary",
    kind: "chamber",
    group: "ventricles",
    roughness: 0.62,
  },
  RightAtrium: {
    color: 0x6096d6,
    circuit: "pulmonary",
    kind: "chamber",
    group: "atria",
    roughness: 0.62,
  },
  PulmonaryArtery: {
    color: 0x24488c,
    circuit: "pulmonary",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  SuperiorVenaCava: {
    color: 0x487cbe,
    circuit: "pulmonary",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  InferiorVenaCava: {
    color: 0x487cbe,
    circuit: "pulmonary",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
};

export const HEART_GROUPS = ["ventricles", "atria", "vessels"] as const;

/** Qué estructuras caen en cada grupo. Se deriva de la tabla en vez de
 * escribirse aparte: dos listas que hay que mantener a la vez se
 * desincronizan siempre. */
export function nodesInGroup(group: HeartGroup): HeartNodeName[] {
  return HEART_NODE_NAMES.filter((name) => APPEARANCE[name].group === group);
}

/** Estructuras visibles con los grupos activos dados.
 *
 * Ningún grupo activo significa *todo* visible, no nada. Es la diferencia
 * entre un filtro y un interruptor: quien no ha tocado los conmutadores
 * espera ver el corazón entero, y quien los apaga todos ha vuelto al punto de
 * partida, no a una pantalla negra que parece un fallo de carga. */
export function visibleNodes(active: ReadonlySet<HeartGroup>): Set<HeartNodeName> {
  if (active.size === 0) return new Set(HEART_NODE_NAMES);
  return new Set(HEART_NODE_NAMES.filter((name) => active.has(APPEARANCE[name].group)));
}

/** Opacidad efectiva de una estructura.
 *
 * Las estructuras ocultas no se apagan del todo: se dejan como un fantasma muy
 * tenue. Un ventrículo aislado flotando en el vacío pierde la referencia de
 * dónde estaba, y recuperarla cuesta un giro de cámara entero. Con el resto
 * insinuado, el aislamiento sigue leyéndose y la orientación no se pierde.
 *
 * Devuelve 1 exacto cuando no hay nada que mezclar, porque un material
 * transparente con opacidad 1 sigue pasando por el camino de mezclado del
 * renderizador y ordena mal contra los opacos. */
export const GHOST_OPACITY = 0.06;

export function opacityFor(
  name: HeartNodeName,
  visible: ReadonlySet<HeartNodeName>,
  baseOpacity: number
): number {
  if (!visible.has(name)) return GHOST_OPACITY;
  return baseOpacity;
}
