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

export type ServerMessage =
  | StartedMessage
  | UpdatedMessage
  | PausedMessage
  | ResumedMessage
  | StoppedMessage
  | ErrorMessage;
