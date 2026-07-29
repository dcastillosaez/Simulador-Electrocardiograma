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
