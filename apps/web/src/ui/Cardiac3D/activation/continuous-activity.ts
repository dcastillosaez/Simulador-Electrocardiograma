import type { HeartStateValues } from "../../../cardiac/heart-state-timeline";
import type { ContractionModeName } from "../../../types/ws-messages";
import { CONDUCTION_STRUCTURES, type ConductionStructure } from "../ConductionSystem/conduction-structures";
import type { ConductionUniforms } from "../ConductionSystem/conduction-material";
import { TISSUES, type TissueUniforms } from "./tissue-activation";

/** La actividad que no viene en impulsos: un circuito de flutter o una
 * fibrilación. El servidor no la manda como tramos —no hay instantes que
 * mandar— sino como el modo de cada cámara y su frecuencia en `heart_state`.
 * Aquí se convierte en lo que se ve, como función del tiempo y nada más: el
 * mismo `tS` da la misma imagen, así que el repaso la reproduce exactamente.
 *
 * Lo caótico de una fibrilación sale de un generador con semilla fija sobre el
 * tiempo, no de `Math.random()`: un repaso que enseñara otra fibrilación cada
 * vez no sería un repaso. */

export const CONTINUOUS_MODE = { none: 0, circuit: 1, chaotic: 2 } as const;

export function continuousModeOf(mode: ContractionModeName | undefined): number {
  if (mode === "fluttering") return CONTINUOUS_MODE.circuit;
  if (mode === "fibrillating") return CONTINUOUS_MODE.chaotic;
  return CONTINUOUS_MODE.none;
}

/** Cada cuánto cambia el dibujo caótico de la conducción. Presentación: una
 * fibrilación no tiene periodo, pero un parpadeo a 60 Hz no se lee. */
const CHAOTIC_STEP_S = 0.045;

/** Semilla fija del caos. */
const SEED = 0x5eed;

/** Un número entre 0 y 1 a partir de dos enteros, determinista. Mezcla de
 * enteros de 32 bits; no es criptografía, es que dos llamadas iguales den lo
 * mismo. */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + SEED, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ATRIAL_STRUCTURES: readonly ConductionStructure[] = ["atrial_pathways"];
const VENTRICULAR_STRUCTURES: readonly ConductionStructure[] = [
  "his_bundle",
  "left_bundle_branch",
  "right_bundle_branch",
  "purkinje",
];

function writeConduction(
  structures: readonly ConductionStructure[],
  mode: number,
  hz: number,
  tS: number,
  uniforms: ConductionUniforms
): void {
  if (mode === CONTINUOUS_MODE.none) return;
  for (const structure of structures) {
    const index = CONDUCTION_STRUCTURES.indexOf(structure);
    if (mode === CONTINUOUS_MODE.circuit) {
      // El circuito da vueltas a la frecuencia del flutter: el frente recorre
      // las vías auriculares de punta a punta en cada vuelta.
      const phase = tS * hz;
      uniforms.uFront.value[index] = phase - Math.floor(phase);
      uniforms.uGlow.value[index] = 1;
    } else {
      const step = Math.floor(tS / CHAOTIC_STEP_S);
      uniforms.uFront.value[index] = hash01(step, index);
      uniforms.uGlow.value[index] = 0.35 + 0.5 * hash01(step, index + 101);
    }
  }
}

/** Escribe la actividad continua sobre los uniformes del pulso y del tejido.
 *
 * Va después de `writePulseUniforms` y `writeTissueUniforms`: en una cámara
 * que fibrila o hace flutter el servidor no manda tramos, así que no pisa nada
 * que hayan escrito ellos. El modo sale del estado vigente en `tS`; ninguna
 * línea pregunta qué ritmo es. */
export function writeContinuousActivity(
  state: HeartStateValues | null,
  tS: number,
  conduction: ConductionUniforms,
  tissue: TissueUniforms
): void {
  const atrial = continuousModeOf(state?.atrial_mode);
  const ventricular = continuousModeOf(state?.ventricular_mode);
  const hz = state?.flutter_hz ?? 0;
  writeConduction(ATRIAL_STRUCTURES, atrial, hz, tS, conduction);
  writeConduction(VENTRICULAR_STRUCTURES, ventricular, hz, tS, conduction);

  TISSUES.forEach((name, index) => {
    const mode = name === "ventricular_myocardium" ? ventricular : atrial;
    const out = tissue.uContinuous.value[index];
    if (mode === CONTINUOUS_MODE.none) {
      out.set(0, 0, 0, 0);
      return;
    }
    // La fase va reducida a [0, 1) en el circuito y a un tiempo acotado en el
    // caos: en coma flotante de 32 bits, un tiempo de horas perdería la
    // resolución de milisegundos dentro del sombreador.
    const phase = mode === CONTINUOUS_MODE.circuit ? tS * hz - Math.floor(tS * hz) : tS % 600;
    out.set(mode, phase, hz, 0);
  });
}
