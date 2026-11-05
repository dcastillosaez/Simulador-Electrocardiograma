import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReview } from "./useReview";
import type { ReviewCursorHandle } from "./ReviewCursor";
import { PlaybackClock } from "../../cardiac/playback-clock";
import { ElectricalTimeline } from "../../cardiac/electrical-timeline";
import { SampleIndexRing } from "../../render/sample-index";
import { computeLayoutMetrics } from "../../render/layout-engine";
import { SweepRebuilder } from "../../render/sweep-rebuilder";
import { SessionRuntime } from "../../simulation-runtime/session-runtime";

const SAMPLE_RATE_HZ = 500;

function setup() {
  const sent: unknown[] = [];
  const socket = {
    send: (data: unknown) => sent.push(data),
    close: () => {},
    readyState: 1,
  } as unknown as WebSocket;
  const runtime = new SessionRuntime("ws://localhost:0", () => socket);
  // Diez segundos de papel, de t = 2 a t = 12.
  const ring = new SampleIndexRing(5000);
  const indices = new Float64Array(5000).map((_, i) => 1000 + i);
  ring.push(indices);
  const source = { sweeps: new Map(), indexRing: ring, capacity: ring.capacity };
  const clock = new PlaybackClock({ playbackTimeS: 11.9 });
  const electrical = { current: new ElectricalTimeline() };
  const placed: (number | null)[] = [];
  const cursor = { current: { place: (x: number | null) => placed.push(x) } } as {
    current: ReviewCursorHandle;
  };
  const metrics = computeLayoutMetrics({
    availableWidthPx: 1000,
    availableHeightPx: 600,
    rowCount: 6,
    columnCount: 1,
    gain: "auto",
    paperSpeedMmS: 25,
  });
  return { runtime, sent, source, clock, electrical, cursor, placed, metrics };
}

describe("useReview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("congelar abre el repaso en la cabeza y descongelar lo cierra", () => {
    const s = setup();
    const { result, rerender } = renderHook(
      ({ frozen }) =>
        useReview({
          runtime: s.runtime,
          frozen,
          clock: s.clock,
          electrical: s.electrical,
          getMeasureSource: () => s.source,
          sampleRateHz: SAMPLE_RATE_HZ,
          metrics: s.metrics,
          view: { startRingPos: 0, visibleSamples: 5000 },
          onFollow: () => {},
          cursor: s.cursor,
          timeLabel: createRef(),
          phaseLabel: createRef(),
          slider: createRef(),
        }),
      { initialProps: { frozen: false } }
    );
    expect(result.current.active).toBe(false);
    rerender({ frozen: true });
    expect(result.current.active).toBe(true);
    expect(result.current.history).toEqual({ startS: 2, endS: 11.998 });
    expect(s.clock.timeS).toBeCloseTo(11.9);
    rerender({ frozen: false });
    expect(result.current.active).toBe(false);
    expect(s.clock.reviewTimeS).toBeNull();
  });

  it("mover el cursor no manda nada al servidor ni repinta el trazado", () => {
    const s = setup();
    const advance = vi.spyOn(s.runtime.buffer, "advance");
    const rebuild = vi.spyOn(SweepRebuilder.prototype, "rebuild");
    const { result } = renderHook(() =>
      useReview({
        runtime: s.runtime,
        frozen: true,
        clock: s.clock,
        electrical: s.electrical,
        getMeasureSource: () => s.source,
        sampleRateHz: SAMPLE_RATE_HZ,
        metrics: s.metrics,
        view: { startRingPos: 0, visibleSamples: 5000 },
        onFollow: () => {},
        cursor: s.cursor,
        timeLabel: createRef(),
        phaseLabel: createRef(),
        slider: createRef(),
      })
    );
    act(() => result.current.seek(4));
    act(() => result.current.togglePlay());
    act(() => result.current.setSpeed(0.5));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => result.current.step(-1));
    expect(s.clock.timeS).toBeGreaterThan(4);
    expect(s.clock.timeS).toBeLessThan(4.6);
    expect(s.sent).toEqual([]);
    expect(advance).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
    // El cursor se ha colocado sobre el papel.
    expect(s.placed.some((x) => x !== null && x > 0)).toBe(true);
  });

  it("si los anillos se recrean, el repaso termina y vuelve a la cabeza", () => {
    const s = setup();
    let source = s.source;
    const { result } = renderHook(() =>
      useReview({
        runtime: s.runtime,
        frozen: true,
        clock: s.clock,
        electrical: s.electrical,
        getMeasureSource: () => source,
        sampleRateHz: SAMPLE_RATE_HZ,
        metrics: s.metrics,
        view: { startRingPos: 0, visibleSamples: 5000 },
        onFollow: () => {},
        cursor: s.cursor,
        timeLabel: createRef(),
        phaseLabel: createRef(),
        slider: createRef(),
      })
    );
    act(() => result.current.seek(5));
    const ring = new SampleIndexRing(10);
    ring.push(new Float64Array([1, 2]));
    source = { ...s.source, indexRing: ring };
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.active).toBe(false);
    expect(result.current.endReason).toBe("rings-recreated");
    expect(s.clock.timeS).toBeCloseTo(11.9);
  });

  it("con zoom, la ventana sigue al cursor cuando se sale", () => {
    const s = setup();
    const follow = vi.fn();
    const { result } = renderHook(() =>
      useReview({
        runtime: s.runtime,
        frozen: true,
        clock: s.clock,
        electrical: s.electrical,
        getMeasureSource: () => s.source,
        sampleRateHz: SAMPLE_RATE_HZ,
        metrics: s.metrics,
        view: { startRingPos: 0, visibleSamples: 1000 },
        onFollow: follow,
        cursor: s.cursor,
        timeLabel: createRef(),
        phaseLabel: createRef(),
        slider: createRef(),
      })
    );
    act(() => result.current.seek(8));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(follow).toHaveBeenCalled();
  });
});
