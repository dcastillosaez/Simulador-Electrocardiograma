import { Metric, MetricGrid, SegmentedControl } from "@ui-system";
import {
  formatBpm,
  formatMs,
  formatMv,
  formatSeconds,
  formatSquares,
} from "../measure/formulas";
import type { MeasurementSession } from "../measure/session";
import type { SnapMode } from "../measure/snap";
import { TOOLS, type ToolId } from "../measure/tools";

const TOOL_OPTIONS: Array<{ value: ToolId; label: string }> = [
  { value: "ruler", label: TOOLS.ruler.label },
  { value: "caliper", label: TOOLS.caliper.label },
  { value: "rr", label: TOOLS.rr.label },
];

const SNAP_OPTIONS: Array<{ value: SnapMode; label: string }> = [
  { value: "signal", label: "Señal" },
  { value: "grid", label: "Rejilla" },
  { value: "rpeak", label: "Pico R" },
];

export interface MeasurePanelProps {
  session: MeasurementSession;
  onToolChange: (tool: ToolId) => void;
  onSnapChange: (mode: SnapMode) => void;
}

/** La lectura de la medida, en el DOM.
 *
 * Existe además del rótulo del canvas y no en su lugar: lo dibujado en canvas
 * no existe para un lector de pantalla, y esta es la única vía por la que el
 * resultado llega a quien no ve la pantalla. Por eso el resultado —y no el
 * cursor, que cambia sesenta veces por segundo— es lo que se publica a React.
 *
 * El rótulo lo pone el apartado que lo envuelve: este componente es contenido,
 * y quien decide cómo se separa del resto del inspector es el inspector. */
export function MeasurePanel({ session, onToolChange, onSnapChange }: MeasurePanelProps) {
  const result = session.result;

  return (
    <>
      <SegmentedControl
        label="Herramienta"
        value={session.tool}
        options={TOOL_OPTIONS}
        onChange={onToolChange}
      />
      <SegmentedControl
        label="Enganche"
        value={session.snapMode}
        options={SNAP_OPTIONS}
        onChange={onSnapChange}
      />

      {result === null && (
        <p>
          {session.tool === "ruler"
            ? "Marca un punto del trazado para leer su tiempo y voltaje."
            : "Marca dos puntos del trazado para medir la distancia entre ellos."}
        </p>
      )}

      {result?.kind === "cursor" && (
        <div role="status">
          <MetricGrid>
            <Metric label="Derivación" value={result.lead} />
            <Metric label="t" value={formatSeconds(result.timestampS)} />
            <Metric label="V" value={formatMv(result.voltageV * 1000)} />
          </MetricGrid>
        </div>
      )}

      {result?.kind === "caliper" && (
        <div role="status">
          <MetricGrid>
            <Metric label="Δt" value={formatMs(result.readout.deltaMs)} />
            <Metric label="ΔV" value={formatMv(result.readout.deltaMv)} />
            {/* «Equivalente» y no «FC»: son los latidos por minuto que habría si
                todos los intervalos midieran esto, no la frecuencia medida. */}
            <Metric label="Frec. equivalente" value={formatBpm(result.readout.equivalentBpm)} />
            <Metric label="Cuadros pequeños" value={formatSquares(result.readout.smallSquares)} />
            <Metric label="Cuadros grandes" value={formatSquares(result.readout.largeSquares)} />
          </MetricGrid>
        </div>
      )}
    </>
  );
}
