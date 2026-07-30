import { useEffect, useMemo, useRef, useState } from "react";
import { SessionRuntime } from "../simulation-runtime/session-runtime";
import { CatalogClient } from "../simulation-runtime/catalog-client";
import { useSessionStore } from "../state/session-store";
import { RhythmSelector } from "./RhythmSelector";
import { LayoutPicker } from "./LayoutPicker";
import { BasicControlPanel } from "./BasicControlPanel";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import { leadsForLayout, leadIndex, type LayoutId, type LeadName } from "../render/layout";
import { drawGrid, voltageToPx, PX_PER_MM } from "../render/grid-layer";
import { drawSweepSegment } from "../render/lead-canvas";
import { SweepBuffer, sweepCapacitySamples } from "../render/sweep-buffer";
import type { RhythmDetail } from "../types/rhythms";

const DEFAULT_VARIABILITY = {
  respiration_hz: 0.25,
  rsa_fraction: 0.04,
  amplitude_fraction: 0.03,
  rr_jitter_fraction: 0.015,
};
const SILENT_NOISE = { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null };
const DEFAULT_SAMPLE_RATE_HZ = 500;
const PAPER_SPEED_MM_S = 25;
const GAIN_MM_PER_MV = 10;
const CANVAS_WIDTH_PX = 800;

// V5 es la derivacion con mayor coeficiente de proyeccion del motor
// (packages/ecg-engine/src/ecg_engine/leads.py, V5 = 1.30): su onda R nominal
// ya vale ~1.3x R_WAVE_V (~1mV). Con 100px de alto (gain 10mm/mV) el borde
// del canvas caia en ~1.32mV desde la linea base, así que ruido leve o la
// propia variabilidad de amplitud bastaban para recortar V4/V5 contra el
// borde. STRIP_MARGIN_MV fija cuanto margen queda por encima y por debajo de
// la linea base tras la R mas alta esperada, y de ahí sale el alto real.
const STRIP_MARGIN_V = 0.002; // 2mV de margen a cada lado de la base
const STRIP_HEIGHT_PX = Math.ceil(2 * voltageToPx(STRIP_MARGIN_V, GAIN_MM_PER_MV));

export interface ECGWorkspaceProps {
  wsUrl: string;
  apiBaseUrl: string;
  webSocketFactory?: (url: string) => WebSocket;
}

export function ECGWorkspace({ wsUrl, apiBaseUrl, webSocketFactory }: ECGWorkspaceProps) {
  const runtime = useMemo(
    () => new SessionRuntime(wsUrl, webSocketFactory),
    [wsUrl, webSocketFactory]
  );
  const catalogClient = useMemo(() => new CatalogClient({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  const store = useSessionStore();

  const [selectedRhythm, setSelectedRhythm] = useState<RhythmDetail | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [layout, setLayout] = useState<LayoutId>("6");
  const [isAwaitingSignal, setIsAwaitingSignal] = useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sweepBuffersRef = useRef<Map<LeadName, SweepBuffer>>(new Map());

  const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;

  // Un anillo de barrido por derivación activa, dimensionado a los segundos
  // de papel que caben en el ancho del canvas (~8,5s con los valores por
  // defecto) — NO al buffer de jitter de red, que es dos órdenes de magnitud
  // menor. Se recrea si cambia el layout o la frecuencia de muestreo.
  useEffect(() => {
    const capacity = sweepCapacitySamples(
      CANVAS_WIDTH_PX,
      PAPER_SPEED_MM_S * PX_PER_MM,
      sampleRateHz
    );
    const buffers = new Map<LeadName, SweepBuffer>();
    for (const lead of leadsForLayout(layout)) {
      buffers.set(lead, new SweepBuffer(capacity));
    }
    sweepBuffersRef.current = buffers;
  }, [layout, sampleRateHz]);

  // Al arrancar una sesión (ritmo nuevo o reinicio con otro session_id) el
  // eje de tiempo empieza de cero: se vacían los anillos y se limpian los
  // canvas para no dejar el trazo del ritmo anterior conviviendo en pantalla
  // con el nuevo.
  useEffect(() => {
    const onStarted = () => {
      for (const sweep of sweepBuffersRef.current.values()) {
        sweep.reset();
      }
      for (const canvas of Object.values(canvasRefs.current)) {
        const ctx = canvas?.getContext("2d");
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    runtime.on("started", onStarted);
    return () => runtime.off("started", onStarted);
  }, [runtime]);

  useEffect(() => {
    // `attachRuntime` devuelve `detach`: sin desuscribir en el cleanup,
    // React StrictMode (monta→limpia→monta el mismo efecto en dev, sin
    // recrear `runtime`) reataca los mismos listeners sobre la misma
    // instancia y duplica los eventos — `framesLost` contaría el doble.
    const detach = useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    return () => {
      detach();
      runtime.disconnect();
    };
  }, [runtime]);

  useEffect(() => {
    let frameId: number;
    let lastS: number | undefined;
    const tick = (nowMs: number) => {
      const nowS = nowMs / 1000;
      const elapsedS = lastS === undefined ? 0 : nowS - lastS;
      lastS = nowS;

      runtime.buffer.advance(elapsedS);
      // Se dibuja lo que advance() haya liberado ESTE tick, aunque el buffer
      // haya quedado vacío al hacerlo — si no, el último trozo consumido
      // antes de un underrun se perdería sin llegar a pintarse. Con cero
      // muestras nuevas, drawSweepSegment no toca el canvas: el trazo se
      // congela en la última muestra, sin interpolar jamás.
      //
      // El hueco (pérdida de red o descarte por overrun) es el mismo para
      // las doce derivaciones -- viene del mismo trozo multicanal -- así que
      // se lee una sola vez por tick, no por derivación.
      const hadGap = runtime.buffer.justConsumedHadGap;
      for (const lead of leadsForLayout(layout)) {
        const canvas = canvasRefs.current[lead];
        const ctx = canvas?.getContext("2d");
        const sweep = sweepBuffersRef.current.get(lead);
        if (ctx && canvas && sweep) {
          const samples = runtime.buffer.consumeNewSamples(leadIndex(lead));
          drawSweepSegment(
            ctx,
            sweep,
            samples,
            sampleRateHz,
            { paperSpeedMmS: PAPER_SPEED_MM_S, gainMmPerMv: GAIN_MM_PER_MV },
            canvas.height,
            hadGap
          );
        }
      }
      // "Esperando señal" cubre los dos motivos opuestos de no reproducir:
      // no queda nada (underrun) o aún no hay reserva suficiente (pre-roll).
      setIsAwaitingSignal(runtime.buffer.isUnderrun || !runtime.buffer.isPreRolled);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [runtime, layout, sampleRateHz]);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) drawGrid(ctx, canvas.width, canvas.height);
  }, [layout]);

  useEffect(() => {
    if (store.connectionState === "connected" || store.connectionState === "running") {
      setHasConnectedOnce(true);
    }
  }, [store.connectionState]);

  const handleRhythmSelect = (rhythmId: string, detail: RhythmDetail) => {
    setSelectedRhythm(detail);
    store.selectRhythm(rhythmId);
    runtime.start(rhythmId, {
      heart_rate_hz: detail.default_parameters.heart_rate_hz,
      noise: SILENT_NOISE,
      variability: DEFAULT_VARIABILITY,
    });
  };

  const currentParams = store.params ?? (selectedRhythm
    ? { heart_rate_hz: selectedRhythm.default_parameters.heart_rate_hz, noise: SILENT_NOISE, variability: DEFAULT_VARIABILITY }
    : null);

  return (
    <div>
      <RhythmSelector
        catalogClient={catalogClient}
        selectedRhythmId={store.selectedRhythmId}
        onSelect={handleRhythmSelect}
      />
      <LayoutPicker value={layout} onChange={setLayout} />

      {store.lastError && (
        <p role="alert">
          {store.lastError.code}: {store.lastError.detail}
        </p>
      )}
      {hasConnectedOnce && store.connectionState === "idle" && (
        <p role="status">Desconectado</p>
      )}
      {isAwaitingSignal && store.connectionState === "running" && (
        <p role="status">Esperando señal…</p>
      )}

      {selectedRhythm && currentParams && (
        advancedMode ? (
          <AdvancedControlPanel
            noise={currentParams.noise}
            onChange={(noise) => runtime.update({ ...currentParams, noise })}
            onSwitchToBasic={() => setAdvancedMode(false)}
          />
        ) : (
          <BasicControlPanel
            heartRateHz={currentParams.heart_rate_hz}
            heartRateRange={selectedRhythm.editable_parameters.heart_rate_hz}
            noise={currentParams.noise}
            onHeartRateChange={(hz) => runtime.update({ ...currentParams, heart_rate_hz: hz })}
            onNoiseChange={(noise) => runtime.update({ ...currentParams, noise })}
            onSwitchToAdvanced={() => setAdvancedMode(true)}
          />
        )
      )}

      <div style={{ position: "relative" }}>
        <canvas ref={gridCanvasRef} width={800} height={600} style={{ position: "absolute" }} />
        {leadsForLayout(layout).map((lead) => (
          <canvas
            key={lead}
            data-testid={`lead-canvas-${lead}`}
            ref={(el) => {
              canvasRefs.current[lead] = el;
            }}
            width={800}
            height={STRIP_HEIGHT_PX}
          />
        ))}
      </div>
    </div>
  );
}
