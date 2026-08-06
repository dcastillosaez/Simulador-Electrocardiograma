import { Inspector, Metric, MetricGrid, Panel, SectionTitle } from "@ui-system";
import { zoneFor, ZONE_LABEL } from "./AxisControl/axis-zones";
import { MeasurePanel } from "./MeasurePanel";
import type { MeasurementSession } from "../measure/session";
import type { SnapMode } from "../measure/snap";
import type { ToolId } from "../measure/tools";
import type { SessionState } from "../simulation-runtime/session-runtime";

const GAIN_CLIPPING_HINT =
  "La ganancia elegida no cabe en el alto de tira disponible: el trazo puede " +
  "recortarse. Baja la ganancia o muestra menos derivaciones.";

export interface WorkspaceInspectorProps {
  lastError: { code: string; detail: string } | null;
  connectionState: SessionState;
  hasConnectedOnce: boolean;
  isAwaitingSignal: boolean;
  isFrozen: boolean;
  gainFits: boolean;
  exportError: string | null;
  rhythmName: string | null;
  bpm: number | null;
  axisDeg: number | null;
  measurements: Record<string, number | null> | null;
  /** `null` mientras no está congelado: la sesión de medición describe un
   * anillo que en marcha se está sobrescribiendo, así que no hay nada que
   * mostrar. */
  measureSession: MeasurementSession | null;
  onToolChange: (tool: ToolId) => void;
  onSnapChange: (mode: SnapMode) => void;
}

/** El panel de información del puesto de simulación: estado de la sesión y
 * medidas publicadas por el servidor. */
export function WorkspaceInspector({
  lastError,
  connectionState,
  hasConnectedOnce,
  isAwaitingSignal,
  isFrozen,
  gainFits,
  exportError,
  rhythmName,
  bpm,
  axisDeg,
  measurements,
  measureSession,
  onToolChange,
  onSnapChange,
}: WorkspaceInspectorProps) {
  /** Una medida del servidor, lista para pasar a `Metric`.
   *
   * Tres estados distintos, y los tres importan: todavía no ha llegado
   * ninguna medida, ha llegado pero este ritmo no la tiene (un flutter no
   * tiene PR), o hay número. Los dos primeros se pintan igual —hueco— pero
   * por motivos distintos, y confundirlos sería decir que algo falló cuando
   * solo es que no existe. */
  const measured = (key: string) => {
    const value = measurements?.[key];
    return value === undefined || value === null
      ? { value: "", unavailable: true as const }
      : { value: String(Math.round(value)), unavailable: false as const };
  };

  return (
    <Inspector>
      <Panel>
        <SectionTitle>Información</SectionTitle>
        {lastError && (
          <p role="alert">
            {lastError.code}: {lastError.detail}
          </p>
        )}
        {hasConnectedOnce && connectionState === "idle" && <p role="status">Desconectado</p>}
        {/* Solo mientras corre: en pausa el buffer se vacía a propósito, y
            anunciar "Esperando señal" ahí convertiría una acción
            deliberada del usuario en lo que parece una avería de red. */}
        {isAwaitingSignal && connectionState === "running" && (
          <p role="status">Esperando señal…</p>
        )}
        {isFrozen && <p role="status">Trazado congelado</p>}
        {/* Solo puede pasar con ganancia fijada a mano: en automatico se
            elige precisamente la que cabe. El usuario manda, pero se le
            dice lo que va a ver y como arreglarlo. */}
        {!gainFits && <p role="status">{GAIN_CLIPPING_HINT}</p>}
        {exportError && <p role="alert">{exportError}</p>}
        {measureSession && (
          <MeasurePanel
            session={measureSession}
            onToolChange={onToolChange}
            onSnapChange={onSnapChange}
          />
        )}
        <MetricGrid>
          <Metric label="Ritmo" value={rhythmName ?? ""} unavailable={rhythmName === null} />
          <Metric
            label="FC"
            value={bpm === null ? "" : String(bpm)}
            unit="lpm"
            unavailable={bpm === null}
          />
          <Metric
            label="Eje"
            value={
              axisDeg === null ? "" : `${Math.round(axisDeg)}° ${ZONE_LABEL[zoneFor(Math.round(axisDeg))]}`
            }
            unavailable={axisDeg === null}
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
  );
}
