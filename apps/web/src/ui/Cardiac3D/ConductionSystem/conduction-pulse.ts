import {
  createSegmentWindow,
  type ElectricalTimeline,
} from "../../../cardiac/electrical-timeline";
import type { ElectricalStructureName } from "../../../types/ws-messages";
import { CONDUCTION_STRUCTURES, type ConductionStructure } from "./conduction-structures";
import type { ConductionUniforms } from "./conduction-material";

/** Qué tramos del servidor mueven el pulso de cada estructura dibujada.
 *
 * Es una tabla de anatomía, no de ritmos: ninguna fila pregunta por un
 * `rhythm_id`. Que en una TSV no se encienda el nodo sinusal, o que en una TV
 * el His se quede apagado, sale de que el servidor no manda esos tramos.
 *
 * Las vías auriculares se recorren durante la activación de las dos
 * aurículas. Ramas y Purkinje comparten tramo: el reparto del tiempo entre
 * ellas no tiene fuente, y la geometría las mide con la misma escala para que
 * el frente pase de unas a otra sin salto. */
export const ELECTRICAL_DRIVE: Record<ConductionStructure, readonly ElectricalStructureName[]> = {
  sa_node: ["sa_node"],
  atrial_pathways: ["right_atrium", "left_atrium"],
  av_node: ["av_node"],
  his_bundle: ["his_bundle"],
  left_bundle_branch: ["bundle_branches", "purkinje"],
  right_bundle_branch: ["bundle_branches", "purkinje"],
  purkinje: ["bundle_branches", "purkinje"],
};

/** Cuánto tarda en apagarse una estructura después de que el impulso la deja
 * atrás. Es presentación —cómo se ve el viaje—, no fisiología: el instante en
 * que el impulso termina el tramo lo manda el servidor. */
export const GLOW_DECAY_S = 0.15;

/** Por debajo de este brillo la estructura se da por apagada. */
const GLOW_FLOOR = 0.02;

const scratch = createSegmentWindow();

/** Escribe en los uniformes del pulso el estado eléctrico en `tS`.
 *
 * Función pura del instante: no lee el fotograma anterior ni acumula nada, así
 * que el repaso hacia atrás o a otra velocidad da exactamente la misma imagen
 * para el mismo `tS`. */
export function writePulseUniforms(
  timeline: ElectricalTimeline,
  tS: number,
  uniforms: ConductionUniforms
): void {
  const front = uniforms.uFront.value;
  const glow = uniforms.uGlow.value;
  CONDUCTION_STRUCTURES.forEach((structure, index) => {
    const window = timeline.windowAt(ELECTRICAL_DRIVE[structure], tS, scratch);
    if (!window.found) {
      front[index] = -1;
      glow[index] = 0;
      return;
    }
    const span = window.endS - window.startS;
    if (tS <= window.endS && span > 0) {
      front[index] = (tS - window.startS) / span;
      glow[index] = 1;
      return;
    }
    // Recorrido entero (o una marca de duración cero): el frente se queda al
    // final y el brillo cae.
    const fading = Math.exp(-(tS - window.endS) / GLOW_DECAY_S);
    if (fading < GLOW_FLOOR) {
      front[index] = -1;
      glow[index] = 0;
      return;
    }
    front[index] = 1;
    glow[index] = fading;
  });
}
