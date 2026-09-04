import type { ValveGroup } from "../../cardiac/valve-timeline";
import {
  HEART_VALVES,
  VALVE_LEAFLET_NAMES,
  VALVE_OF_LEAFLET,
  type ValveNodes,
} from "./heart-valves";

export type Apertures = Record<ValveGroup, number>;

/** Escribe la apertura en las once valvas.
 *
 * Muta a propósito, como `applyExcursion`: corre en cada fotograma y asignar
 * once números es más barato que construir objetos.
 *
 * Idempotente por construcción: el peso se escribe desde la apertura, nunca
 * acumulando sobre el anterior. La pose de la fuente —la válvula cerrada— es
 * siempre el cero, así que ningún error de redondeo puede ir dejando la
 * válvula cada vez más entreabierta a lo largo de una guardia.
 *
 * El acotado a [0, 1] no es defensivo por gusto: fuera de ese intervalo la
 * GPU extrapola el desplazamiento, y una valva con peso 1,2 atraviesa la pared
 * del ventrículo. */
export function applyAperture(nodes: ValveNodes, apertures: Apertures): void {
  for (const name of VALVE_LEAFLET_NAMES) {
    const group = HEART_VALVES[VALVE_OF_LEAFLET[name]].group;
    const influences = nodes[name].morphTargetInfluences;
    if (influences === undefined) continue;
    influences[0] = Math.min(1, Math.max(0, apertures[group]));
  }
}
