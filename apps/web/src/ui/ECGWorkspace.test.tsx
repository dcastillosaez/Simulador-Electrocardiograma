import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ECGWorkspace } from "./ECGWorkspace";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
  closed = false;
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(): void {}

  close(): void {
    this.closed = true;
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("ECGWorkspace", () => {
  let fakeSocket: FakeWebSocket;

  beforeEach(() => {
    fakeSocket = new FakeWebSocket();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      })
    );
    // jsdom no implementa el contexto 2D de Canvas: se sustituye por un
    // stub inerte para que el bucle de dibujo no falle al montar. No se
    // guarda la referencia del spy: `ReturnType<typeof vi.spyOn>` sin
    // parametrizar pierde el overload concreto de `getContext` (colisiona
    // con la sobrecarga genérica de `vi.spyOn`), y `vi.restoreAllMocks()`
    // en el `afterEach` restaura este spy igual sin necesitar el tipo.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      canvas: { width: 800 },
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("conecta el runtime al montar y lo desconecta al desmontar", async () => {
    const { unmount } = render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => expect(fakeSocket.closed).toBe(false));

    unmount();

    expect(fakeSocket.closed).toBe(true);
  });

  it("muestra el selector de ritmo", async () => {
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seleccionar ritmo")).toBeInTheDocument();
    });
  });

  it("no muestra 'esperando señal' antes de arrancar una sesion", async () => {
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    // El buffer está vacío (isUnderrun=true) desde el primer render, pero
    // el indicador solo debe aparecer con una sesión en curso — mostrarlo
    // antes de pulsar "start" confundiría al usuario con un mensaje sobre
    // una señal que nunca se pidió.
    expect(screen.queryByText("Esperando señal…")).not.toBeInTheDocument();
  });
});
