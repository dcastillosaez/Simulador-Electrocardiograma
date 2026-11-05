import {
  createSegmentWindow,
  type ElectricalTimeline,
} from "./electrical-timeline";
import type { ElectricalStructureName } from "../types/ws-messages";

/** Las fases del trazado que la secuencia eléctrica explica. Son las del ECG
 * y no las del ciclo mecánico: P, el segmento que forma el PR después de la P,
 * QRS y T. */
export type ElectricalPhase = "P" | "PR" | "QRS" | "T";

export interface PhaseWindow {
  phase: ElectricalPhase;
  startS: number;
  endS: number;
}

/** Qué tramos componen cada fase. Tabla de electrofisiología, no de ritmos. */
const PHASES: readonly { phase: ElectricalPhase; structures: readonly ElectricalStructureName[] }[] = [
  { phase: "QRS", structures: ["ventricular_myocardium"] },
  { phase: "PR", structures: ["av_node", "his_bundle", "bundle_branches", "purkinje"] },
  { phase: "P", structures: ["right_atrium", "left_atrium"] },
  { phase: "T", structures: ["ventricular_recovery"] },
];

const scratch = createSegmentWindow();

/** La fase eléctrica en curso en `tS`, o `null` entre latidos.
 *
 * Se mira en orden QRS, PR, P, T porque en las taquicardias se solapan: la P
 * de un latido cae dentro de la T del anterior, y lo que se está activando en
 * ese instante es la aurícula, no la recuperación. */
export function phaseAt(timeline: ElectricalTimeline, tS: number): PhaseWindow | null {
  for (const { phase, structures } of PHASES) {
    const window = timeline.windowAt(structures, tS, scratch);
    if (window.found && tS <= window.endS && window.endS > window.startS) {
      return { phase, startS: window.startS, endS: window.endS };
    }
  }
  return null;
}

/** Rótulo de cada fase para la interfaz: qué se activa en ella. */
export const PHASE_DESCRIPTION: Record<ElectricalPhase, string> = {
  P: "Onda P: activación de las aurículas",
  PR: "Segmento PR: nodo AV, haz de His, ramas y Purkinje",
  QRS: "QRS: activación de los ventrículos",
  T: "Onda T: recuperación ventricular",
};
