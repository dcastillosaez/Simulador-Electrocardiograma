export interface WebSocketClientOptions {
  url: string;
  webSocketFactory?: (url: string) => WebSocket;
}

export type BinaryMessageHandler = (data: ArrayBuffer) => void;
export type TextMessageHandler = (data: string) => void;
export type CloseHandler = (event: { code: number; reason: string }) => void;

export class WebSocketClient {
  onOpen: (() => void) | null = null;
  onTextMessage: TextMessageHandler | null = null;
  onBinaryMessage: BinaryMessageHandler | null = null;
  onClose: CloseHandler | null = null;
  onError: ((error: unknown) => void) | null = null;

  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly factory: (url: string) => WebSocket;

  constructor(options: WebSocketClientOptions) {
    this.url = options.url;
    this.factory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  connect(): void {
    const socket = this.factory(this.url);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => this.onOpen?.());
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") {
        this.onTextMessage?.(event.data);
      } else {
        this.onBinaryMessage?.(event.data as ArrayBuffer);
      }
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      this.onClose?.({ code: event.code, reason: event.reason });
    });
    socket.addEventListener("error", (event: Event) => {
      this.onError?.(event);
    });
    this.socket = socket;
  }

  sendJson(message: unknown): void {
    if (!this.socket || this.socket.readyState !== 1 /* WebSocket.OPEN */) {
      throw new Error("WebSocketClient: intento de enviar sin conexión abierta");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
