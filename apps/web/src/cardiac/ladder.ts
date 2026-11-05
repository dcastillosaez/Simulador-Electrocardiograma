import type {
  ElectricalImpulsePayload,
  ElectricalStructureName,
  ImpulseOriginName,
} from "../types/ws-messages";

/** Las tres filas del diagrama en escalera clásico: aurícula, unión
 * auriculoventricular (nodo AV y His-Purkinje) y ventrículo. */
export type LadderRow = "A" | "AV" | "V";

export const LADDER_ROWS: readonly LadderRow[] = ["A", "AV", "V"];

const ROW_STRUCTURES: Record<LadderRow, readonly ElectricalStructureName[]> = {
  A: ["sa_node", "right_atrium", "left_atrium"],
  AV: ["av_node", "his_bundle", "bundle_branches", "purkinje"],
  V: ["ventricular_myocardium"],
};

export interface LadderBar {
  row: LadderRow;
  /** Segundos desde el inicio de la ventana. */
  startS: number;
  endS: number;
  origin: ImpulseOriginName;
  /** El impulso se detuvo en el nodo AV. */
  blocked: boolean;
}

export interface LadderDiagram {
  spanS: number;
  bars: LadderBar[];
}

/** Convierte los impulsos de una ventana en las barras del diagrama.
 *
 * Es la forma en que se enseña la conducción en una pizarra: cada impulso es
 * una línea que baja de la aurícula al ventrículo, y un bloqueo es una línea
 * que se queda a mitad. Sale entero de los tramos que manda el servidor —sin
 * preguntar qué ritmo es—, así que dos diagramas de dos ritmos distintos se
 * pueden poner uno encima del otro y compararse tal cual. */
export function ladderOf(
  impulses: readonly ElectricalImpulsePayload[],
  t0S: number,
  t1S: number
): LadderDiagram {
  const bars: LadderBar[] = [];
  for (const impulse of impulses) {
    for (const row of LADDER_ROWS) {
      let start = Infinity;
      let end = -Infinity;
      for (const segment of impulse.segments) {
        if (!ROW_STRUCTURES[row].includes(segment.structure)) continue;
        start = Math.min(start, segment.t_start_s);
        end = Math.max(end, segment.t_end_s);
      }
      if (start === Infinity || end < t0S || start > t1S) continue;
      bars.push({
        row,
        startS: Math.max(0, start - t0S),
        endS: Math.min(t1S, end) - t0S,
        origin: impulse.origin,
        blocked: impulse.outcome === "blocked",
      });
    }
  }
  return { spanS: t1S - t0S, bars };
}
