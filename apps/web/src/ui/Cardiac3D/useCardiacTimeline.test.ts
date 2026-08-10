import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCardiacTimeline } from "./useCardiacTimeline";
import { SessionRuntime } from "../../simulation-runtime/session-runtime";
import type {
  CardiacEventsMessage,
  HeartStateMessage,
} from "../../types/ws-messages";

function makeRuntime(): SessionRuntime {
  // No se conecta: los tests emiten a mano sobre el emisor, que es la
  // superficie que el hook consume.
  return new SessionRuntime("ws://localhost:0", () => ({}) as WebSocket);
}

const EVENTS: CardiacEventsMessage = {
  type: "cardiac_events",
  t_start_s: 1,
  t_end_s: 1.25,
  events: [
    {
      chamber: "ventricles",
      t_start_s: 1.0,
      t_peak_s: 1.15,
      t_end_s: 1.4,
      amplitude: 1,
      index: 0,
    },
  ],
};

const STATE: HeartStateMessage = {
  type: "heart_state",
  values: {
    rhythm_id: "sinus_normal",
    heart_rate_bpm: 72,
    atrial_mode: "synchronous",
    ventricular_mode: "synchronous",
    atrial_amplitude: 1,
    ventricular_amplitude: 1,
    flutter_hz: 5,
  },
};

describe("useCardiacTimeline", () => {
  it("empieza con la timeline vacía y sin estado", () => {
    const runtime = makeRuntime();

    const { result } = renderHook(() => useCardiacTimeline(runtime));

    expect(result.current.timeline.current.size).toBe(0);
    expect(result.current.heartState).toBeNull();
  });

  it("encola los eventos que llegan", () => {
    const runtime = makeRuntime();
    const { result } = renderHook(() => useCardiacTimeline(runtime));

    act(() => runtime.emit("cardiacEvents", EVENTS));

    expect(result.current.timeline.current.size).toBe(1);
  });

  it("guarda el último estado recibido", () => {
    const runtime = makeRuntime();
    const { result } = renderHook(() => useCardiacTimeline(runtime));

    act(() => runtime.emit("heartState", STATE));

    expect(result.current.heartState?.rhythm_id).toBe("sinus_normal");
  });

  it("vacía la timeline al arrancar una sesión nueva", () => {
    const runtime = makeRuntime();
    const { result } = renderHook(() => useCardiacTimeline(runtime));
    act(() => runtime.emit("cardiacEvents", EVENTS));

    act(() =>
      runtime.emit("started", {
        type: "started",
        session_id: "s",
        seed: 1,
        sample_rate_hz: 500,
        channels: 12,
      })
    );

    expect(result.current.timeline.current.size).toBe(0);
  });

  it("se desuscribe al desmontar", () => {
    const runtime = makeRuntime();
    const { result, unmount } = renderHook(() => useCardiacTimeline(runtime));
    const timeline = result.current.timeline.current;

    unmount();
    runtime.emit("cardiacEvents", EVENTS);

    expect(timeline.size).toBe(0);
  });
});
