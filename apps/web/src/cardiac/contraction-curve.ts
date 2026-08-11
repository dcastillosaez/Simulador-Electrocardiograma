import type { MechanicalEventPayload } from "../types/ws-messages";

/** Excursión de una contracción en el instante `tS`: 0 en reposo, `amplitude`
 * en el pico.
 *
 * La forma es un coseno alzado por tramos, no una interpolación lineal ni un
 * `smoothstep`: el coseno tiene derivada nula en los tres puntos de anclaje
 * (inicio, pico, final), así que la contracción arranca y se detiene sin
 * tirón. Con rampas lineales el ventrículo daría un golpe seco en el pico,
 * que es exactamente el aspecto de "animación de programador" que el spec
 * quiere evitar.
 *
 * La curva es presentación, no fisiología: cuándo y cuánto lo decide el
 * servidor (`MechanicalEvent`), y cómo transcurre entre esos puntos, este
 * fichero. Por eso vive en TypeScript y se evalúa 60 veces por segundo aquí,
 * sin viajar por la red. */
export function contractionExcursion(
  event: MechanicalEventPayload,
  tS: number
): number {
  if (tS <= event.t_start_s || tS >= event.t_end_s) {
    return 0;
  }

  if (tS <= event.t_peak_s) {
    const span = event.t_peak_s - event.t_start_s;
    if (span <= 0) return event.amplitude;
    const u = (tS - event.t_start_s) / span;
    return event.amplitude * 0.5 * (1 - Math.cos(Math.PI * u));
  }

  const span = event.t_end_s - event.t_peak_s;
  if (span <= 0) return 0;
  const v = (tS - event.t_peak_s) / span;
  return event.amplitude * 0.5 * (1 + Math.cos(Math.PI * v));
}
