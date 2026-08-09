/** Prefijo del subprotocolo con el que viaja el token del modo escritorio.
 *
 * Por subprotocolo y no por cabecera porque `new WebSocket(url)` no admite
 * cabeceras, ni por query string porque ahi acabaria en los logs del servidor
 * y en el historial. Tiene que coincidir con `TOKEN_SUBPROTOCOL_PREFIX` del
 * backend. */
export const TOKEN_SUBPROTOCOL_PREFIX = "ecg-token.";

export interface WebSocketClientOptions {
  url: string;
  /** Solo en escritorio. En navegador no hay token y no se envia nada. */
  token?: string;
  webSocketFactory?: (url: string, protocols?: string[]) => WebSocket;
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
  private readonly token: string;
  private readonly factory: (url: string, protocols?: string[]) => WebSocket;

  // Referencias estables: `close()` las necesita para poder retirarlas con
  // `removeEventListener`. Sin esto, el socket que se está cerrando sigue
  // entregando eventos asíncronos (sobre todo "close") después de que
  // `this.socket` ya apunte a una conexión NUEVA — bajo React StrictMode
  // (monta→limpia→monta el mismo efecto), la conexión B recién abierta
  // recibía un `onClose` espurio disparado por el cierre asíncrono de la
  // conexión A, reseteando el estado que B ya había empezado a construir.
  private readonly handleOpen = () => this.onOpen?.();

  private readonly handleMessage = (event: MessageEvent) => {
    if (typeof event.data === "string") {
      this.onTextMessage?.(event.data);
    } else {
      this.onBinaryMessage?.(event.data as ArrayBuffer);
    }
  };

  private readonly handleClose = (event: CloseEvent) => {
    this.onClose?.({ code: event.code, reason: event.reason });
  };

  private readonly handleError = (event: Event) => {
    this.onError?.(event);
  };

  constructor(options: WebSocketClientOptions) {
    this.url = options.url;
    this.token = options.token ?? "";
    this.factory =
      options.webSocketFactory ??
      ((url, protocols) => new WebSocket(url, protocols));
  }

  connect(): void {
    const protocolos = this.token
      ? [`${TOKEN_SUBPROTOCOL_PREFIX}${this.token}`]
      : undefined;
    const socket = this.factory(this.url, protocolos);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("close", this.handleClose);
    socket.addEventListener("error", this.handleError);
    this.socket = socket;
  }

  sendJson(message: unknown): void {
    if (!this.socket || this.socket.readyState !== 1 /* WebSocket.OPEN */) {
      throw new Error("WebSocketClient: intento de enviar sin conexión abierta");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    if (this.socket) {
      this.socket.removeEventListener("open", this.handleOpen);
      this.socket.removeEventListener("message", this.handleMessage);
      this.socket.removeEventListener("close", this.handleClose);
      this.socket.removeEventListener("error", this.handleError);
      this.socket.close();
    }
    this.socket = null;
  }
}
