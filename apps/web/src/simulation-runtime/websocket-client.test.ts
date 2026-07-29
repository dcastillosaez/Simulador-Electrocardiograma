import { describe, expect, it, vi } from "vitest";
import { WebSocketClient } from "./websocket-client";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sentMessages: unknown[] = [];
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
  }

  send(data: unknown): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code: 1000, reason: "cierre normal" });
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("WebSocketClient", () => {
  it("conecta usando la fabrica inyectada y fija binaryType a arraybuffer", () => {
    const fake = new FakeWebSocket();
    const factory = vi.fn().mockReturnValue(fake);
    const client = new WebSocketClient({ url: "ws://test", webSocketFactory: factory });

    client.connect();

    expect(factory).toHaveBeenCalledWith("ws://test");
    expect(fake.binaryType).toBe("arraybuffer");
  });

  it("llama a onOpen cuando el socket abre", () => {
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onOpen = vi.fn();
    client.onOpen = onOpen;

    client.connect();
    fake.dispatch("open", {});

    expect(onOpen).toHaveBeenCalled();
  });

  it("dirige mensajes de texto y binarios a sus callbacks respectivos", () => {
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onText = vi.fn();
    const onBinary = vi.fn();
    client.onTextMessage = onText;
    client.onBinaryMessage = onBinary;

    client.connect();
    fake.dispatch("message", { data: '{"type":"started"}' });
    const buffer = new ArrayBuffer(4);
    fake.dispatch("message", { data: buffer });

    expect(onText).toHaveBeenCalledWith('{"type":"started"}');
    expect(onBinary).toHaveBeenCalledWith(buffer);
  });

  it("sendJson serializa el mensaje cuando el socket esta abierto", () => {
    const fake = new FakeWebSocket();
    fake.readyState = FakeWebSocket.OPEN;
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });

    client.connect();
    client.sendJson({ type: "stop" });

    expect(fake.sentMessages).toEqual(['{"type":"stop"}']);
  });

  it("sendJson lanza si el socket no esta abierto", () => {
    const fake = new FakeWebSocket();
    fake.readyState = FakeWebSocket.CONNECTING;
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });

    client.connect();

    expect(() => client.sendJson({ type: "stop" })).toThrow(/sin conexión abierta/);
  });

  it("llama a onClose con el codigo y la razon", () => {
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onClose = vi.fn();
    client.onClose = onClose;

    client.connect();
    fake.close();

    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: "cierre normal" });
  });

  it("close() retira los listeners: un evento tardio del socket viejo no llama a los callbacks", () => {
    // Bajo React StrictMode, close() puede llamarse justo antes de que
    // connect() abra un socket nuevo sobre la MISMA instancia de
    // WebSocketClient. El evento "close" del socket viejo llega de forma
    // asincrona -- si los listeners no se retiran, ese evento tardio
    // llamaria a onClose() y corromperia el estado que el socket nuevo ya
    // empezo a construir.
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onClose = vi.fn();
    client.onClose = onClose;

    client.connect();
    client.close();
    // Evento "close" tardio del socket ya cerrado, entregado despues de
    // que WebSocketClient.close() ya retirase sus listeners.
    fake.dispatch("close", { code: 1000, reason: "cierre normal" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
