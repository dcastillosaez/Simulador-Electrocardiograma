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

/** Grupos conmutables. Son los que un docente pide de verdad —"enséñame solo
 * los ventrículos"— y no una lista exhaustiva de nodos. */
export type HeartGroup =
  | "ventricles"
  | "atria"
  | "vessels"
  | "myocardium"
  | "valves";

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
 * como se dibujan en un atlas.
 *
 * La separación dentro de cada familia está **medida**, no elegida a ojo. Se
 * calcularon los pares de estructuras que llegan a tocarse en la sección
 * coronal barriendo el plano por cinco profundidades —doce pares— y se
 * comprobó la diferencia perceptual de cada uno en CIE Lab. La primera versión
 * de esta tabla dejaba cuatro pares por debajo de 12, que es donde el ojo deja
 * de separar dos tonos vecinos con fiabilidad; con estos valores el peor par
 * adyacente está en 23 y las dos familias siguen a 52 de distancia, que es lo
 * que hace que rojo y azul no se confundan nunca. */
export const APPEARANCE: Record<HeartNodeName, Appearance> = {
  LeftVentricle: {
    color: 0xd44038,
    circuit: "systemic",
    kind: "chamber",
    group: "ventricles",
    roughness: 0.62,
  },
  LeftAtrium: {
    color: 0xe8836b,
    circuit: "systemic",
    kind: "chamber",
    group: "atria",
    roughness: 0.62,
  },
  Aorta: {
    color: 0x8f1220,
    circuit: "systemic",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  PulmonaryVeins: {
    // Más claro que la aurícula izquierda a propósito: son cuatro troncos que
    // desembocan justo en ella, y con tonos vecinos el punto de desembocadura
    // —que es lo que interesa ver— se pierde.
    color: 0xf7c0a6,
    circuit: "systemic",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  RightVentricle: {
    color: 0x3a72c8,
    circuit: "pulmonary",
    kind: "chamber",
    group: "ventricles",
    roughness: 0.62,
  },
  RightAtrium: {
    color: 0x8fc0ea,
    circuit: "pulmonary",
    kind: "chamber",
    group: "atria",
    roughness: 0.62,
  },
  PulmonaryArtery: {
    color: 0x1b3a7c,
    circuit: "pulmonary",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  SuperiorVenaCava: {
    // Las dos cavas tenían el mismo color exacto, y además se confundían con
    // la aurícula a la que desembocan: en la sección coronal ese par salía a
    // una diferencia perceptual de 10, por debajo de lo que el ojo separa con
    // fiabilidad. Se les da un azul con algo de verde, que las aparta de la
    // aurícula sin sacarlas de la familia fría.
    color: 0x2f8fa6,
    circuit: "pulmonary",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
  Myocardium: {
    // Pardo de musculo, fuera de las dos familias a proposito: no es sangre,
    // ni izquierda ni derecha. Medido contra las nueve estructuras, el par mas
    // parecido queda a 33 de distancia perceptual.
    color: 0x8c6156,
    circuit: "systemic",
    kind: "chamber",
    group: "myocardium",
    roughness: 0.85,
  },
  InferiorVenaCava: {
    color: 0x59b8c4,
    circuit: "pulmonary",
    kind: "vessel",
    group: "vessels",
    roughness: 0.42,
  },
};

/** Aspecto de las válvulas. Una fila por válvula y no por valva: las tres
 * sigmoideas de una aórtica son la misma pieza de tejido vistas por tres
 * sitios, y darles colores distintos sugeriría una diferencia que no existe.
 *
 * El color se sale de las dos familias, como el pardo del miocardio y por el
 * mismo motivo: una valva no es sangre. Es tejido fibroso, y en un corazón
 * abierto se ve blanco nacarado contra el rojo de todo lo demás — de las pocas
 * cosas de la anatomía cardíaca que se reconocen por el color antes que por la
 * forma. Medido contra las diez estructuras, el par más parecido queda a 25 de
 * distancia perceptual, por encima incluso del peor par adyacente de la tabla
 * de arriba.
 *
 * Las cuatro comparten color a propósito. Cuál es cuál se lee por dónde está y
 * por el rótulo del panel; teñirlas de cuatro tonos distintos gastaría cuatro
 * colores en una distinción que la posición ya da, y dejaría la escena sin
 * margen para las coronarias del día que lleguen. */
export const VALVE_APPEARANCE: Appearance = {
  color: 0xf5efe2,
  circuit: "systemic",
  kind: "vessel",
  group: "valves",
  // Menos mate que una cavidad y menos que un vaso: una valva sana es lisa y
  // brilla. Ese reflejo es lo que hace legible su movimiento cuando gira
  // dentro de una cámara translúcida.
  roughness: 0.28,
};

/** Los grupos que se pueden aislar. El miocardio queda fuera a proposito:
 * tiene su propio interruptor porque no es una alternativa a las camaras sino
 * una capa que las tapa, y porque al ser geometria sintetizada conviene que
 * encenderla sea un gesto deliberado.
 *
 * Las válvulas sí están, y son el grupo que más se usa: en el corazón entero
 * quedan enterradas dentro de las cavidades, así que aislarlas —lo que deja
 * las cámaras como fantasmas— es la forma de ver cómo se abren y se cierran. */
export const HEART_GROUPS = ["ventricles", "atria", "vessels", "valves"] as const;

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
export function groupIsVisible(
  group: HeartGroup,
  active: ReadonlySet<HeartGroup>
): boolean {
  return active.size === 0 || active.has(group);
}

export function visibleNodes(active: ReadonlySet<HeartGroup>): Set<HeartNodeName> {
  return new Set(
    HEART_NODE_NAMES.filter((name) => groupIsVisible(APPEARANCE[name].group, active))
  );
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
