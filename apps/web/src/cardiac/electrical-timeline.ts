import type {
  ElectricalImpulsePayload,
  ElectricalStructureName,
} from "../types/ws-messages";

/** Lo que devuelve una consulta de ventana. Se escribe en un objeto que
 * reserva quien pregunta: la consulta corre en el bucle de dibujo varias veces
 * por fotograma y no puede ir dejando objetos detrás. */
export interface SegmentWindow {
  /** Si hay algún tramo de esas estructuras que haya empezado en `tS`. */
  found: boolean;
  startS: number;
  endS: number;
  /** El impulso al que pertenece se quedó en el nodo AV. */
  blocked: boolean;
}

export function createSegmentWindow(): SegmentWindow {
  return { found: false, startS: 0, endS: 0, blocked: false };
}

interface StoredImpulse extends ElectricalImpulsePayload {
  key: string;
  epoch: number;
  firstS: number;
  lastS: number;
}

/** Cola de impulsos eléctricos, consultable por instante.
 *
 * Es la tercera línea temporal, con el patrón de `CardiacTimeline` y
 * `ValveTimeline`: sin reloj, se le pregunta por un `tS` que siempre viene de
 * la misma cabeza de reproducción que mueve el trazado. Por eso el estado
 * eléctrico es función pura del tiempo: el mismo instante da la misma
 * respuesta llegue quien llegue a él, desde delante, desde detrás o a
 * cualquier velocidad.
 *
 * Sin React ni Three.js, como sus hermanas: es la parte con lógica, y así se
 * prueba sin WebGL. */
export class ElectricalTimeline {
  private impulses: StoredImpulse[] = [];
  private seen = new Set<string>();
  private currentEpoch: number | null = null;

  get size(): number {
    return this.impulses.length;
  }

  /** Añade impulsos, descartando los ya conocidos.
   *
   * La clave lleva la época, el origen y el número. La época por lo mismo que
   * en las contracciones: una fuente reconstruida vuelve a numerar desde 0. El
   * origen porque las P y el escape de un bloqueo completo son dos trenes con
   * su propia cuenta, y el impulso 3 de cada uno son dos impulsos.
   *
   * Al llegar una época nueva se descartan los impulsos de las anteriores que
   * empezaban después de ella: el servidor publica la electricidad con algo de
   * adelanto, y lo que la fuente vieja anunció para después de reconstruirse
   * no va a ocurrir. Dejarlo sería un impulso huérfano recorriendo un corazón
   * que ya late con otro ritmo. */
  push(incoming: readonly ElectricalImpulsePayload[], epoch = 0): void {
    if (this.currentEpoch !== null && epoch !== this.currentEpoch) {
      this.impulses = this.impulses.filter(
        (impulse) => impulse.epoch === epoch || impulse.firstS < epoch
      );
      this.seen = new Set(this.impulses.map((impulse) => impulse.key));
    }
    this.currentEpoch = epoch;

    for (const impulse of incoming) {
      if (impulse.segments.length === 0) continue;
      const key = `${epoch}:${impulse.origin}:${impulse.impulse}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      let firstS = Infinity;
      let lastS = -Infinity;
      for (const segment of impulse.segments) {
        firstS = Math.min(firstS, segment.t_start_s);
        lastS = Math.max(lastS, segment.t_end_s);
      }
      this.impulses.push({ ...impulse, key, epoch, firstS, lastS });
    }
    // Ordenados por inicio: la consulta recorre de atrás adelante y para en
    // cuanto encuentra el último que ya ha empezado.
    this.impulses.sort((a, b) => a.firstS - b.firstS);
  }

  /** El tramo más reciente de estas estructuras que haya empezado en `tS`.
   *
   * Si un impulso tiene varios tramos de la lista —las dos aurículas, o ramas
   * y Purkinje— se toma su unión. Gana el impulso cuya ventana empezó más
   * tarde sin pasarse de `tS`: es el que el ojo está siguiendo. */
  windowAt(
    structures: readonly ElectricalStructureName[],
    tS: number,
    out: SegmentWindow
  ): SegmentWindow {
    out.found = false;
    out.startS = 0;
    out.endS = 0;
    out.blocked = false;
    for (let i = this.impulses.length - 1; i >= 0; i -= 1) {
      const impulse = this.impulses[i];
      if (impulse.firstS > tS) continue;
      let start = Infinity;
      let end = -Infinity;
      for (const segment of impulse.segments) {
        if (!structures.includes(segment.structure)) continue;
        if (segment.t_start_s < start) start = segment.t_start_s;
        if (segment.t_end_s > end) end = segment.t_end_s;
      }
      if (start === Infinity || start > tS) continue;
      if (!out.found || start > out.startS) {
        out.found = true;
        out.startS = start;
        out.endS = end;
        out.blocked = impulse.outcome === "blocked";
      }
    }
    return out;
  }

  /** Los impulsos que tocan la ventana `[t0S, t1S]`, en orden. Para dibujar
   * fuera del camino caliente —el diagrama en escalera—; devuelve los objetos
   * guardados, que no se deben modificar. */
  impulsesBetween(t0S: number, t1S: number): readonly ElectricalImpulsePayload[] {
    return this.impulses.filter((impulse) => impulse.lastS >= t0S && impulse.firstS <= t1S);
  }

  /** El siguiente límite de tramo después de `tS` (o el anterior, con
   * `direction` negativa). Es lo que usa el paso a paso del repaso: saltar al
   * próximo instante en que algo empieza o termina. `null` si no hay. */
  boundaryFrom(tS: number, direction: 1 | -1): number | null {
    const EPSILON = 1e-4;
    let best: number | null = null;
    for (const impulse of this.impulses) {
      for (const segment of impulse.segments) {
        for (const edge of [segment.t_start_s, segment.t_end_s]) {
          if (direction > 0 ? edge > tS + EPSILON : edge < tS - EPSILON) {
            if (best === null || (direction > 0 ? edge < best : edge > best)) {
              best = edge;
            }
          }
        }
      }
    }
    return best;
  }

  /** Descarta lo que terminó antes de `tS`.
   *
   * En el directo `tS` va por detrás de la cabeza; en el repaso, la poda se
   * hace contra la cabeza del directo y no contra el cursor, que puede ir
   * hacia atrás (ver `HeartModel`). */
  prune(tS: number): void {
    this.impulses = this.impulses.filter((impulse) => impulse.lastS >= tS);
    this.seen = new Set(this.impulses.map((impulse) => impulse.key));
  }

  clear(): void {
    this.impulses = [];
    this.seen.clear();
    this.currentEpoch = null;
  }
}
