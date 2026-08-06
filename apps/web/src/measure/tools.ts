import type { LeadName } from "../render/layout";
import type { SamplePoint } from "../render/sample-index";
import { caliperReadout, type CaliperReadout, type MeasureContext } from "./formulas";
import type { SnapMode } from "./snap";

/** Un punto medido sobre el trazado. Extiende `SamplePoint` con lo que una
 * medida necesita además de la identidad de la muestra. */
export interface MeasurePoint extends SamplePoint {
  /** Posición en el anillo. Es lo que se dibuja; `sampleIndex` es lo que se
   * mide. Se guardan las dos porque el anillo se sobrescribe y el índice no. */
  ringPos: number;
  voltageV: number;
  lead: LeadName;
}

export type MeasurementResult =
  | { kind: "cursor"; lead: LeadName; timestampS: number; voltageV: number }
  | { kind: "caliper"; readout: CaliperReadout };

export type ToolId = "ruler" | "caliper" | "rr";

/** Una herramienta es un descriptor, no una clase.
 *
 * Todas hacen lo mismo —fijar puntos, aplicar snap, producir un resultado—, así
 * que lo único que las distingue son estos cuatro campos. Añadir la undécima
 * herramienta es añadir una entrada a `TOOLS`; las de la fase F2 (PR, QT,
 * resaltado de onda) serán exactamente eso. */
export interface MeasurementTool {
  id: ToolId;
  label: string;
  markerCount: number;
  defaultSnap: SnapMode;
  /** `null` mientras falten marcas. No se calcula sobre `hover`: la lectura
   * viva del cursor la dibuja el overlay y nunca entra en el estado. */
  compute(markers: readonly MeasurePoint[], ctx: MeasureContext): MeasurementResult | null;
}

export const TOOLS: Record<ToolId, MeasurementTool> = {
  ruler: {
    id: "ruler",
    label: "Regla",
    markerCount: 1,
    defaultSnap: "signal",
    compute(markers) {
      if (markers.length < 1) return null;
      const point = markers[0];
      return {
        kind: "cursor",
        lead: point.lead,
        timestampS: point.timestampS,
        voltageV: point.voltageV,
      };
    },
  },
  caliper: {
    id: "caliper",
    label: "Calibrador",
    markerCount: 2,
    defaultSnap: "signal",
    compute(markers, ctx) {
      if (markers.length < 2) return null;
      const [a, b] = markers;
      return {
        kind: "caliper",
        readout: caliperReadout(a.sampleIndex, a.voltageV, b.sampleIndex, b.voltageV, ctx),
      };
    },
  },
  // El RR no es una herramienta nueva: es el calibrador con snap a pico R. Se
  // declara aparte porque el usuario piensa en "medir el RR", no en "cambiar
  // el modo de enganche del calibrador".
  rr: {
    id: "rr",
    label: "RR",
    markerCount: 2,
    defaultSnap: "rpeak",
    compute(markers, ctx) {
      if (markers.length < 2) return null;
      const [a, b] = markers;
      return {
        kind: "caliper",
        readout: caliperReadout(a.sampleIndex, a.voltageV, b.sampleIndex, b.voltageV, ctx),
      };
    },
  },
};
