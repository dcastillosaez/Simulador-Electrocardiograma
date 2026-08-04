import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppShell,
  Badge,
  Header,
  IconButton,
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
import { AxisControl } from "./AxisControl";
import { zoneFor, ZONE_LABEL } from "./AxisControl/axis-zones";
import { EcgDisplay } from "./EcgDisplay";
import { useLayoutMetrics } from "./hooks/useLayoutMetrics";
import { useSimulationRuntime } from "./hooks/useSimulationRuntime";
import { useSweepRenderer } from "./hooks/useSweepRenderer";
import { formatClock, useClock } from "./hooks/useClock";
import { useExport } from "./hooks/useExport";
import {
  columnsForLayout,
  leadColumnsForLayout,
  rowsForLayout,
  type LayoutId,
} from "../render/layout";
import {
  GAIN_STEPS_MM_PER_MV,
  type Compression,
  type GainSetting,
} from "../render/layout-engine";
import type { RhythmDetail } from "../types/rhythms";
import styles from "./ECGWorkspace.module.css";

const DEFAULT_VARIABILITY = {
  respiration_hz: 0.25,
  rsa_fraction: 0.04,
  amplitude_fraction: 0.03,
  rr_jitter_fraction: 0.015,
};
const SILENT_NOISE = { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null };
const DEFAULT_AXIS = {
  orientation_deg: 50,
  p_offset_deg: 3.4,
  qrs_offset_deg: 0,
  st_offset_deg: 0,
  t_offset_deg: 0,
};
const DEFAULT_SAMPLE_RATE_HZ = 500;
const PAPER_SPEED_MM_S = 25;

const THEME_OPTIONS: Array<{ value: ThemeName; label: string }> = [
  { value: "dark", label: "Monitor" },
  { value: "light", label: "Papel" },
];

/** El valor viaja como texto porque un `SegmentedControl` es un grupo de
 * radios y el `value` de un radio siempre es una cadena. Se traduce en el
 * unico sitio donde se lee. */
const GAIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto" },
  ...GAIN_STEPS_MM_PER_MV.map((gain) => ({
    value: String(gain),
    label: String(gain),
  })),
];

function parseGain(value: string): GainSetting {
  return value === "auto" ? "auto" : Number(value);
}

const GAIN_HINT =
  "Ganancia vertical en mm/mV. En automatico se elige la mayor que quepa, " +
  "igual que en un electrocardiografo. La velocidad del papel no cambia nunca.";
const GAIN_CLIPPING_HINT =
  "La ganancia elegida no cabe en el alto de tira disponible: el trazo puede " +
  "recortarse. Baja la ganancia o muestra menos derivaciones.";

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
  const [gain, setGain] = useState<GainSetting>("auto");
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const leadColumns = useMemo(() => leadColumnsForLayout(layout), [layout]);
  const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
  const theme = getTheme(themeName);

  useSimulationRuntime(runtime);

  const { containerRef, metrics } = useLayoutMetrics({
    rowCount: rowsForLayout(layout),
    columnCount: columnsForLayout(layout),
    gain,
    paperSpeedMmS: PAPER_SPEED_MM_S,
  });

  const { registerTrace, registerGrid, isAwaitingSignal, composeSnapshot } = useSweepRenderer({
    runtime,
    leadColumns,
    sampleRateHz,
    metrics,
    theme,
  });

  const now = useClock();
  const clock = formatClock(now);

  // El sello va DENTRO del PNG, no solo en el nombre del fichero: un fichero
  // se renombra y la imagen se queda sin fecha.
  const snapshotWithStamp = useCallback(
    () => composeSnapshot({ stamp: clock }),
    [composeSnapshot, clock]
  );
  const { exportPng, toggleRecording, isRecording, exportError } = useExport({
    composeSnapshot: snapshotWithStamp,
  });

  const isPaused = store.connectionState === "paused";
  const hasSession = store.connectionState === "running" || isPaused;

  const togglePause = () => {
    if (isPaused) runtime.resume();
    else runtime.pause();
  };

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
      axis: DEFAULT_AXIS,
    });
  };

  const currentParams =
    store.params ??
    (selectedRhythm
      ? {
          heart_rate_hz: selectedRhythm.default_parameters.heart_rate_hz,
          noise: SILENT_NOISE,
          variability: DEFAULT_VARIABILITY,
          axis: DEFAULT_AXIS,
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
          <Tooltip content={GAIN_HINT}>
            <SegmentedControl
              label="Ganancia"
              value={gain === "auto" ? "auto" : String(gain)}
              options={GAIN_OPTIONS}
              onChange={(value) => setGain(parseGain(value))}
            />
          </Tooltip>
          {/* "Congelar" y no "Pausa": lo que el usuario quiere no es detener
              un vídeo, es parar el barrido para poder leer el trazado. El
              texto del botón dice lo que hace, no cómo está implementado. */}
          <IconButton
            icon={isPaused ? "play" : "pause"}
            label={isPaused ? "Reanudar" : "Congelar"}
            onClick={togglePause}
            disabled={!hasSession}
            active={isPaused}
          />
          <IconButton icon="download" label="PNG" onClick={exportPng} />
          <IconButton
            icon={isRecording ? "stop" : "ecg"}
            label={isRecording ? "Detener" : "Grabar"}
            onClick={toggleRecording}
            active={isRecording}
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
            {selectedRhythm && currentParams && (
              <>
                <SectionTitle>Eje eléctrico</SectionTitle>
                <AxisControl
                  valueDeg={currentParams.axis.orientation_deg}
                  min={selectedRhythm.editable_parameters.orientation_deg.minimum}
                  max={selectedRhythm.editable_parameters.orientation_deg.maximum}
                  referenceDeg={selectedRhythm.editable_parameters.orientation_deg.default}
                  onChange={(orientation_deg) =>
                    runtime.update({
                      ...currentParams,
                      axis: { ...currentParams.axis, orientation_deg },
                    })
                  }
                />
              </>
            )}
          </Panel>
        </Sidebar>
      }
      ecg={
        <EcgDisplay
          containerRef={containerRef}
          leadColumns={leadColumns}
          metrics={metrics}
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
            {/* Solo mientras corre: en pausa el buffer se vacía a propósito, y
                anunciar "Esperando señal" ahí convertiría una acción
                deliberada del usuario en lo que parece una avería de red. */}
            {isAwaitingSignal && store.connectionState === "running" && (
              <p role="status">Esperando señal…</p>
            )}
            {isPaused && <p role="status">Trazado congelado</p>}
            {/* Solo puede pasar con ganancia fijada a mano: en automatico se
                elige precisamente la que cabe. El usuario manda, pero se le
                dice lo que va a ver y como arreglarlo. */}
            {!metrics.gainFits && <p role="status">{GAIN_CLIPPING_HINT}</p>}
            {exportError && <p role="alert">{exportError}</p>}
            <MetricGrid>
              <Metric
                label="Ritmo"
                value={selectedRhythm?.display_name ?? ""}
                unavailable={!selectedRhythm}
              />
              <Metric label="FC" value={bpm === null ? "" : String(bpm)} unit="lpm" unavailable={bpm === null} />
              <Metric
                label="Eje"
                value={
                  currentParams
                    ? `${Math.round(currentParams.axis.orientation_deg)}° ${ZONE_LABEL[zoneFor(currentParams.axis.orientation_deg)]}`
                    : ""
                }
                unavailable={!currentParams}
              />
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
          {/* La ganancia efectiva, siempre visible y con su origen: un ECG a
              media ganancia que no lo declare se lee mal, porque el QRS
              parece la mitad de alto de lo que es. */}
          <span>
            {metrics.clinicalGainMmPerMv} mm/mV{metrics.gainIsAuto ? " (auto)" : ""}
          </span>
          <span>{PAPER_SPEED_MM_S} mm/s</span>
          {/* Los segundos por tira son la lectura que importa: en el formato
              partido cada una muestra la mitad, y no decirlo llevaria a contar
              mal un intervalo largo. */}
          <span>{metrics.stripSeconds} s/tira</span>
          <span>Frames perdidos {store.framesLost}</span>
          <Tooltip content={COMPRESSION_HINT}>
            <Badge tone={COMPRESSION_TONE[metrics.compression]}>
              {COMPRESSION_LABEL[metrics.compression]}
            </Badge>
          </Tooltip>
          {/* Empujado al extremo derecho. La hora de un registro clínico no es
              decoración: una tira sin sello temporal no se puede situar
              después en la historia de nadie. */}
          <time className={styles.clock} dateTime={now.toISOString()}>
            {clock}
          </time>
        </StatusBar>
      }
    />
  );
}
