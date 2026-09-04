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
 * Idempotente por construcción: los pesos se escriben desde la apertura, nunca
 * acumulando sobre el anterior. La pose cerrada es siempre el cero, así que
 * ningún error de redondeo puede ir dejando la válvula cada vez más
 * entreabierta a lo largo de una guardia.
 *
 * El acotado a [0, 1] no es defensivo por gusto: fuera de ese intervalo la
 * GPU extrapola el desplazamiento, y una valva con peso 1,2 atraviesa la pared
 * del ventrículo.
 *
 * Son DOS pesos y no uno. El primero es el recorrido: cero cerrada, uno
 * abierta. El segundo es la comba, y existe porque la GPU interpola en línea
 * recta entre las poses que le damos: una valva mitral recorre unos cien
 * grados entre cerrada y abierta, y la cuerda de un arco de cien grados se
 * mete un 38% por dentro. Sin corregirlo, el velo se acortaba esa barbaridad a
 * media apertura y se veía encogerse y volver a crecer en cada latido. El
 * `4a(1−a)` vale cero en los dos extremos y uno en el medio, que es justo
 * donde la cuerda más se aparta del arco. */
export function applyAperture(nodes: ValveNodes, apertures: Apertures): void {
  for (const name of VALVE_LEAFLET_NAMES) {
    const group = HEART_VALVES[VALVE_OF_LEAFLET[name]].group;
    const influences = nodes[name].morphTargetInfluences;
    if (influences === undefined) continue;
    const aperture = Math.min(1, Math.max(0, apertures[group]));
    influences[0] = aperture;
    if (influences.length > 1) influences[1] = 4 * aperture * (1 - aperture);
  }
}
