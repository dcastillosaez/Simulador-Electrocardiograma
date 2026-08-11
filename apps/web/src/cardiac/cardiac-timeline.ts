import { contractionExcursion } from "./contraction-curve";
import type { MechanicalEventPayload } from "../types/ws-messages";

export type ChamberName = MechanicalEventPayload["chamber"];

/** Cola de contracciones pendientes y en curso, consultable por instante.
 *
 * No tiene reloj: se le pregunta por un `tS` que siempre viene de
 * `FrameBuffer.playbackTimeS`. Esa es toda la sincronización que hay, y es
 * suficiente: si la reproducción se congela, las consultas se repiten con el
 * mismo `tS` y el corazón se queda donde estaba.
 *
 * Sin React ni Three.js a propósito: es la única parte de la animación con
 * lógica que merezca un test, y así lo tiene sin necesitar WebGL. */
export class CardiacTimeline {
  private events: MechanicalEventPayload[] = [];
  private readonly seen = new Set<string>();

  get size(): number {
    return this.events.length;
  }

  /** Añade contracciones, descartando las ya conocidas.
   *
   * La deduplicación es por cámara e índice y no por instante: el índice del
   * evento eléctrico es estable y el instante es un flotante redondeado, que
   * no es una clave con la que uno quiera comparar por igualdad. */
  push(incoming: readonly MechanicalEventPayload[]): void {
    for (const event of incoming) {
      const key = `${event.chamber}:${event.index}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.events.push(event);
    }
  }

  /** Excursión total de una cámara en `tS`, acotada a [0, 1].
   *
   * Se suman los eventos vigentes en vez de tomar el primero: dos
   * contracciones solapadas no son fisiológicas, pero si el catálogo
   * llegara a producirlas, quedarse con una daría un salto en el trazo del
   * movimiento. El acotado impide que la suma se dispare. */
  excursionAt(chamber: ChamberName, tS: number): number {
    let total = 0;
    for (const event of this.events) {
      if (event.chamber !== chamber) continue;
      if (tS <= event.t_start_s || tS >= event.t_end_s) continue;
      total += contractionExcursion(event, tS);
    }
    return Math.min(1, total);
  }

  /** Descarta lo que terminó antes de `tS`.
   *
   * Sin esto, una guardia de ocho horas a 72 lpm acumularía del orden de
   * 70.000 eventos que `excursionAt` recorrería sesenta veces por segundo. */
  prune(tS: number): void {
    this.events = this.events.filter((event) => event.t_end_s >= tS);
  }

  clear(): void {
    this.events = [];
    this.seen.clear();
  }
}
