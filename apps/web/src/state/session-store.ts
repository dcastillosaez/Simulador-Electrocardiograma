import { create } from "zustand";
import type { SessionRuntime, SessionState } from "../simulation-runtime/session-runtime";
import type { EngineParamsPayload } from "../types/engine-params";

export interface SessionStoreState {
  connectionState: SessionState;
  sessionId: string | null;
  seed: number | null;
  sampleRateHz: number | null;
  selectedRhythmId: string | null;
  params: EngineParamsPayload | null;
  lastError: { code: string; detail: string } | null;
  framesLost: number;

  selectRhythm: (rhythmId: string) => void;
  attachRuntime: (runtime: SessionRuntime) => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  connectionState: "idle",
  sessionId: null,
  seed: null,
  sampleRateHz: null,
  selectedRhythmId: null,
  params: null,
  lastError: null,
  framesLost: 0,

  selectRhythm: (rhythmId) => set({ selectedRhythmId: rhythmId }),

  attachRuntime: (runtime) => {
    runtime.on("connected", () => set({ connectionState: "connected" }));
    runtime.on("disconnected", () =>
      set({ connectionState: "idle", sessionId: null, seed: null, sampleRateHz: null })
    );
    runtime.on("started", (message) =>
      set({
        connectionState: "running",
        sessionId: message.session_id,
        seed: message.seed,
        sampleRateHz: message.sample_rate_hz,
        lastError: null,
        framesLost: 0,
      })
    );
    runtime.on("updated", (message) => set({ params: message.params }));
    runtime.on("paused", () => set({ connectionState: "paused" }));
    runtime.on("resumed", () => set({ connectionState: "running" }));
    runtime.on("stopped", () => set({ connectionState: "stopped" }));
    runtime.on("error", (message) =>
      set({ lastError: { code: message.code, detail: message.detail } })
    );
    runtime.on("frameMeta", (meta) => {
      if (meta.lost) {
        set((state) => ({ framesLost: state.framesLost + 1 }));
      }
    });
  },
}));
