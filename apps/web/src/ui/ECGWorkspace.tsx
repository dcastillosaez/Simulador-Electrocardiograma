import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  Badge,
  Header,
  Inspector,
  Metric,
  MetricGrid,
  Panel,
  SectionTitle,
  SegmentedControl,
  Sidebar,
  StatusBar,
  Tooltip,
} from "@ui-system";
import { getTheme, setTheme, type ThemeName } from "@ui-system/themes/index";
import { SessionRuntime } from "../simulation-runtime/session-runtime";
import { CatalogClient } from "../simulation-runtime/catalog-client";
import { useSessionStore } from "../state/session-store";
import { RhythmSelector } from "./RhythmSelector";
import { LayoutPicker } from "./LayoutPicker";
import { BasicControlPanel } from "./BasicControlPanel";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import { EcgDisplay } from "./EcgDisplay";
import { useLayoutMetrics } from "./hooks/useLayoutMetrics";
import { useSimulationRuntime } from "./hooks/useSimulationRuntime";
import { useSweepRenderer } from "./hooks/useSweepRenderer";
import { leadsForLayout, type LayoutId } from "../render/layout";
import type { Compression } from "../render/layout-engine";
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

const THEME_OPTIONS: Array<{ value: ThemeName; label: string }> = [
  { value: "dark", label: "Monitor" },
  { value: "light", label: "Papel" },
];

/** El indicador es clínico, no técnico: en pantalla no aparece nunca un
 * "46 px/tira", porque ni el médico ni el alumno saben qué hacer con ese
 * número. La explicación va en el tooltip. */
const COMPRESSION_LABEL: Record<Compression, string> = {
  normal: "Normal",
  compact: "Vista compacta",
  "very-compact": "Vista muy compacta",
};
const COMPRESSION_TONE = {
  normal: "ok",
  compact: "warning",
  "very-compact": "critical",
} as const;
const COMPRESSION_HINT =
  "Altura disponible insuficiente para la representación óptima de 12 derivaciones.";

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
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const leads = useMemo(() => leadsForLayout(layout), [layout]);
  const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
  const theme = getTheme(themeName);

  useSimulationRuntime(runtime);

  const { containerRef, metrics, widthPx } = useLayoutMetrics({
    leadCount: leads.length,
    clinicalGainMmPerMv: GAIN_MM_PER_MV,
    paperSpeedMmS: PAPER_SPEED_MM_S,
  });

  const { registerTrace, registerGrid, isAwaitingSignal } = useSweepRenderer({
    runtime,
    leads,
    sampleRateHz,
    metrics,
    widthPx,
    theme,
  });

  // El CSS toma su juego de custom properties del atributo del elemento raíz.
  useEffect(() => {
    setTheme(themeName);
  }, [themeName]);

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

  const currentParams =
    store.params ??
    (selectedRhythm
      ? {
          heart_rate_hz: selectedRhythm.default_parameters.heart_rate_hz,
          noise: SILENT_NOISE,
          variability: DEFAULT_VARIABILITY,
        }
      : null);

  const bpm = currentParams ? Math.round(currentParams.heart_rate_hz * 60) : null;

  /** Una medida del servidor, lista para pasar a `Metric`.
   *
   * Tres estados distintos, y los tres importan: todavía no ha llegado
   * ninguna medida, ha llegado pero este ritmo no la tiene (un flutter no
   * tiene PR), o hay número. Los dos primeros se pintan igual —hueco— pero
   * por motivos distintos, y confundirlos sería decir que algo falló cuando
   * solo es que no existe. */
  const measured = (key: string) => {
    const value = store.measurements?.[key];
    return value === undefined || value === null
      ? { value: "", unavailable: true as const }
      : { value: String(Math.round(value)), unavailable: false as const };
  };

  return (
    <AppShell
      header={
        <Header title="Simulador de electrocardiograma">
          {/* LayoutPicker y no un SegmentedControl inline: el array de opciones
              vive en un solo sitio y el componente sigue teniendo su test. */}
          <LayoutPicker value={layout} onChange={setLayout} />
          <SegmentedControl
            label="Aspecto"
            value={themeName}
            options={THEME_OPTIONS}
            onChange={setThemeName}
          />
        </Header>
      }
      sidebar={
        // El Panel va DENTRO del Sidebar y no en su lugar: `Sidebar` es quien
        // aporta el landmark `complementary` con nombre, y sin el envoltorio
        // un lector de pantalla pierde la zona entera.
        <Sidebar>
          <Panel>
            <SectionTitle>Paciente</SectionTitle>
            <RhythmSelector
              catalogClient={catalogClient}
              selectedRhythmId={store.selectedRhythmId}
              onSelect={handleRhythmSelect}
            />
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
          </Panel>
        </Sidebar>
      }
      ecg={
        <EcgDisplay
          containerRef={containerRef}
          leads={leads}
          metrics={metrics}
          widthPx={widthPx}
          registerTrace={registerTrace}
          registerGrid={registerGrid}
        />
      }
      inspector={
        <Inspector>
          <Panel>
            <SectionTitle>Información</SectionTitle>
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
            <MetricGrid>
              <Metric
                label="Ritmo"
                value={selectedRhythm?.display_name ?? ""}
                unavailable={!selectedRhythm}
              />
              <Metric label="FC" value={bpm === null ? "" : String(bpm)} unit="lpm" unavailable={bpm === null} />
              {/* Los intervalos los mide el servidor sobre la señal realmente
                  generada, no sobre los valores nominales del ritmo: son los
                  del trazado que se está viendo. */}
              <Metric label="PR" unit="ms" {...measured("pr_ms")} />
              <Metric label="QRS" unit="ms" {...measured("qrs_ms")} />
              <Metric label="QT" unit="ms" {...measured("qt_ms")} />
              {/* QTc por Bazett. Se marca en el rótulo porque hay varias
                  fórmulas y dan números distintos: un QTc sin apellido es un
                  número sin unidades. */}
              <Metric label="QTc (B)" unit="ms" {...measured("qtc_ms")} />
              <Metric label="RR" unit="ms" {...measured("rr_ms")} />
            </MetricGrid>
          </Panel>
        </Inspector>
      }
      status={
        <StatusBar>
          <span>{store.connectionState}</span>
          <span>{sampleRateHz} Hz</span>
          <span>{GAIN_MM_PER_MV} mm/mV</span>
          <span>{PAPER_SPEED_MM_S} mm/s</span>
          <span>Frames perdidos {store.framesLost}</span>
          <Tooltip content={COMPRESSION_HINT}>
            <Badge tone={COMPRESSION_TONE[metrics.compression]}>
              {COMPRESSION_LABEL[metrics.compression]}
            </Badge>
          </Tooltip>
        </StatusBar>
      }
    />
  );
}
