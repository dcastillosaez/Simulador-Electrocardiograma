import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell,
  Badge,
  Panel,
  SectionTitle,
  Sidebar,
  StatusBar,
  Tooltip,
} from "@ui-system";
import { getTheme, setTheme, type ThemeName } from "@ui-system/themes/index";
import { SessionRuntime } from "../simulation-runtime/session-runtime";
import { CatalogClient } from "../simulation-runtime/catalog-client";
import { describeClose } from "../simulation-runtime/close-reasons";
import { INTENDED_USE_FULL, INTENDED_USE_SHORT } from "./intended-use";
import { captureElement } from "../render/dom-snapshot";
import { useSessionStore } from "../state/session-store";
import { RhythmSelector } from "./RhythmSelector";
import { BasicControlPanel } from "./BasicControlPanel";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import { AxisControl } from "./AxisControl";
import { PharmacologyPanel } from "./PharmacologyPanel";
import { EcgDisplay } from "./EcgDisplay";
import { MeasureOverlay, type MeasureOverlayHandle } from "./MeasureOverlay";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceInspector } from "./WorkspaceInspector";
import { useLayoutMetrics } from "./hooks/useLayoutMetrics";
import { useSimulationRuntime } from "./hooks/useSimulationRuntime";
import { composeSnapshotLines, useSweepRenderer } from "./hooks/useSweepRenderer";
import { formatClock, useClock } from "./hooks/useClock";
import { useExport } from "./hooks/useExport";
import type { MeasurementSession } from "../measure/session";
import type { SnapMode } from "../measure/snap";
import type { ToolId } from "../measure/tools";
import {
  columnsForLayout,
  leadColumnsForLayout,
  rowsForLayout,
  type LayoutId,
} from "../render/layout";
import {
  REFERENCE_PAPER_SPEED_MM_S,
  type Compression,
  type GainSetting,
} from "../render/layout-engine";
import { clampStart, nextPaperSpeed } from "../measure/zoom";
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
  /** Token del modo escritorio. Vacío en navegador: ahí el backend no lo
   * exige, porque no está al alcance de cualquier proceso de la máquina. */
  backendToken?: string;
  webSocketFactory?: (url: string, protocols?: string[]) => WebSocket;
}

export function ECGWorkspace({
  wsUrl,
  apiBaseUrl,
  backendToken = "",
  webSocketFactory,
}: ECGWorkspaceProps) {
  const runtime = useMemo(
    () => new SessionRuntime(wsUrl, webSocketFactory, backendToken),
    [wsUrl, webSocketFactory, backendToken]
  );
  const catalogClient = useMemo(
    () => new CatalogClient({ baseUrl: apiBaseUrl, token: backendToken }),
    [apiBaseUrl, backendToken]
  );
  const store = useSessionStore();

  const [selectedRhythm, setSelectedRhythm] = useState<RhythmDetail | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [layout, setLayout] = useState<LayoutId>("6");
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [gain, setGain] = useState<GainSetting>("auto");
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  // El congelado es LOCAL y no espera al servidor: el usuario ve el trazado
  // parado en el mismo frame en que pulsa. El `pause` viaja en paralelo para
  // que el motor deje de generar.
  const [isFrozen, setIsFrozen] = useState(false);
  // El zoom es una herramienta de congelado: en marcha, la ventana visible es
  // donde escribe el barrido, y cambiarla a mitad de escritura deja el cursor
  // fuera de pantalla. Al reanudar se vuelve a la velocidad de referencia.
  const [paperSpeedMmS, setPaperSpeedMmS] = useState<number>(REFERENCE_PAPER_SPEED_MM_S);
  const [viewStartRingPos, setViewStartRingPos] = useState(0);
  const [magnifier, setMagnifier] = useState(false);

  const leadColumns = useMemo(() => leadColumnsForLayout(layout), [layout]);
  const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
  const theme = getTheme(themeName);

  useSimulationRuntime(runtime);

  const { containerRef, metrics } = useLayoutMetrics({
    rowCount: rowsForLayout(layout),
    columnCount: columnsForLayout(layout),
    gain,
    paperSpeedMmS,
  });

  // La ventana visible del anillo. A la velocidad de referencia son los
  // segundos completos de la tira; al hacer zoom, la misma cuenta da menos
  // muestras porque `stripSeconds` se deriva de la velocidad vigente.
  const measureView = useMemo(
    () => ({
      startRingPos: viewStartRingPos,
      visibleSamples: Math.round(metrics.stripSeconds * sampleRateHz),
    }),
    [viewStartRingPos, metrics.stripSeconds, sampleRateHz]
  );

  const { registerTrace, registerGrid, isAwaitingSignal, composeSnapshot, getMeasureSource } =
    useSweepRenderer({
      runtime,
      leadColumns,
      sampleRateHz,
      metrics,
      theme,
      frozen: isFrozen,
      view: measureView,
    });

  const measureOverlayRef = useRef<MeasureOverlayHandle>(null);
  /** El puesto entero, que es la unidad que se exporta como imagen. */
  const shellRef = useRef<HTMLDivElement>(null);
  const [measureSession, setMeasureSession] = useState<MeasurementSession | null>(null);

  const now = useClock();
  const clock = formatClock(now);

  // El sello va DENTRO de la imagen, no solo en el nombre del fichero: un
  // fichero se renombra y la imagen se queda sin fecha.
  const snapshotWithStamp = useCallback(
    () =>
      composeSnapshot({
        stamp: clock,
        overlay: measureOverlayRef.current?.getCanvas() ?? null,
        readout: composeSnapshotLines(isFrozen ? measureSession : null),
      }),
    [composeSnapshot, clock, isFrozen, measureSession]
  );

  // Lo que se exporta es el puesto entero, no el ECG suelto: la ganancia, la
  // velocidad, el ritmo elegido, los fármacos y las medidas están en los
  // paneles, y una imagen sin ellos no se puede leer después.
  //
  // Las tiras entran solas: cada canvas del DOM se rasteriza por separado, así
  // que las dos capas de cada derivación —rejilla y trazo— y el overlay de
  // medición se superponen en la captura igual que en pantalla. El trazado se
  // compone aquí únicamente para saber si hay algo que exportar; el mismo
  // canvas es el respaldo si la captura del puesto falla.
  const captureWorkstation = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell || !snapshotWithStamp()) return null;
    return captureElement(shell, {
      background: theme.surface.background,
      scale: window.devicePixelRatio || 1,
    });
  }, [snapshotWithStamp, theme]);

  const { exportPng, toggleRecording, isRecording, exportError } = useExport({
    composeSnapshot: captureWorkstation,
    composeTraceOnly: snapshotWithStamp,
  });

  const hasSession =
    store.connectionState === "running" || store.connectionState === "paused";

  const toggleFreeze = () => {
    if (isFrozen) {
      setIsFrozen(false);
      // El zoom no sobrevive al descongelado: en marcha la ventana visible es
      // donde escribe el barrido.
      setPaperSpeedMmS(REFERENCE_PAPER_SPEED_MM_S);
      setViewStartRingPos(0);
      setMagnifier(false);
      runtime.resume();
    } else {
      setIsFrozen(true);
      runtime.pause();
    }
  };

  const handleZoom = useCallback((direction: 1 | -1) => {
    setPaperSpeedMmS((current) => nextPaperSpeed(current, direction));
    // Al cambiar de escalón la ventana cambia de tamaño; volver al origen es
    // predecible y evita quedarse mirando un tramo que ya no es el que había
    // debajo del cursor.
    setViewStartRingPos(0);
  }, []);

  const handlePan = useCallback(
    (deltaSamples: number) => {
      const source = getMeasureSource();
      if (!source) return;
      setViewStartRingPos((start) =>
        clampStart(
          start - deltaSamples,
          measureView.visibleSamples,
          source.capacity,
          source.indexRing.writtenCount
        )
      );
    },
    [getMeasureSource, measureView.visibleSamples]
  );

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
    // Un ritmo nuevo arranca un trazado nuevo: dejarlo congelado mostraría el
    // ritmo anterior detenido mientras el motor genera otro distinto.
    setIsFrozen(false);
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

  // El panel de medición vive en el inspector y la sesión vive dentro del
  // overlay: sin este puente, cambiar de herramienta desde el panel no tendría
  // forma de llegar hasta el `MeasurementSession` que el overlay dibuja.
  const handleToolChange = useCallback((tool: ToolId) => {
    measureOverlayRef.current?.setTool(tool);
  }, []);
  const handleSnapChange = useCallback((mode: SnapMode) => {
    measureOverlayRef.current?.setSnapMode(mode);
  }, []);

  return (
    <AppShell
      ref={shellRef}
      header={
        <WorkspaceHeader
          layout={layout}
          onLayoutChange={setLayout}
          themeName={themeName}
          onThemeChange={setThemeName}
          gain={gain}
          onGainChange={setGain}
          isFrozen={isFrozen}
          onToggleFreeze={toggleFreeze}
          freezeDisabled={!hasSession}
          magnifier={magnifier}
          onToggleMagnifier={() => setMagnifier((on) => !on)}
          onExportPng={exportPng}
          isRecording={isRecording}
          onToggleRecording={toggleRecording}
        />
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
            {/* La farmacologia va en el mismo panel del paciente y no en el
                inspector: es una accion sobre el enfermo, como elegir el
                ritmo o mover la frecuencia. El inspector es para leer. */}
            <SectionTitle>Farmacología</SectionTitle>
            <PharmacologyPanel
              catalogClient={catalogClient}
              activeDrugs={store.activeDrugs}
              interactions={store.interactions}
              disabled={!hasSession}
              onAdminister={(drugId, dose, route) =>
                runtime.administer(drugId, dose, route)
              }
            />
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
          overlay={
            <MeasureOverlay
              ref={measureOverlayRef}
              active={isFrozen}
              layout={{ leadColumns, metrics }}
              sampleRateHz={sampleRateHz}
              paperSpeedMmS={paperSpeedMmS}
              theme={theme.ecg}
              view={measureView}
              magnifier={magnifier}
              getSource={getMeasureSource}
              onResultChange={setMeasureSession}
              onPan={handlePan}
              onZoom={handleZoom}
            />
          }
        />
      }
      inspector={
        <WorkspaceInspector
          lastError={store.lastError}
          disconnectReason={describeClose(store.lastDisconnect)}
          connectionState={store.connectionState}
          hasConnectedOnce={hasConnectedOnce}
          isAwaitingSignal={isAwaitingSignal}
          isFrozen={isFrozen}
          gainFits={metrics.gainFits}
          exportError={exportError}
          rhythmName={selectedRhythm?.display_name ?? null}
          bpm={bpm}
          axisDeg={currentParams?.axis.orientation_deg ?? null}
          measurements={store.measurements}
          physiology={store.physiology}
          measureSession={isFrozen ? measureSession : null}
          onToolChange={handleToolChange}
          onSnapChange={handleSnapChange}
        />
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
          {/* Dinamico desde el zoom temporal: a 50mm/s el mismo intervalo
              ocupa el doble de papel, y un trazado que no declara su velocidad
              se lee mal. */}
          <span>{paperSpeedMmS} mm/s</span>
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
          {/* El uso previsto, en pantalla mientras se usa. Quien abre la
              ventana no lee el README ni los metadatos del instalador, y desde
              que esto se distribuye como un `.exe` alguien puede tenerlo
              abierto en un hospital. */}
          <Tooltip content={INTENDED_USE_FULL}>
            <Badge tone="warning">{INTENDED_USE_SHORT}</Badge>
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
