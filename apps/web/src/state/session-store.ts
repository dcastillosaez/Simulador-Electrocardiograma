import { create } from "zustand";
import type {
  SessionRuntime,
  SessionRuntimeEvents,
  SessionState,
} from "../simulation-runtime/session-runtime";
import type { EngineParamsPayload } from "../types/engine-params";
import type {
  ActiveDrug,
  DrugAdministrationRecord,
  FiredInteraction,
} from "../types/drugs";

export interface SessionStoreState {
  connectionState: SessionState;
  sessionId: string | null;
  seed: number | null;
  sampleRateHz: number | null;
  selectedRhythmId: string | null;
  params: EngineParamsPayload | null;
  lastError: { code: string; detail: string } | null;
  framesLost: number;
  /** Ultimas medidas publicadas por el servidor. `null` mientras no ha
   * llegado ninguna; dentro, un valor `null` significa «no medible en este
   * ritmo», que no es lo mismo que «todavia no medido». */
  measurements: Record<string, number | null> | null;

  /** Farmacos vivos ahora mismo, tal y como los publica el servidor a 1 Hz.
   * Vacio no significa «todavia no ha llegado nada»: significa que no hay
   * ninguno activo, que es el estado normal de una sesion sin medicar. */
  activeDrugs: ActiveDrug[];
  /** Interacciones que se estan disparando. La interfaz las muestra para
   * que el alumno sepa por que el ECG hace lo que hace. */
  interactions: FiredInteraction[];
  /** Estado fisiologico completo: lo que `EngineParams` no sabe representar
   * —PR, QRS, QT, contractilidad, presion, gasto— y que el panel de
   * constantes y el corazon 3D consumen. `null` hasta la primera
   * publicacion. */
  physiology: Record<string, number> | null;
  /** El registro de administraciones de la sesion en curso, en orden. No se
   * poda al agotarse un farmaco: es registro clinico. */
  administrations: DrugAdministrationRecord[];

  selectRhythm: (rhythmId: string) => void;
  /** Devuelve una función `detach()` que retira exactamente los listeners
   * que esta llamada registró. Sin ella, un componente que vuelva a llamar
   * `attachRuntime` sobre la MISMA instancia de `SessionRuntime` (p. ej.
   * React StrictMode, que en desarrollo monta→limpia→monta el mismo
   * efecto sin recrear las dependencias) duplicaría cada listener —
   * `framesLost` llegaría a contar el doble de tramas perdidas de las
   * reales. */
  attachRuntime: (runtime: SessionRuntime) => () => void;
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
  measurements: null,
  activeDrugs: [],
  interactions: [],
  physiology: null,
  administrations: [],

  selectRhythm: (rhythmId) => set({ selectedRhythmId: rhythmId }),

  attachRuntime: (runtime) => {
    const onConnected = () => set({ connectionState: "connected" });
    const onDisconnected = () =>
      set({ connectionState: "idle", sessionId: null, seed: null, sampleRateHz: null });
    const onStarted = (message: SessionRuntimeEvents["started"]) =>
      set({
        connectionState: "running",
        sessionId: message.session_id,
        seed: message.seed,
        sampleRateHz: message.sample_rate_hz,
        lastError: null,
        framesLost: 0,
        // Un ritmo nuevo invalida las medidas del anterior: dejarlas
        // visibles mostraria el PR del ritmo saliente junto al trazado del
        // entrante hasta la primera medida nueva, un segundo despues.
        measurements: null,
        // Un `start` es una sesion nueva: no puede heredar la adrenalina de
        // la anterior, igual que no hereda sus medidas.
        activeDrugs: [],
        interactions: [],
        physiology: null,
        administrations: [],
      });
    const onUpdated = (message: SessionRuntimeEvents["updated"]) =>
      set({ params: message.params });
    const onPaused = () => set({ connectionState: "paused" });
    const onResumed = () => set({ connectionState: "running" });
    const onStopped = () => set({ connectionState: "stopped" });
    const onMeasurements = (message: SessionRuntimeEvents["measurements"]) =>
      set({ measurements: message.values });
    const onPharmacology = (message: SessionRuntimeEvents["pharmacology"]) =>
      set({
        activeDrugs: message.active,
        interactions: message.interactions,
        physiology: message.physiology,
      });
    const onAdministered = (message: SessionRuntimeEvents["administered"]) =>
      set((state) => ({
        administrations: [...state.administrations, message.administration],
      }));
    const onError = (message: SessionRuntimeEvents["error"]) =>
      set({ lastError: { code: message.code, detail: message.detail } });
    const onFrameMeta = (meta: SessionRuntimeEvents["frameMeta"]) => {
      if (meta.lost) {
        set((state) => ({ framesLost: state.framesLost + 1 }));
      }
    };

    runtime.on("connected", onConnected);
    runtime.on("disconnected", onDisconnected);
    runtime.on("started", onStarted);
    runtime.on("updated", onUpdated);
    runtime.on("paused", onPaused);
    runtime.on("resumed", onResumed);
    runtime.on("stopped", onStopped);
    runtime.on("measurements", onMeasurements);
    runtime.on("pharmacology", onPharmacology);
    runtime.on("administered", onAdministered);
    runtime.on("error", onError);
    runtime.on("frameMeta", onFrameMeta);

    return () => {
      runtime.off("connected", onConnected);
      runtime.off("disconnected", onDisconnected);
      runtime.off("started", onStarted);
      runtime.off("updated", onUpdated);
      runtime.off("paused", onPaused);
      runtime.off("resumed", onResumed);
      runtime.off("stopped", onStopped);
      runtime.off("measurements", onMeasurements);
      runtime.off("pharmacology", onPharmacology);
      runtime.off("administered", onAdministered);
      runtime.off("error", onError);
      runtime.off("frameMeta", onFrameMeta);
    };
  },
}));
