import { TypedEventEmitter } from "./event-emitter";
import { WebSocketClient } from "./websocket-client";
import { decodeFrame } from "./frame-decoder";
import { FrameBuffer } from "./frame-buffer";
import type {
  ClientMessage,
  ErrorMessage,
  PausedMessage,
  ResumedMessage,
  ServerMessage,
  StartedMessage,
  StoppedMessage,
  UpdatedMessage,
} from "../types/ws-messages";
import type { EngineParamsPayload } from "../types/engine-params";

export type SessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "running"
  | "paused"
  | "stopped";

export interface SessionRuntimeEvents {
  connected: Record<string, never>;
  disconnected: { code: number; reason: string };
  started: StartedMessage;
  updated: UpdatedMessage;
  paused: PausedMessage;
  resumed: ResumedMessage;
  stopped: StoppedMessage;
  error: ErrorMessage;
  frameMeta: { sequenceNumber: number; lost: boolean; sessionId: string };
}

export class SessionRuntime extends TypedEventEmitter<SessionRuntimeEvents> {
  readonly buffer = new FrameBuffer();
  state: SessionState = "idle";

  private readonly ws: WebSocketClient;
  private lastSequenceNumber: number | null = null;
  private lastSessionId: string | null = null;

  constructor(wsUrl: string, webSocketFactory?: (url: string) => WebSocket) {
    super();
    this.ws = new WebSocketClient({ url: wsUrl, webSocketFactory });
    this.ws.onOpen = () => {
      this.state = "connected";
      this.emit("connected", {});
    };
    this.ws.onTextMessage = (raw) => {
      this.handleServerMessage(JSON.parse(raw) as ServerMessage);
    };
    this.ws.onBinaryMessage = (data) => this.handleFrame(data);
    this.ws.onClose = ({ code, reason }) => {
      this.state = "idle";
      this.buffer.clear();
      this.lastSequenceNumber = null;
      this.lastSessionId = null;
      this.emit("disconnected", { code, reason });
    };
    // `WebSocketClient.onError` estaba definido pero nunca se asignaba: un
    // socket que nunca llega a abrir, o que falla a mitad de conexión, no
    // generaba ningún evento observable — el usuario se quedaba mirando un
    // selector de ritmo que no hacía nada, sin ningún mensaje. El navegador
    // no da detalle del error (por seguridad, el evento `error` del
    // WebSocket nunca lleva información), así que solo se puede reportar
    // que algo falló, no el motivo exacto.
    this.ws.onError = () => {
      this.emit("error", {
        type: "error",
        code: "CONNECTION_ERROR",
        detail: "No se pudo conectar con el servidor de simulación",
      });
    };
  }

  connect(): void {
    this.state = "connecting";
    this.ws.connect();
  }

  disconnect(): void {
    this.ws.close();
  }

  start(rhythmId: string, params?: EngineParamsPayload, seed?: number): void {
    this.send({ type: "start", rhythm_id: rhythmId, params, seed });
  }

  update(params: EngineParamsPayload): void {
    this.send({ type: "update", params });
  }

  pause(): void {
    this.send({ type: "pause" });
  }

  resume(): void {
    this.send({ type: "resume" });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  private send(message: ClientMessage): void {
    this.ws.sendJson(message);
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "started":
        this.state = "running";
        this.lastSequenceNumber = null;
        this.lastSessionId = message.session_id;
        this.buffer.clear();
        this.emit("started", message);
        break;
      case "updated":
        this.emit("updated", message);
        break;
      case "paused":
        this.state = "paused";
        this.emit("paused", message);
        break;
      case "resumed":
        this.state = "running";
        this.emit("resumed", message);
        break;
      case "stopped":
        this.state = "stopped";
        this.emit("stopped", message);
        break;
      case "error":
        this.emit("error", message);
        break;
    }
  }

  private handleFrame(data: ArrayBuffer): void {
    const frame = decodeFrame(data);

    if (frame.sessionId !== this.lastSessionId) {
      this.lastSequenceNumber = null;
      this.lastSessionId = frame.sessionId;
    }

    if (this.lastSequenceNumber !== null && frame.sequenceNumber <= this.lastSequenceNumber) {
      // Fuera de orden: se descarta, no se añade al buffer ni se cuenta
      // como pérdida (podría ser un duplicado de red, no un hueco real).
      return;
    }

    const lost =
      this.lastSequenceNumber !== null &&
      frame.sequenceNumber > this.lastSequenceNumber + 1;

    this.lastSequenceNumber = frame.sequenceNumber;
    this.buffer.push(frame, { gapBefore: lost });
    this.emit("frameMeta", {
      sequenceNumber: frame.sequenceNumber,
      lost,
      sessionId: frame.sessionId,
    });
  }
}
