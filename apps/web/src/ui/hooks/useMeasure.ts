import { useCallback, useEffect, useRef, useState } from "react";
import {
  hitTest,
  pxPerSample,
  pxToRingPos,
  pxToVoltage,
  type StripLayout,
  type TraceView,
} from "../../render/measure-geometry";
import {
  apply,
  createSession,
  isColdChange,
  type MeasurementSession,
  type SessionEvent,
} from "../../measure/session";
import { snap, type SnapMode } from "../../measure/snap";
import type { MeasurePoint, ToolId } from "../../measure/tools";
import type { MeasureSource } from "./useSweepRenderer";

export interface UseMeasureParams {
  layout: StripLayout;
  sampleRateHz: number;
  paperSpeedMmS: number;
  view: TraceView;
  getSource: () => MeasureSource | null;
  onResultChange: (session: MeasurementSession) => void;
}

export interface UseMeasureResult {
  /** La sesión viva. Se lee desde el bucle de dibujo, nunca desde el render. */
  sessionRef: React.MutableRefObject<MeasurementSession>;
  /** Copia de los campos fríos, para lo que sí debe re-renderizar. */
  cold: MeasurementSession;
  dirtyRef: React.MutableRefObject<boolean>;
  pointAt: (xPx: number, yPx: number) => MeasurePoint | null;
  dispatch: (event: SessionEvent) => void;
  moveCursorBySamples: (delta: number) => void;
  setTool: (tool: ToolId) => void;
  setSnapMode: (mode: SnapMode) => void;
}

/** Dueño de la sesión de medición.
 *
 * La sesión vive en una `ref` porque `hover` cambia a la cadencia del puntero:
 * meterla en el estado de React volvería a renderizar el árbol sesenta veces
 * por segundo. Solo los cambios «fríos» —herramienta, snap, marcas, resultado—
 * se publican. */
export function useMeasure({
  layout,
  sampleRateHz,
  paperSpeedMmS,
  view,
  getSource,
  onResultChange,
}: UseMeasureParams): UseMeasureResult {
  const sessionRef = useRef<MeasurementSession>(createSession("caliper"));
  const dirtyRef = useRef(true);
  const [cold, setCold] = useState<MeasurementSession>(sessionRef.current);

  const measureCtx = {
    sampleRateHz,
    paperSpeedMmS,
    clinicalGainMmPerMv: layout.metrics.clinicalGainMmPerMv,
  };

  const dispatch = useCallback(
    (event: SessionEvent) => {
      const before = sessionRef.current;
      const after = apply(before, event, measureCtx);
      sessionRef.current = after;
      dirtyRef.current = true;
      if (isColdChange(before, after)) {
        setCold(after);
        onResultChange(after);
      }
    },
    // `measureCtx` se reconstruye en cada render; sus tres campos son los que
    // importan y son primitivos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sampleRateHz, paperSpeedMmS, layout.metrics.clinicalGainMmPerMv, onResultChange]
  );

  /** Traduce un punto del canvas a una muestra medida, con snap aplicado.
   * `null` en los huecos entre tiras, fuera del área, y en la parte del
   * anillo que todavía no tiene señal. */
  const pointAt = useCallback(
    (xPx: number, yPx: number): MeasurePoint | null => {
      const source = getSource();
      if (!source) return null;
      const hit = hitTest(xPx, yPx, layout);
      if (!hit) return null;
      const sweep = source.sweeps.get(hit.lead);
      if (!sweep) return null;

      const pps = pxPerSample(layout.metrics, sampleRateHz);
      const rawRingPos = pxToRingPos(hit.xInStrip, view, pps, source.capacity);
      const rawVoltageV = pxToVoltage(hit.yInStrip, layout.metrics.stripHeightPx, layout.metrics);

      const snapped = snap({ rawRingPos, rawVoltageV }, sessionRef.current.snapMode, {
        sweep,
        sampleRateHz,
        metrics: layout.metrics,
        view,
        capacity: source.capacity,
      });

      // No se coloca una marca sobre la parte del anillo que nunca se ha
      // escrito: ahí solo hay ceros de relleno, no señal.
      const writtenCount = source.indexRing.writtenCount;
      if (writtenCount < source.capacity && snapped.ringPos >= writtenCount) {
        return null;
      }

      const sampleIndex = source.indexRing.at(snapped.ringPos);

      return {
        ringPos: snapped.ringPos,
        sampleIndex,
        timestampS: sampleIndex / sampleRateHz,
        voltageV: snapped.voltageV,
        lead: hit.lead,
      };
    },
    [getSource, layout, sampleRateHz, view]
  );

  /** Mueve el cursor por teclado. Sin esto la herramienta solo existe para
   * quien usa ratón, y su resultado nunca llegaría al DOM. */
  const moveCursorBySamples = useCallback(
    (delta: number) => {
      const source = getSource();
      if (!source) return;
      const current = sessionRef.current.hover;
      const lead = current?.lead ?? layout.leadColumns[0][0];
      const sweep = source.sweeps.get(lead);
      if (!sweep) return;

      const base = current?.ringPos ?? view.startRingPos;
      const ringPos = (((base + delta) % source.capacity) + source.capacity) % source.capacity;
      const sampleIndex = source.indexRing.at(ringPos);

      sessionRef.current = apply(
        sessionRef.current,
        {
          type: "hover",
          point: {
            ringPos,
            sampleIndex,
            timestampS: sampleIndex / sampleRateHz,
            voltageV: sweep.at(ringPos),
            lead,
          },
        },
        measureCtx
      );
      dirtyRef.current = true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getSource, layout, sampleRateHz, view, paperSpeedMmS]
  );

  const setTool = useCallback((tool: ToolId) => dispatch({ type: "setTool", tool }), [dispatch]);
  const setSnapMode = useCallback(
    (snapMode: SnapMode) => dispatch({ type: "setSnap", snapMode }),
    [dispatch]
  );

  // Un cambio de geometría invalida las marcas: describen posiciones del anillo
  // que ya no caen donde caían.
  useEffect(() => {
    dispatch({ type: "clear" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.metrics.stripWidthPx, layout.metrics.stripHeightPx, paperSpeedMmS]);

  return { sessionRef, cold, dirtyRef, pointAt, dispatch, moveCursorBySamples, setTool, setSnapMode };
}
