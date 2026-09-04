import { useFrame } from "@react-three/fiber";
import type { MutableRefObject, RefObject } from "react";
import {
  HEART_VALVES,
  VALVE_ORDER,
  type ValveName,
} from "./heart-valves";
import type { ValvePhase, ValveTimeline } from "../../cardiac/valve-timeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

/** Los dos elementos que hay que escribir por válvula. */
export interface ValveHandle {
  fill: HTMLElement | null;
  state: HTMLElement | null;
}

export type ValveHandles = Partial<Record<ValveName, ValveHandle>>;

export const PHASE_LABELS: Record<ValvePhase, string> = {
  filling: "Llenado",
  "isovolumetric-contraction": "Contracción isovolumétrica",
  ejection: "Eyección",
  "isovolumetric-relaxation": "Relajación isovolumétrica",
};

/** Lo que se lee cuando no hay ciclo que contar: una fibrilación ventricular
 * no tiene fases porque no tiene sístole, y decir "llenado" ahí sería mentir
 * con una palabra de manual. */
export const NO_CYCLE_LABEL = "Sin ciclo mecánico";

/** La palabra que acompaña a la barra. El umbral está en la mitad porque la
 * transición dura treinta milisegundos: durante el viaje la barra es lo que
 * informa, y la palabra dice hacia dónde va. */
export function apertureLabel(aperture: number): string {
  return aperture >= 0.5 ? "abierta" : "cerrada";
}

export interface ValveReadoutProps {
  runtime: SessionRuntime;
  valves: MutableRefObject<ValveTimeline>;
  phaseRef: RefObject<HTMLElement | null>;
  handles: MutableRefObject<ValveHandles>;
}

/** Mantiene al día el estado escrito de las cuatro válvulas.
 *
 * Existe porque en la vista por defecto —el corazón entero y opaco— las
 * válvulas no se ven: están dentro de las cavidades. Quien mira el trazado y
 * quiere comprobar que la mitral se cierra con el QRS tendría que aislarlas o
 * bajar la opacidad antes de poder verlo. Con esto lo lee de entrada, y al
 * aislarlas confirma en el modelo lo que el panel decía.
 *
 * Vive dentro del `Canvas` y escribe sobre DOM de fuera, igual que
 * `ScaleBar` y por el mismo motivo: esto cambia en cada fotograma, y pasar por
 * el estado de React sesenta veces por segundo para mover una barra de
 * cuarenta píxeles tiraría medio presupuesto de fotograma.
 *
 * El reloj es el mismo que mueve las valvas y las cámaras. No se recalcula ni
 * se aproxima aquí: se vuelve a preguntar a la misma línea temporal con el
 * mismo instante, así que lo escrito y lo dibujado no pueden discrepar. */
export function ValveReadout({
  runtime,
  valves,
  phaseRef,
  handles,
}: ValveReadoutProps) {
  useFrame(() => {
    const tS = runtime.buffer.playbackTimeS;
    if (tS === null) return;

    const phase = valves.current.phaseAt(tS);
    const phaseLabel = phase === null ? NO_CYCLE_LABEL : PHASE_LABELS[phase];
    const phaseNode = phaseRef.current;
    if (phaseNode && phaseNode.textContent !== phaseLabel) {
      phaseNode.textContent = phaseLabel;
    }

    const aperture = {
      atrioventricular: valves.current.apertureAt("atrioventricular", tS),
      semilunar: valves.current.apertureAt("semilunar", tS),
    };

    for (const valve of VALVE_ORDER) {
      const handle = handles.current[valve];
      if (!handle) continue;
      const value = aperture[HEART_VALVES[valve].group];

      if (handle.fill) {
        // Se redondea a un entero: sin eso el navegador recalcularía el
        // trazado por diferencias de una centésima de píxel que nadie ve.
        const width = `${Math.round(value * 100)}%`;
        if (handle.fill.style.width !== width) handle.fill.style.width = width;
      }
      if (handle.state) {
        const text = apertureLabel(value);
        if (handle.state.textContent !== text) handle.state.textContent = text;
      }
    }
  });

  return null;
}
