import { REFERENCE_PAPER_SPEED_MM_S } from "../render/layout-engine";

/** Velocidades de un electrocardiógrafo. Escalones y no una escala continua:
 * el número que aparece en pantalla tiene que ser uno que el alumno reconozca
 * cuando se ponga delante de una máquina. */
export const PAPER_SPEEDS_MM_S = [25, 50, 100] as const;

export function nextPaperSpeed(current: number, direction: 1 | -1): number {
  const index = PAPER_SPEEDS_MM_S.indexOf(current as (typeof PAPER_SPEEDS_MM_S)[number]);
  const from = index < 0 ? 0 : index;
  const next = Math.min(PAPER_SPEEDS_MM_S.length - 1, Math.max(0, from + direction));
  return PAPER_SPEEDS_MM_S[next];
}

/** Dónde puede empezar la ventana visible.
 *
 * El anillo no cambia de tamaño al hacer zoom: se enseña un trozo. El límite
 * superior es lo escrito, no la capacidad — la zona que nunca se ha escrito
 * pintaría una línea plana que parece señal. */
export function clampStart(
  start: number,
  visibleSamples: number,
  capacity: number,
  writtenCount: number
): number {
  const available = Math.min(capacity, writtenCount);
  const maxStart = Math.max(0, available - visibleSamples);
  return Math.min(maxStart, Math.max(0, Math.round(start)));
}

export function isReferenceSpeed(paperSpeedMmS: number): boolean {
  return paperSpeedMmS === REFERENCE_PAPER_SPEED_MM_S;
}
