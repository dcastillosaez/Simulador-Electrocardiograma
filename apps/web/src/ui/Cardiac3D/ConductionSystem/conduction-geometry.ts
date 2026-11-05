import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MM_PER_UNIT } from "../heart-scale";
import {
  CONDUCTION_CHAMBERS,
  CONDUCTION_STRUCTURES,
  type ConductionChamber,
  type ConductionData,
} from "./conduction-structures";

/** Lados de cada tubo. Seis es lo que el script de generación valida —el
 * anillo de seis puntos alrededor del eje—, y un tubo de medio milímetro no
 * gana nada redondeándolo más. */
export const TUBE_SIDES = 6;

/** Tramos de curva por cada punto del trayecto. Los puntos vienen cada
 * milímetro y la Catmull-Rom apenas se separa de la poligonal entre ellos:
 * más tramos serían triángulos sin efecto visible. */
const SEGMENTS_PER_POINT = 1;

/** Nombre de los dos atributos que añade la conducción a sus vértices. Los lee
 * el sombreador del pulso; se exportan para que nadie los escriba a mano en
 * dos sitios. */
export const PROGRESS_ATTRIBUTE = "aProgress";
export const STRUCTURE_ATTRIBUTE = "aStructure";

/** Interpola el progreso del pulso en la fracción de longitud `u` del
 * trayecto. `TubeGeometry` coloca sus anillos uniformes en longitud de arco,
 * así que el progreso se reparte igual. */
function progressAt(arc: number[], progress: number[], u: number): number {
  const total = arc[arc.length - 1];
  const target = u * total;
  for (let i = 1; i < arc.length; i += 1) {
    if (arc[i] >= target) {
      const span = arc[i] - arc[i - 1];
      const t = span > 0 ? (target - arc[i - 1]) / span : 0;
      return progress[i - 1] + t * (progress[i] - progress[i - 1]);
    }
  }
  return progress[progress.length - 1];
}

/** Construye un `BufferGeometry` por cámara con todos los tubos que cuelgan de
 * ella, fundidos en uno.
 *
 * Fundirlos no es una optimización prematura: la red de Purkinje son más de
 * cien trayectos, y un tubo por malla serían cien llamadas de dibujo por
 * fotograma para algo que se mueve como un solo objeto. Con cuatro mallas la
 * capa entera cuesta cuatro.
 *
 * Los vértices quedan relativos al pivote de su cámara, que es la posición del
 * nodo en el `.glb`: el grupo que los contiene se coloca en ese pivote y
 * recibe la misma escala que la cámara, así que la conducción se deforma con
 * ella exactamente. Se construye una vez, al cargar el modelo; nada de esto
 * corre durante la reproducción. */
export function buildConductionGeometries(
  data: ConductionData,
  pivots: Record<ConductionChamber, Vector3>
): Record<ConductionChamber, BufferGeometry | null> {
  const parts: Record<ConductionChamber, BufferGeometry[]> = {
    RightAtrium: [],
    LeftAtrium: [],
    RightVentricle: [],
    LeftVentricle: [],
  };

  CONDUCTION_STRUCTURES.forEach((structure, structureIndex) => {
    const entry = data.structures[structure];
    const radius = entry.radius_mm / MM_PER_UNIT;
    for (const path of entry.paths) {
      if (path.points.length < 2) continue;
      const pivot = pivots[path.chamber];
      const points = path.points.map(
        ([x, y, z]) => new Vector3(x - pivot.x, y - pivot.y, z - pivot.z)
      );
      const curve = new CatmullRomCurve3(points);
      const segments = Math.max(2, (points.length - 1) * SEGMENTS_PER_POINT);
      const tube = new TubeGeometry(curve, segments, radius, TUBE_SIDES, false);

      const arc = [0];
      for (let i = 1; i < points.length; i += 1) {
        arc.push(arc[i - 1] + points[i].distanceTo(points[i - 1]));
      }
      const ringSize = TUBE_SIDES + 1;
      const count = tube.getAttribute("position").count;
      const progress = new Float32Array(count);
      const structureIds = new Float32Array(count).fill(structureIndex);
      for (let ring = 0; ring <= segments; ring += 1) {
        const value = progressAt(arc, path.progress, ring / segments);
        progress.fill(value, ring * ringSize, (ring + 1) * ringSize);
      }
      tube.setAttribute(PROGRESS_ATTRIBUTE, new BufferAttribute(progress, 1));
      tube.setAttribute(STRUCTURE_ATTRIBUTE, new BufferAttribute(structureIds, 1));
      parts[path.chamber].push(tube);
    }
  });

  const result = {} as Record<ConductionChamber, BufferGeometry | null>;
  for (const chamber of CONDUCTION_CHAMBERS) {
    const tubes = parts[chamber];
    if (tubes.length === 0) {
      result[chamber] = null;
      continue;
    }
    const merged = mergeGeometries(tubes, false);
    for (const tube of tubes) tube.dispose();
    if (merged === null) {
      throw new Error(`No se pudieron fundir los tubos de ${chamber}`);
    }
    merged.computeBoundingSphere();
    result[chamber] = merged;
  }
  return result;
}
