import type { CardiacTimeline, ChamberName } from "../../cardiac/cardiac-timeline";
import { tremorExcursion } from "../../cardiac/tremor";
import type { HeartStateValues } from "./useCardiacTimeline";

/** Cuánto se ha contraído una cámara en `tS`, de 0 a 1.
 *
 * Contracción organizada y temblor son excluyentes por cámara, y quien decide
 * cuál toca es el servidor: una cámara que fibrila no manda eventos, así que
 * consultar la timeline devolvería cero y el corazón se quedaría quieto en una
 * FV. Nótese que aquí no se pregunta por el ritmo, solo por el modo — es lo que
 * mantiene el cliente libre de casos especiales.
 *
 * Vive en su propio módulo y no dentro de `HeartModel` porque lo consultan dos
 * sitios que tienen que coincidir: el que deforma las aurículas y el que
 * levanta la onda A de la mitral. Si cada uno lo calculara por su cuenta,
 * bastaría con que uno cambiara para que el panel dijera una cosa y el modelo
 * enseñara otra. */
export function excursionFor(
  chamber: ChamberName,
  tS: number,
  timeline: CardiacTimeline,
  heartState: HeartStateValues | null
): number {
  // Sin estado todavía: lo único razonable es reproducir los eventos que
  // hayan llegado. El estado llega como muy tarde 250 ms después del primero.
  if (heartState === null) return timeline.excursionAt(chamber, tS);

  const mode =
    chamber === "atria" ? heartState.atrial_mode : heartState.ventricular_mode;
  const amplitude =
    chamber === "atria"
      ? heartState.atrial_amplitude
      : heartState.ventricular_amplitude;

  switch (mode) {
    case "synchronous":
      return timeline.excursionAt(chamber, tS);
    case "fluttering":
    case "fibrillating":
      return tremorExcursion(tS, heartState.flutter_hz, amplitude);
    case "absent":
      return 0;
  }
}

/** Paso con el que se deriva la contracción para sacar el caudal. Cinco
 * milisegundos: menos de un fotograma a 60 Hz, y suficiente para que la
 * diferencia no se coma en el redondeo de los instantes, que vienen a
 * milisegundos. */
const FLOW_STEP_S = 0.005;

/** Cuánto se está vaciando el ventrículo en `tS`, de 0 a 1.
 *
 * La sangre que atraviesa una sigmoidea es la que el ventrículo expulsa, y eso
 * es la **derivada** de su contracción, no la contracción. Por eso la válvula
 * está más abierta a mitad de la subida —cuando el ventrículo se contrae más
 * deprisa— y no cuando ya está contraído del todo.
 *
 * Se normaliza contra la pendiente máxima que puede tener la curva de
 * contracción: un coseno alzado que sube de 0 a 1 en el 45% de la ventana
 * tiene su máximo en `π/(2·0,45·duración)`. Con una sístole de un tercio de
 * segundo eso son unos 10,5 por segundo. Se usa esa referencia y no el máximo
 * observado porque el máximo observado cambiaría con la frecuencia, y entonces
 * una taquicardia abriría la válvula igual que una bradicardia — cuando lo que
 * de verdad pasa es que un ventrículo que se contrae más deprisa empuja más. */
const FLOW_REFERENCE = 10.5;

export function ventricularFlow(
  tS: number,
  timeline: CardiacTimeline,
  heartState: HeartStateValues | null
): number {
  const before = excursionFor("ventricles", tS - FLOW_STEP_S, timeline, heartState);
  const after = excursionFor("ventricles", tS + FLOW_STEP_S, timeline, heartState);
  const rate = (after - before) / (2 * FLOW_STEP_S);
  // Solo cuenta el vaciado. Cuando el ventrículo se relaja el flujo por la
  // sigmoidea no se invierte: se cierra, y de eso ya se encarga el pulso.
  return Math.min(1, Math.max(0, rate / FLOW_REFERENCE));
}
