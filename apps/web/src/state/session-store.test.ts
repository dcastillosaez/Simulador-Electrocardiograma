import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "./session-store";
import { SessionRuntime } from "../simulation-runtime/session-runtime";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
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

  send(): void {}
  close(): void {
    this.dispatch("close", { code: 1000, reason: "" });
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      connectionState: "idle",
      sessionId: null,
      seed: null,
      sampleRateHz: null,
      selectedRhythmId: null,
      params: null,
      lastError: null,
      framesLost: 0,
      measurements: null,
    });
  });

  it("selectRhythm fija el ritmo seleccionado", () => {
    useSessionStore.getState().selectRhythm("sinus_normal");
    expect(useSessionStore.getState().selectedRhythmId).toBe("sinus_normal");
  });

  it("refleja los eventos del runtime adjunto", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);

    runtime.connect();
    fake.dispatch("open", {});
    expect(useSessionStore.getState().connectionState).toBe("connected");

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "22222222-2222-2222-2222-222222222222",
        seed: 42,
        sample_rate_hz: 500,
        channels: 12,
      }),
    });

    const state = useSessionStore.getState();
    expect(state.connectionState).toBe("running");
    expect(state.sessionId).toBe("22222222-2222-2222-2222-222222222222");
    expect(state.seed).toBe(42);
    expect(state.sampleRateHz).toBe(500);
  });

  it("cuenta framesLost cuando el runtime reporta perdida", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();

    runtime.emit("frameMeta", { sequenceNumber: 5, lost: true, sessionId: "x" });
    runtime.emit("frameMeta", { sequenceNumber: 6, lost: false, sessionId: "x" });

    expect(useSessionStore.getState().framesLost).toBe(1);
  });

  it("guarda el error del servidor", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({ type: "error", code: "NOT_FOUND", detail: "ritmo desconocido" }),
    });

    expect(useSessionStore.getState().lastError).toEqual({
      code: "NOT_FOUND",
      detail: "ritmo desconocido",
    });
  });

  it("attachRuntime devuelve detach: llamarlo dos veces sobre la misma instancia sin desuscribir duplicaria framesLost", () => {
    // Reproduce lo que hace React StrictMode en desarrollo: monta, limpia,
    // vuelve a montar el mismo efecto sobre la MISMA instancia de
    // SessionRuntime. Sin desuscribir entre medias, cada evento quedaria
    // con el doble de listeners.
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);

    const detachFirst = useSessionStore.getState().attachRuntime(runtime);
    detachFirst();
    useSessionStore.getState().attachRuntime(runtime);

    runtime.emit("frameMeta", { sequenceNumber: 1, lost: true, sessionId: "x" });

    expect(useSessionStore.getState().framesLost).toBe(1);
  });

  it("tras detach(), el runtime deja de actualizar el store", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const detach = useSessionStore.getState().attachRuntime(runtime);

    detach();
    runtime.emit("frameMeta", { sequenceNumber: 1, lost: true, sessionId: "x" });

    expect(useSessionStore.getState().framesLost).toBe(0);
  });

  it("al desconectar limpia session_id/seed pero conserva selectedRhythmId", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().selectRhythm("sinus_normal");
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started", session_id: "s", seed: 1, sample_rate_hz: 500, channels: 12,
      }),
    });

    fake.close();

    const state = useSessionStore.getState();
    expect(state.connectionState).toBe("idle");
    expect(state.sessionId).toBeNull();
    expect(state.selectedRhythmId).toBe("sinus_normal");
  });
});

describe("medidas fisiologicas", () => {
  function attachedRuntime() {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    fake.dispatch("open", {});
    return fake;
  }

  it("guarda los valores que publica el servidor", () => {
    const fake = attachedRuntime();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "measurements",
        t_s: 10,
        window_s: 10,
        values: { pr_ms: 160, qrs_ms: 90, qt_ms: 400, qtc_ms: 432.8 },
      }),
    });

    expect(useSessionStore.getState().measurements).toEqual({
      pr_ms: 160,
      qrs_ms: 90,
      qt_ms: 400,
      qtc_ms: 432.8,
    });
  });

  it("conserva el null de una medida no medible", () => {
    // Un flutter no tiene PR. `null` no es lo mismo que «todavia no medido»:
    // el inspector debe poder distinguir el hueco declarado del vacio inicial.
    const fake = attachedRuntime();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "measurements",
        t_s: 10,
        window_s: 10,
        values: { pr_ms: null, qrs_ms: 90 },
      }),
    });

    expect(useSessionStore.getState().measurements?.pr_ms).toBeNull();
  });

  it("un ritmo nuevo descarta las medidas del anterior", () => {
    // Sin esto el PR del ritmo saliente convive con el trazado del entrante
    // hasta la primera medida nueva, un segundo despues.
    const fake = attachedRuntime();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "measurements",
        t_s: 10,
        window_s: 10,
        values: { pr_ms: 160 },
      }),
    });
    expect(useSessionStore.getState().measurements).not.toBeNull();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "33333333-3333-3333-3333-333333333333",
        seed: 7,
        sample_rate_hz: 500,
        channels: 12,
      }),
    });

    expect(useSessionStore.getState().measurements).toBeNull();
  });
});


describe("el acuse de arranque", () => {
  const PARAMS = (heartRateHz: number) => ({
    heart_rate_hz: heartRateHz,
    noise: { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null },
    variability: {
      respiration_hz: 0.25,
      rsa_fraction: 0.04,
      amplitude_fraction: 0.03,
      rr_jitter_fraction: 0.015,
    },
    axis: {
      orientation_deg: 50,
      p_offset_deg: 3.4,
      qrs_offset_deg: 0,
      st_offset_deg: 0,
      t_offset_deg: 0,
    },
  });

  it("sustituye los parametros del ritmo anterior", () => {
    // El pulso de un bloqueo completo no es el de la taquicardia que se acaba
    // de dejar atras. Sin esto, el panel seguia ensenando el numero viejo
    // hasta que alguien tocara un control.
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    fake.dispatch("open", {});

    fake.dispatch("message", {
      data: JSON.stringify({ type: "updated", params: PARAMS(3.0) }),
    });
    expect(useSessionStore.getState().params?.heart_rate_hz).toBeCloseTo(3.0);

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "33333333-3333-3333-3333-333333333333",
        seed: 7,
        sample_rate_hz: 500,
        channels: 12,
        params: PARAMS(40 / 60),
      }),
    });
    expect(useSessionStore.getState().params?.heart_rate_hz).toBeCloseTo(40 / 60);
  });
});
