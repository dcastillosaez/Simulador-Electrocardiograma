import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ECGWorkspace } from "./ECGWorkspace";
import { HEADER_SIZE_BYTES } from "../simulation-runtime/frame-decoder";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
  closed = false;
  sentMessages: string[] = [];
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

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

interface MockCtx {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  canvas: { width: number };
}

function makeMockCtx(): MockCtx {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    canvas: { width: 800 },
  };
}

const RHYTHM_SUMMARY = {
  rhythm_id: "sinus_normal",
  display_name: "Sinusal normal",
  category: "sinus",
  ventricular_rate_hz: 1.1667,
  pr_is_measurable: true,
};
const RHYTHM_DETAIL = {
  ...RHYTHM_SUMMARY,
  default_parameters: { heart_rate_hz: 1.1667 },
  editable_parameters: {
    heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 },
    orientation_deg: { minimum: -180, maximum: 180, default: 50 },
    p_offset_deg: { minimum: -45, maximum: 45, default: 3.4 },
    qrs_offset_deg: { minimum: -90, maximum: 90, default: 0 },
    st_offset_deg: { minimum: -180, maximum: 180, default: 0 },
    t_offset_deg: { minimum: -180, maximum: 180, default: 0 },
  },
  clinical_description: "...",
  references: [],
  allowed_overlays: [],
};

const DRUG_SUMMARY = {
  drug_id: "atropine",
  display_name: "Atropina",
  category: "parasympatholytic",
  routes: ["IV", "IO"],
  dose_unit: "mg",
  reference_dose: 1,
  max_cumulative_dose: 3,
  onset_s: 20,
  peak_s: 90,
  duration_s: 1800,
};

function stubRhythmFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/rhythms")) {
        return Promise.resolve({ ok: true, json: async () => [RHYTHM_SUMMARY] });
      }
      // El panel de farmacologia pide su catalogo al montar. Sin esta rama
      // el doble devolvia el detalle de un ritmo para /api/drugs y el panel
      // se caia al recorrerlo, tumbando el workspace entero.
      if (url.endsWith("/api/drugs")) {
        return Promise.resolve({ ok: true, json: async () => [DRUG_SUMMARY] });
      }
      return Promise.resolve({ ok: true, json: async () => RHYTHM_DETAIL });
    })
  );
}

/** Mismo formato binario de 40 bytes que produce `frames.py` (ver
 * `frame-decoder.ts`/`session-runtime.test.ts`): trozos de 50 muestras a
 * 500Hz (100ms), como los que envía el backend real. */
function buildFrameBytes(options: { sequenceNumber: number; nChannels: number }): ArrayBuffer {
  const nSamplesPerChannel = 50;
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES + options.nChannels * nSamplesPerChannel * 4);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 500, true);
  view.setUint8(4, options.nChannels);
  view.setUint8(5, 0);
  view.setUint16(6, nSamplesPerChannel, true);
  view.setUint32(8, options.sequenceNumber, true);
  view.setUint32(12, 0, true);
  view.setFloat64(16, 0, true);
  new Uint8Array(buffer, 24, 16).fill(0xab);
  for (let ch = 0; ch < options.nChannels; ch++) {
    for (let i = 0; i < nSamplesPerChannel; i++) {
      view.setFloat32(HEADER_SIZE_BYTES + (ch * nSamplesPerChannel + i) * 4, 0.001, true);
    }
  }
  return buffer;
}

describe("ECGWorkspace", () => {
  let fakeSocket: FakeWebSocket;
  let canvasContexts: Map<HTMLCanvasElement, MockCtx>;

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
    // stub inerte por elemento (no uno compartido) para que el bucle de
    // dibujo no falle al montar y cada canvas se pueda inspeccionar por
    // separado — necesario para distinguir el trazo de una derivación del
    // de otra o de la rejilla. No se guarda la referencia del spy:
    // `ReturnType<typeof vi.spyOn>` sin parametrizar pierde el overload
    // concreto de `getContext` (colisiona con la sobrecarga genérica de
    // `vi.spyOn`), y `vi.restoreAllMocks()` en el `afterEach` restaura este
    // spy igual sin necesitar el tipo.
    canvasContexts = new Map();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      let ctx = canvasContexts.get(this);
      if (!ctx) {
        ctx = makeMockCtx();
        canvasContexts.set(this, ctx);
      }
      return ctx;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
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

  it("no muestra 'Desconectado' antes de haberse conectado nunca", async () => {
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    expect(screen.queryByText("Desconectado")).not.toBeInTheDocument();
  });

  it("muestra 'Desconectado' si el socket se cierra tras haber estado conectado", async () => {
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));
    // Cada dispatch en su propio act(): sin esto, React 18 agrupa ambas
    // actualizaciones de Zustand en un unico re-render con el estado FINAL
    // (idle), sin llegar a comprometer nunca el estado intermedio
    // "connected" -- el efecto que marca hasConnectedOnce no se dispara.
    act(() => {
      fakeSocket.dispatch("open", {});
    });
    act(() => {
      fakeSocket.dispatch("close", { code: 1006, reason: "" });
    });

    // Con el motivo, no a secas: un 1006 es "no hay nadie escuchando ahi", y
    // eso se arregla arrancando el backend. Un servidor lleno (1013) diria
    // otra cosa y pediria otra accion.
    await waitFor(() => {
      expect(screen.getByText(/^Desconectado: .*arrancado/i)).toBeInTheDocument();
    });
  });

  it("un frame nuevo produce dibujo incremental en el canvas de la derivacion", async () => {
    stubRhythmFetch();
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => screen.getByText("Sinusal normal"));
    act(() => fakeSocket.dispatch("open", {}));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");
    await waitFor(() => expect(fakeSocket.sentMessages.length).toBeGreaterThan(0));

    act(() => {
      fakeSocket.dispatch("message", {
        data: JSON.stringify({
          type: "started",
          session_id: "11111111-1111-1111-1111-111111111111",
          seed: 1,
          sample_rate_hz: 500,
          channels: 12,
        }),
      });
    });

    const leadIICanvas = screen.getByTestId("lead-canvas-II") as HTMLCanvasElement;
    const leadIICtx = canvasContexts.get(leadIICanvas)!;
    expect(leadIICtx.lineTo).not.toHaveBeenCalled();

    // 5 trozos de 100ms = 0,5s = targetS por defecto: alcanza el pre-roll y
    // deja el buffer listo para que advance() empiece a consumir en el
    // siguiente tick de rAF.
    act(() => {
      for (let i = 0; i < 5; i++) {
        fakeSocket.dispatch("message", { data: buildFrameBytes({ sequenceNumber: i, nChannels: 12 }) });
      }
    });

    await waitFor(
      () => {
        expect(leadIICtx.lineTo).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it("cambiar de ritmo reinicia el barrido (limpia los canvas de derivacion)", async () => {
    stubRhythmFetch();
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => screen.getByText("Sinusal normal"));
    act(() => fakeSocket.dispatch("open", {}));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");
    await waitFor(() => expect(fakeSocket.sentMessages.length).toBeGreaterThan(0));

    const leadIICanvas = screen.getByTestId("lead-canvas-II") as HTMLCanvasElement;
    const leadIICtx = canvasContexts.get(leadIICanvas)!;

    act(() => {
      fakeSocket.dispatch("message", {
        data: JSON.stringify({
          type: "started",
          session_id: "11111111-1111-1111-1111-111111111111",
          seed: 1,
          sample_rate_hz: 500,
          channels: 12,
        }),
      });
    });
    const clearCallsAfterFirstStart = leadIICtx.clearRect.mock.calls.length;
    expect(clearCallsAfterFirstStart).toBeGreaterThan(0);

    // Seleccionar el mismo ritmo otra vez desde el <select> no dispara
    // 'change' (el valor no cambia) -- se reproduce un reinicio de sesión
    // real disparando un segundo 'started' del servidor directamente, igual
    // que haría el backend al reiniciar con un session_id distinto.
    act(() => {
      fakeSocket.dispatch("message", {
        data: JSON.stringify({
          type: "started",
          session_id: "22222222-2222-2222-2222-222222222222",
          seed: 2,
          sample_rate_hz: 500,
          channels: 12,
        }),
      });
    });

    expect(leadIICtx.clearRect.mock.calls.length).toBeGreaterThan(clearCallsAfterFirstStart);
  });

  it("muestra el control del eje y su métrica cuando hay un ritmo activo", async () => {
    stubRhythmFetch();
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );
    await waitFor(() => screen.getByText("Sinusal normal"));
    act(() => fakeSocket.dispatch("open", {}));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");

    await waitFor(() =>
      expect(screen.getByRole("slider", { name: /eje eléctrico/i })).toBeInTheDocument()
    );
    expect(screen.getByText("Eje")).toBeInTheDocument();
  });

  it("el indicador de congelado aparece al pulsar, sin esperar al servidor", async () => {
    // Es la diferencia entre una herramienta que responde y una que parece
    // tener medio segundo de retardo. El socket falso NUNCA devuelve el
    // mensaje `paused`: si el indicador dependiese del servidor, este test
    // no pasaria jamas.
    stubRhythmFetch();
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );
    await waitFor(() => screen.getByText("Sinusal normal"));
    act(() => fakeSocket.dispatch("open", {}));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");
    act(() => {
      fakeSocket.dispatch("message", {
        data: JSON.stringify({
          type: "started",
          session_id: "11111111-1111-1111-1111-111111111111",
          seed: 1,
          sample_rate_hz: 500,
          channels: 12,
        }),
      });
    });

    await userEvent.click(screen.getByRole("button", { name: /congelar/i }));

    expect(screen.getByText(/trazado congelado/i)).toBeInTheDocument();
    // Y el `pause` sale hacia el motor de todas formas: congelar el cliente no
    // debe dejar al servidor generando señal que nadie va a ver.
    expect(fakeSocket.sentMessages.some((m) => m.includes('"pause"'))).toBe(true);
    // La superficie de medicion solo existe congelado: lo dibujado en canvas
    // no existe para un lector de pantalla, y este rol y nombre son la unica
    // via por la que sabe que hay algo interactivo ahi.
    expect(
      screen.getByRole("application", { name: /medición sobre el trazado/i })
    ).toBeInTheDocument();
  });
});
