import type { MeasureContext } from "./formulas";
import type { SnapMode } from "./snap";
import { TOOLS, type MeasurePoint, type MeasurementResult, type ToolId } from "./tools";

/** El estado único que comparten todas las herramientas de medición.
 *
 * Si cada herramienta trajese su propia máquina de estados, la undécima
 * costaría lo mismo que la primera y las once se solaparían en un 80%.
 *
 * Vive en una `ref`, no en el store: `hover` cambia a la cadencia del puntero y
 * no puede disparar renders. Solo los campos «fríos» —`tool`, `snapMode`,
 * `markers`, `result`— se publican a React. */
export interface MeasurementSession {
  tool: ToolId;
  snapMode: SnapMode;
  markers: readonly MeasurePoint[];
  /** La última marca puesta: la referencia de la medida en curso. */
  anchor: MeasurePoint | null;
  /** Dónde está el puntero ahora. Nunca entra en el estado de React. */
  hover: MeasurePoint | null;
  result: MeasurementResult | null;
}

export type SessionEvent =
  | { type: "hover"; point: MeasurePoint | null }
  | { type: "place"; point: MeasurePoint }
  | { type: "dragMarker"; index: number; point: MeasurePoint }
  | { type: "clear" }
  | { type: "setTool"; tool: ToolId }
  | { type: "setSnap"; snapMode: SnapMode };

export function createSession(tool: ToolId): MeasurementSession {
  return {
    tool,
    snapMode: TOOLS[tool].defaultSnap,
    markers: [],
    anchor: null,
    hover: null,
    result: null,
  };
}

/** Reductor puro. Sin DOM y sin canvas: se prueba entero con tablas. */
export function apply(
  session: MeasurementSession,
  event: SessionEvent,
  ctx: MeasureContext
): MeasurementSession {
  switch (event.type) {
    case "hover":
      // No recalcula nada. La lectura viva del cursor la dibuja el overlay
      // leyendo `hover`; meterla en `result` obligaría a publicar a React
      // sesenta veces por segundo.
      return { ...session, hover: event.point };

    case "place": {
      const tool = TOOLS[session.tool];
      // Completar la cuenta y volver a pulsar empieza una medida nueva. La
      // alternativa —ignorar el clic— deja al usuario sin forma de medir otra
      // cosa sin buscar antes el botón de limpiar.
      const markers =
        session.markers.length >= tool.markerCount
          ? [event.point]
          : [...session.markers, event.point];
      return withResult({ ...session, markers, anchor: event.point }, ctx);
    }

    case "dragMarker": {
      const markers = session.markers.map((marker, index) =>
        index === event.index ? event.point : marker
      );
      return withResult({ ...session, markers, anchor: event.point }, ctx);
    }

    case "clear":
      return { ...session, markers: [], anchor: null, result: null };

    case "setTool":
      // Las marcas no se heredan: dos puntos de calibrador no significan lo
      // mismo bajo otra herramienta, y arrastrarlos dejaría en pantalla un
      // resultado del que ya nadie sabe de dónde salió.
      return { ...createSession(event.tool), hover: session.hover };

    case "setSnap":
      // No recoloca las marcas ya puestas: el snap decide dónde cae la
      // siguiente, no reinterpreta las anteriores.
      return { ...session, snapMode: event.snapMode };
  }
}

/** `true` si algo que React debe ver ha cambiado. `hover` nunca lo es. */
export function isColdChange(
  before: MeasurementSession,
  after: MeasurementSession
): boolean {
  return (
    before.tool !== after.tool ||
    before.snapMode !== after.snapMode ||
    before.markers !== after.markers ||
    before.result !== after.result
  );
}

function withResult(
  session: MeasurementSession,
  ctx: MeasureContext
): MeasurementSession {
  return { ...session, result: TOOLS[session.tool].compute(session.markers, ctx) };
}
