import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { CardiacTimeline } from "../../cardiac/cardiac-timeline";
import { ValveTimeline } from "../../cardiac/valve-timeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import type {
  CardiacEventsMessage,
  HeartStateMessage,
} from "../../types/ws-messages";

export type HeartStateValues = HeartStateMessage["values"];

export interface UseCardiacTimelineResult {
  /** En una ref y no en estado: la escribe el WebSocket y la lee el bucle de
   * dibujo sesenta veces por segundo. Guardarla en `useState` provocaría un
   * re-render de React por cada mensaje del servidor sin que cambie un solo
   * píxel del árbol, que es exactamente lo que la arquitectura de la fase C
   * excluye del camino caliente. */
  timeline: MutableRefObject<CardiacTimeline>;
  /** La coreografía valvular, por el mismo motivo y del mismo mensaje.
   *
   * Va en su propia cola y no dentro de `CardiacTimeline` porque son dos
   * preguntas distintas sobre el mismo latido: cuánto se ha contraído una
   * cámara y cuánto está abierta una válvula no comparten ni curva ni reposo
   * —una contracción parte de cero, una auriculoventricular parte de abierta—.
   * Comparten el reloj, que es lo que las mantiene sincronizadas. */
  valves: MutableRefObject<ValveTimeline>;
  /** En estado sí: cambia cuatro veces por segundo como mucho, y hay
   * interfaz —modo de cada cámara— que depende de él. */
  heartState: HeartStateValues | null;
}

export function useCardiacTimeline(runtime: SessionRuntime): UseCardiacTimelineResult {
  const timeline = useRef(new CardiacTimeline());
  const valves = useRef(new ValveTimeline());
  const [heartState, setHeartState] = useState<HeartStateValues | null>(null);

  useEffect(() => {
    const onEvents = (message: CardiacEventsMessage) => {
      timeline.current.push(message.events);
      // `?? []` y no `message.valves` a secas: una sesión guardada antes de
      // que el servidor publicara válvulas se reproduce sin ellas en vez de
      // reventar al primer mensaje.
      valves.current.push(message.valves ?? []);
    };
    const onState = (message: HeartStateMessage) => setHeartState(message.values);
    // Un ritmo nuevo arranca en t=0: sin vaciar, las contracciones del ritmo
    // anterior seguirían en cola con instantes que el reloj nuevo va a
    // recorrer otra vez, y el corazón latiría al ritmo viejo un rato.
    const onStarted = () => {
      timeline.current.clear();
      valves.current.clear();
      setHeartState(null);
    };

    runtime.on("cardiacEvents", onEvents);
    runtime.on("heartState", onState);
    runtime.on("started", onStarted);
    return () => {
      runtime.off("cardiacEvents", onEvents);
      runtime.off("heartState", onState);
      runtime.off("started", onStarted);
    };
  }, [runtime]);

  return { timeline, valves, heartState };
}
