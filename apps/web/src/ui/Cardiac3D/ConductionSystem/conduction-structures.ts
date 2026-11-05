import paths from "./conduction-paths.json";

/** Las estructuras del sistema de conducción, en el orden en que las recorre
 * el impulso.
 *
 * El orden no es decorativo: es el índice que viaja en el atributo de cada
 * vértice (`aStructure`) y con el que el sombreador busca la ventana temporal
 * de su estructura. Cambiarlo obliga a regenerar nada —la geometría se
 * construye en el cliente— pero sí a mirar `ELECTRICAL_DRIVE`. */
export const CONDUCTION_STRUCTURES = [
  "sa_node",
  "atrial_pathways",
  "av_node",
  "his_bundle",
  "left_bundle_branch",
  "right_bundle_branch",
  "purkinje",
] as const;

export type ConductionStructure = (typeof CONDUCTION_STRUCTURES)[number];

/** Las cámaras de las que cuelga cada trayecto. Cada una es un grupo de la
 * escena con el pivote de su nodo y su misma fila de deformación. */
export const CONDUCTION_CHAMBERS = [
  "RightAtrium",
  "LeftAtrium",
  "RightVentricle",
  "LeftVentricle",
] as const;

export type ConductionChamber = (typeof CONDUCTION_CHAMBERS)[number];

export interface ConductionPathData {
  chamber: ConductionChamber;
  points: [number, number, number][];
  /** Posición del impulso a lo largo del recorrido de su estructura, de 0 a
   * 1. Ramas y Purkinje comparten escala: se recorren como un solo trayecto. */
  progress: number[];
}

export interface ConductionData {
  format_version: number;
  seed: number;
  purkinje_max_segments: number;
  didactic: ConductionStructure[];
  pivots: Record<ConductionChamber, [number, number, number]>;
  landmarks: {
    av_his_junction: [number, number, number];
    his_right_bundle_junction: [number, number, number];
  };
  junction_gap_mm: { av_his: number; his_right_bundle: number };
  cycle_points: [number, number][];
  structures: Record<
    ConductionStructure,
    { radius_mm: number; paths: ConductionPathData[] }
  >;
}

/** Los trayectos, tal como los escribe `docs/fase-h/build-conduction-paths.py`.
 * No se editan a mano: se regeneran, y el script los valida antes de
 * escribirlos. */
export const CONDUCTION_DATA = paths as unknown as ConductionData;

/** La ficha de cada estructura. Los textos son datos y no componentes: el
 * panel los pinta sin saber de qué estructura habla, y revisarlos —que es
 * tarea de alguien con criterio clínico, no de este código— no obliga a tocar
 * ningún `.tsx`.
 *
 * `didactic` dice que el trazado es un esquema: las vías auriculares y la red
 * de Purkinje no reconstruyen fibras reales. La interfaz tiene que decirlo
 * cada vez que las enseña, porque una animación convincente parece más exacta
 * de lo que es. */
export interface StructureInfo {
  label: string;
  color: number;
  didactic: boolean;
  summary: string;
  placement: string;
}

export const STRUCTURE_INFO: Record<ConductionStructure, StructureInfo> = {
  sa_node: {
    label: "Nodo sinoauricular",
    color: 0xffd23f,
    didactic: false,
    summary:
      "Marcapasos fisiológico. Su descarga no se ve en el ECG de superficie: la onda P empieza cuando el impulso ya ha salido a la aurícula.",
    placement:
      "En la unión de la vena cava superior con la aurícula derecha, cara anterolateral. Colocado sobre el modelo por la geometría de esa unión.",
  },
  atrial_pathways: {
    label: "Vías auriculares",
    color: 0xffb347,
    didactic: true,
    summary:
      "La activación de las aurículas produce la onda P: primero la derecha y después la izquierda, a la que llega por el haz de Bachmann.",
    placement:
      "Tres recorridos por la pared de la aurícula derecha hasta el nodo AV y uno hacia la aurícula izquierda. Esquema didáctico: no reconstruye fibras reales.",
  },
  av_node: {
    label: "Nodo auriculoventricular",
    color: 0xff8c42,
    didactic: false,
    summary:
      "Retrasa el impulso entre aurículas y ventrículos. Ese retraso ocupa la mayor parte del intervalo PR, y es donde se alarga en un bloqueo de primer grado.",
    placement:
      "En el tabique auriculoventricular, junto al anillo tricuspídeo. Colocado donde la aurícula derecha se acerca más al ventrículo izquierdo.",
  },
  his_bundle: {
    label: "Haz de His",
    color: 0xff5e5b,
    didactic: false,
    summary:
      "Única vía normal entre aurículas y ventrículos. Su activación no se ve en el ECG de superficie.",
    placement:
      "Del nodo AV a la parte alta del tabique interventricular. El modelo no trae tabique: el haz cruza por donde los dos ventrículos están más próximos.",
  },
  left_bundle_branch: {
    label: "Rama izquierda",
    color: 0xd65db1,
    didactic: false,
    summary:
      "Baja por la cara izquierda del tabique y se abre hacia los dos músculos papilares del ventrículo izquierdo.",
    placement:
      "Sobre el endocardio del ventrículo izquierdo, hacia los papilares que trae el modelo. El abanico de fascículos es un esquema.",
  },
  right_bundle_branch: {
    label: "Rama derecha",
    color: 0x845ec2,
    didactic: false,
    summary:
      "Baja por la cara derecha del tabique hacia el músculo papilar anterior del ventrículo derecho.",
    placement:
      "Sobre el endocardio del ventrículo derecho, hasta el papilar anterior que trae el modelo.",
  },
  purkinje: {
    label: "Red de Purkinje",
    color: 0x4ecdc4,
    didactic: true,
    summary:
      "Reparte el impulso por el endocardio de los dos ventrículos. Su activación precede inmediatamente al QRS.",
    placement:
      "Árbol generado con semilla fija sobre el endocardio de los dos ventrículos, lejos de los anillos valvulares. Esquema didáctico: no reconstruye fibras reales.",
  },
};

export const DIDACTIC_NOTICE =
  "Esquema didáctico: las vías auriculares, la red de Purkinje y el reparto temporal no reconstruyen fibras ni tiempos individuales.";

export function structureAt(index: number): ConductionStructure | null {
  return CONDUCTION_STRUCTURES[Math.round(index)] ?? null;
}
