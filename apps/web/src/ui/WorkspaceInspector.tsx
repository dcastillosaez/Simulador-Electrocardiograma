import { Inspector, Metric, MetricGrid, Panel, Section, SectionTitle } from "@ui-system";
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
  /** Estado fisiológico publicado por el motor farmacológico. `null` hasta
   * la primera publicación. Es un canal distinto del de medidas y por eso
   * llega como prop aparte: las medidas se calculan sobre la señal que se
   * está viendo, y esto no está en el ECG. */
  physiology: Record<string, number> | null;
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
  physiology,
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

  /** Una constante del estado fisiológico publicado por la farmacología.
   *
   * Hueco mientras no ha llegado ninguna publicación, igual que `measured`.
   * No se inventa un valor por defecto: mostrar 120/75 antes de que el
   * servidor haya dicho nada sería afirmar algo sobre un paciente que
   * todavía no existe. */
  const physiologic = (key: string, decimals = 0) => {
    const value = physiology?.[key];
    return value === undefined
      ? { value: "", unavailable: true as const }
      : { value: value.toFixed(decimals), unavailable: false as const };
  };

  /** La tensión arterial es dos números y una barra: no cabe en
   * `physiologic`, que devuelve uno. */
  const vital = (systolicKey: string, diastolicKey: string) => {
    const systolic = physiology?.[systolicKey];
    const diastolic = physiology?.[diastolicKey];
    return systolic === undefined || diastolic === undefined
      ? { value: "", unavailable: true as const }
      : {
          value: `${Math.round(systolic)}/${Math.round(diastolic)}`,
          unavailable: false as const,
        };
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
        {/* Tres apartados y tres orígenes distintos, cada uno en su recuadro:
            lo que mide el usuario sobre el trazado congelado, lo que el motor
            de señal publica del ritmo, y lo que sale del estado fisiológico.
            Apilados al mismo tono se leían como una lista larga de números
            donde no se ve de dónde viene cada uno. */}
        {measureSession && (
          <Section title="Medición">
            <MeasurePanel
              session={measureSession}
              onToolChange={onToolChange}
              onSnapChange={onSnapChange}
            />
          </Section>
        )}
        <Section title="Ritmo">
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
                axisDeg === null
                  ? ""
                  : `${Math.round(axisDeg)}° ${ZONE_LABEL[zoneFor(Math.round(axisDeg))]}`
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
        </Section>
        {/* Las constantes hemodinámicas no se miden sobre la señal: no están
            en el ECG. Vienen del estado fisiológico que publica el motor
            farmacológico, y por eso van en su propio apartado y no mezcladas
            con los intervalos. */}
        <Section title="Constantes">
          <MetricGrid>
            <Metric label="TA" unit="mmHg" {...vital("systolic_bp_mmhg", "diastolic_bp_mmhg")} />
            <Metric label="FR" unit="rpm" {...physiologic("respiratory_rate_bpm")} />
            <Metric label="GC" unit="L/min" {...physiologic("cardiac_output_l_min", 1)} />
            <Metric label="VS" unit="mL" {...physiologic("stroke_volume_ml")} />
          </MetricGrid>
        </Section>
      </Panel>
    </Inspector>
  );
}
