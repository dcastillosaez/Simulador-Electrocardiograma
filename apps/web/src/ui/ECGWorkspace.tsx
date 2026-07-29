import { useEffect, useMemo, useRef, useState } from "react";
import { SessionRuntime } from "../simulation-runtime/session-runtime";
import { CatalogClient } from "../simulation-runtime/catalog-client";
import { useSessionStore } from "../state/session-store";
import { RhythmSelector } from "./RhythmSelector";
import { LayoutPicker } from "./LayoutPicker";
import { BasicControlPanel } from "./BasicControlPanel";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import { leadsForLayout, leadIndex, type LayoutId } from "../render/layout";
import { drawGrid } from "../render/grid-layer";
import { drawLeadTrace } from "../render/lead-canvas";
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
  const [isUnderrun, setIsUnderrun] = useState(false);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
      // Underrun: el trazo se congela (no se redibuja con muestras nuevas,
      // simplemente no hay ninguna que dibujar) y se muestra el indicador.
      // Nunca se interpola — es justo lo que "congelar en la última
      // muestra" significa: no tocar el canvas en absoluto este tick.
      setIsUnderrun(runtime.buffer.isUnderrun);
      if (runtime.buffer.isUnderrun) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
      for (const lead of leadsForLayout(layout)) {
        const canvas = canvasRefs.current[lead];
        const ctx = canvas?.getContext("2d");
        if (ctx && canvas) {
          const samples = runtime.buffer.getVisibleSamples(leadIndex(lead));
          drawLeadTrace(
            ctx,
            samples,
            sampleRateHz,
            { paperSpeedMmS: PAPER_SPEED_MM_S, gainMmPerMv: GAIN_MM_PER_MV },
            canvas.height
          );
        }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [runtime, layout, store.sampleRateHz]);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) drawGrid(ctx, canvas.width, canvas.height);
  }, [layout]);

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
      {isUnderrun && store.connectionState === "running" && (
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
            ref={(el) => {
              canvasRefs.current[lead] = el;
            }}
            width={800}
            height={100}
          />
        ))}
      </div>
    </div>
  );
}
