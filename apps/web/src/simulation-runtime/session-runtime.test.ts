import { describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "./session-runtime";
import { HEADER_SIZE_BYTES } from "./frame-decoder";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
  sentMessages: string[] = [];
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.dispatch("close", { code: 1000, reason: "" });
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }

  lastSentMessage(): unknown {
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]);
  }
}

function buildFrameBytes(options: {
  sequenceNumber: number;
  sessionIdBytes?: number[];
}): ArrayBuffer {
  const nChannels = 1;
  const nSamplesPerChannel = 2;
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES + nChannels * nSamplesPerChannel * 4);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 500, true);
  view.setUint8(4, nChannels);
  view.setUint8(5, 0);
  view.setUint16(6, nSamplesPerChannel, true);
  view.setUint32(8, options.sequenceNumber, true);
  view.setUint32(12, 0, true);
  view.setFloat64(16, 0, true);
  const sessionIdBytes = options.sessionIdBytes ?? new Array(16).fill(0xab);
  new Uint8Array(buffer, 24, 16).set(sessionIdBytes);
  view.setFloat32(HEADER_SIZE_BYTES, 0.1, true);
  view.setFloat32(HEADER_SIZE_BYTES + 4, 0.2, true);
  return buffer;
}

describe("SessionRuntime", () => {
  it("emite 'connected' y pasa a estado connected cuando el socket abre", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onConnected = vi.fn();
    runtime.on("connected", onConnected);

    runtime.connect();
    fake.dispatch("open", {});

    expect(onConnected).toHaveBeenCalled();
    expect(runtime.state).toBe("connected");
  });

  it("start() envia el mensaje 'start' con los campos documentados", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();

    runtime.start("sinus_normal", { heart_rate_hz: 70 / 60, noise: { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null }, variability: { respiration_hz: 0.25, rsa_fraction: 0.04, amplitude_fraction: 0.03, rr_jitter_fraction: 0.015 } }, 123);

    expect(fake.lastSentMessage()).toMatchObject({
      type: "start",
      rhythm_id: "sinus_normal",
      seed: 123,
    });
  });

  it("al recibir 'started' pasa a running y limpia el buffer", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onStarted = vi.fn();
    runtime.on("started", onStarted);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "11111111-1111-1111-1111-111111111111",
        seed: 1,
        sample_rate_hz: 500,
        channels: 12,
      }),
    });

    expect(runtime.state).toBe("running");
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "11111111-1111-1111-1111-111111111111" })
    );
    expect(runtime.buffer.isUnderrun).toBe(true);
  });

  it("decodifica frames binarios y los empuja al buffer", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();

    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 0 }) });

    expect(runtime.buffer.isUnderrun).toBe(false);
    const samples = Array.from(runtime.buffer.getVisibleSamples(0));
    expect(samples[0]).toBeCloseTo(0.1);
    expect(samples[1]).toBeCloseTo(0.2);
  });

  it("descarta un frame fuera de orden sin empujarlo al buffer", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();

    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 5 }) });
    const durationAfterFirst = runtime.buffer.bufferedDurationS;
    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 3 }) }); // fuera de orden

    expect(runtime.buffer.bufferedDurationS).toBe(durationAfterFirst);
  });

  it("marca frameMeta.lost=true cuando sequence_number salta hacia delante", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onFrameMeta = vi.fn();
    runtime.on("frameMeta", onFrameMeta);
    runtime.connect();

    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 0 }) });
    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 2 }) }); // se perdió el 1

    expect(onFrameMeta).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequenceNumber: 2, lost: true })
    );
  });

  it("emite 'error' al recibir un mensaje error del servidor", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onError = vi.fn();
    runtime.on("error", onError);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({ type: "error", code: "NOT_FOUND", detail: "ritmo desconocido" }),
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NOT_FOUND", detail: "ritmo desconocido" })
    );
  });

  it("al desconectar limpia el buffer y vuelve a idle, sin reconectar", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onDisconnected = vi.fn();
    runtime.on("disconnected", onDisconnected);
    runtime.connect();
    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 0 }) });

    fake.close();

    expect(runtime.state).toBe("idle");
    expect(runtime.buffer.isUnderrun).toBe(true);
    expect(onDisconnected).toHaveBeenCalled();
  });
});
