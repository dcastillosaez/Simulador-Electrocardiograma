import type { EngineParamsPayload } from "./engine-params";

export interface StartMessage {
  type: "start";
  rhythm_id: string;
  params?: EngineParamsPayload;
  seed?: number;
}

export interface UpdateMessage {
  type: "update";
  params: EngineParamsPayload;
}

export interface PauseMessage {
  type: "pause";
}

export interface ResumeMessage {
  type: "resume";
}

export interface StopMessage {
  type: "stop";
}

export interface PingMessage {
  // Reservado: el backend lo reconoce pero no lo despacha en fase 1 (mide
  // latencia de ida y vuelta, hará falta en fase 2). No hay UI que lo
  // envíe todavía, pero el tipo existe para no romper el contrato cuando
  // se implemente.
  type: "ping";
}

export type ClientMessage =
  | StartMessage
  | UpdateMessage
  | PauseMessage
  | ResumeMessage
  | StopMessage
  | PingMessage;

export interface StartedMessage {
  type: "started";
  session_id: string;
  seed: number;
  sample_rate_hz: number;
  channels: number;
}

export interface UpdatedMessage {
  type: "updated";
  params: EngineParamsPayload;
}

export interface PausedMessage {
  type: "paused";
}

export interface ResumedMessage {
  type: "resumed";
}

export interface StoppedMessage {
  type: "stopped";
  duration_s: number;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  detail: string;
}

/** Medidas fisiológicas de la ventana de señal, calculadas en el servidor.
 *
 * `values` es un mapa abierto y no un objeto de campos fijos: el contrato
 * está pensado para crecer —eje eléctrico, frecuencia auricular, y lo que
 * necesiten el corazón 3D y el módulo de farmacología— sin que un cliente
 * anterior deje de funcionar. Un valor `null` significa «no medible en este
 * ritmo», no «error»: un flutter no tiene PR y una FV no tiene QT.
 *
 * Las unidades van en el nombre de la clave a propósito. El frontend no
 * convierte ni corrige nada: esas son fórmulas clínicas y viven en el motor.
 */
export interface MeasurementsMessage {
  type: "measurements";
  t_s: number;
  window_s: number;
  values: Record<string, number | null>;
}

export type ServerMessage =
  | StartedMessage
  | UpdatedMessage
  | PausedMessage
  | ResumedMessage
  | StoppedMessage
  | MeasurementsMessage
  | ErrorMessage;
