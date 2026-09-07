import {
  VALVE_TRANSITION_S,
  ejectionAperture,
  fillingAperture,
  valvePulse,
} from "./valve-curve";
import type { ValveEventPayload } from "../types/ws-messages";

/** Las dos familias de válvulas, que se mueven en contrafase.
 *
 * No hay izquierda y derecha por separado, y por el mismo motivo que
 * `Chamber` en el motor no distingue ventrículo izquierdo de derecho: laten
 * juntas y con la misma temporización. La mitral y la tricúspide se cierran en
 * el mismo instante porque las cierra la misma sístole. El día que haya
 * disincronía —un bloqueo de rama, un marcapasos— se separan sin romper el
 * contrato, porque el consumidor ya lee un grupo y no un booleano. */
export type ValveGroup = "atrioventricular" | "semilunar";

/** Las cuatro fases del ciclo cardíaco, nombradas por lo que hacen las
 * válvulas. No es una taxonomía inventada para la interfaz: es la de cualquier
 * manual de fisiología, y las cuatro salen sin ambigüedad de los cuatro
 * instantes que manda el servidor. `null` cuando no hay ciclo — una
 * fibrilación ventricular no tiene fases porque no tiene sístole. */
export type ValvePhase =
  | "filling"
  | "isovolumetric-contraction"
  | "ejection"
  | "isovolumetric-relaxation";

/** Dónde queda cada familia cuando no hay sístole que la mueva.
 *
 * No es un valor por defecto elegido para rellenar: es la posición en la que
 * las deja la presión. Por eso una fibrilación ventricular —que no produce
 * ningún ciclo— enseña lo correcto sin que el cliente tenga un caso especial,
 * y por eso el panel de estado puede pintarse ya en su sitio antes de que
 * llegue el primer latido. */
export const RESTING_APERTURE: Record<ValveGroup, number> = {
  atrioventricular: 1,
  semilunar: 0,
};

/** Cola de ciclos valvulares, consultable por instante.
 *
 * Igual que `CardiacTimeline`, no tiene reloj: se le pregunta por un `tS` que
 * siempre viene de `FrameBuffer.playbackTimeS`. Esa es toda la sincronización
 * que hay con el trazado del ECG, y es la que hace que las válvulas y las
 * ondas no puedan separarse: en pausa las dos se congelan en el mismo
 * instante, y en un salto de reproducción las dos saltan igual.
 *
 * Sin React ni Three.js a propósito, como su hermana: es la parte de la
 * animación con lógica que merece un test, y así lo tiene sin WebGL. */
export class ValveTimeline {
  private events: ValveEventPayload[] = [];
  private readonly seen = new Set<number>();

  get size(): number {
    return this.events.length;
  }

  /** Añade ciclos, descartando los ya conocidos.
   *
   * La deduplicación es por índice de latido, que es estable, y no por
   * instante: los mensajes se solapan en el tiempo y el mismo latido llega más
   * de una vez, pero sus flotantes redondeados no son una clave con la que uno
   * quiera comparar por igualdad. */
  push(incoming: readonly ValveEventPayload[]): void {
    for (const event of incoming) {
      if (this.seen.has(event.index)) continue;
      this.seen.add(event.index);
      this.events.push(event);
    }
  }

  /** Apertura de un grupo de válvulas en `tS`, de 0 (cerrada) a 1 (abierta).
   *
   * En reposo las auriculoventriculares están **abiertas** y las sigmoideas
   * **cerradas**: es la posición a la que las deja la presión cuando no hay
   * sístole que las mueva. Por eso el valor sin eventos no es cero para las
   * dos, y por eso una fibrilación ventricular —que no produce ningún ciclo—
   * enseña lo que corresponde sin que el cliente tenga un caso especial.
   *
   * Se toma el máximo de los ciclos vigentes en vez de sumarlos: dos ciclos
   * solapados no son fisiológicos, pero en una taquicardia extrema la
   * relajación isovolumétrica de un latido cae dentro de la sístole del
   * siguiente, y sumar daría un valor mayor que uno justo donde la válvula
   * está más quieta. Con el máximo, dos ventanas contiguas se funden en una. */
  apertureAt(group: ValveGroup, tS: number, drive = 0): number {
    let pulse = 0;
    for (const event of this.events) {
      pulse = Math.max(
        pulse,
        group === "atrioventricular"
          ? // Para las auriculoventriculares el pulso mide lo cerradas que
            // están: sube al empezar la sístole y no baja hasta que la
            // relajación isovolumétrica termina.
            valvePulse(tS, event.t_close_av_s, event.t_open_av_s)
          : valvePulse(tS, event.t_open_semilunar_s, event.t_close_semilunar_s)
      );
    }
    // Ni abierta ni cerrada son un estado plano, y por eso la apertura no es
    // el pulso a secas. Una válvula abierta de par en par toda su mitad del
    // ciclo es lo que hace que una animación se vea de dos estados: en el
    // corazón de verdad las dos parejas empiezan a cerrarse solas en cuanto
    // decae el gradiente que las abrió.
    // `drive` significa una cosa distinta para cada pareja, y las dos vienen
    // del servidor: para las auriculoventriculares es la sístole auricular que
    // levanta la onda A; para las sigmoideas, el caudal que las mantiene
    // separadas. Ninguna de las dos se inventa aquí.
    if (group !== "atrioventricular") {
      return pulse * ejectionAperture(drive);
    }
    // La transición se descuenta porque el llenado no empieza a decaer hasta
    // que la válvula termina de abrirse: contarlo desde el flanco dejaría el
    // pico E recortado un quinto y la curva en M sin su punta.
    //
    // Sin ninguna apertura por detrás no hay curva de llenado que seguir: o no
    // ha latido todavía, o el ritmo no produce ciclos. Ahí la válvula se queda
    // abierta, que es donde la deja la presión cuando nada la mueve.
    const since = this.sinceOpenAt(tS) - VALVE_TRANSITION_S;
    const filling = Number.isFinite(since) ? fillingAperture(since, drive) : 1;
    return (1 - pulse) * filling;
  }

  /** Segundos desde que las auriculoventriculares se abrieron por última vez.
   *
   * Infinito cuando no hay ninguna apertura por detrás: ni ha latido todavía
   * ni el ritmo produce ciclos, así que no hay curva de llenado que seguir y
   * quien pregunta se queda con la posición de reposo. */
  sinceOpenAt(tS: number): number {
    let latest = -Infinity;
    for (const event of this.events) {
      if (event.t_open_av_s <= tS && event.t_open_av_s > latest) {
        latest = event.t_open_av_s;
      }
    }
    return latest === -Infinity ? Infinity : tS - latest;
  }

  /** En qué fase del ciclo cardíaco cae `tS`.
   *
   * Se lee de los instantes y no de las aperturas: con dos válvulas cerradas
   * no se puede saber si el ventrículo se está contrayendo o relajándose —las
   * dos fases isovolumétricas tienen exactamente la misma imagen— y es
   * justamente esa distinción la que hace que nombrarlas enseñe algo.
   *
   * Fuera de cualquier ciclo la respuesta es el llenado, que es lo que ocurre
   * entre dos latidos. Sin ningún ciclo en la cola es `null`: no es que el
   * corazón se esté llenando, es que no hay sístole que contar. */
  phaseAt(tS: number): ValvePhase | null {
    for (const event of this.events) {
      if (tS < event.t_close_av_s || tS >= event.t_open_av_s) continue;
      if (tS < event.t_open_semilunar_s) return "isovolumetric-contraction";
      if (tS < event.t_close_semilunar_s) return "ejection";
      return "isovolumetric-relaxation";
    }
    return this.events.length > 0 ? "filling" : null;
  }

  /** Descarta los ciclos que ya no pueden influir en `tS`.
   *
   * Sin esto, una guardia de ocho horas a 72 lpm acumularía del orden de
   * 35.000 ciclos que `apertureAt` recorrería sesenta veces por segundo, dos
   * veces por fotograma.
   *
   * El margen del último flanco va incluido en la condición y no se deja al
   * que llama: el instante en que la auriculoventricular *empieza* a abrirse
   * es el último del ciclo, pero el movimiento dura una transición más, y
   * podar justo ahí haría que la válvula terminara de abrirse de golpe. */
  prune(tS: number): void {
    this.events = this.events.filter(
      (event) => event.t_open_av_s + VALVE_TRANSITION_S >= tS
    );
  }

  clear(): void {
    this.events = [];
    this.seen.clear();
  }
}
