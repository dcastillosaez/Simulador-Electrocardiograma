import { useCallback, useEffect, useRef } from "react";
import type { EcgTheme } from "@ui-system/themes/types";
import { COLUMN_GAP_PX, STRIP_GAP_PX } from "../render/layout-engine";
import type { StripLayout, TraceView } from "../render/measure-geometry";
import { drawOverlay } from "../render/overlay-layer";
import type { MeasurementSession } from "../measure/session";
import { useMeasure } from "./hooks/useMeasure";
import type { MeasureSource } from "./hooks/useSweepRenderer";
import styles from "./MeasureOverlay.module.css";

/** Un arrastre por debajo de este umbral es un clic: colocar una marca y
 * desplazar la vista comparten el mismo botón, y distinguirlos por el
 * movimiento es lo que evita tener que activar un modo. */
const DRAG_THRESHOLD_PX = 4;

export interface MeasureOverlayProps {
  /** Solo con el trazado congelado: medir sobre un barrido en marcha no
   * significa nada, porque la muestra bajo el cursor cambia 500 veces por
   * segundo. */
  active: boolean;
  layout: StripLayout;
  sampleRateHz: number;
  paperSpeedMmS: number;
  theme: EcgTheme;
  view: TraceView;
  magnifier: boolean;
  getSource: () => MeasureSource | null;
  onResultChange: (session: MeasurementSession) => void;
}

export function MeasureOverlay({
  active,
  layout,
  sampleRateHz,
  paperSpeedMmS,
  theme,
  view,
  magnifier,
  getSource,
  onResultChange,
}: MeasureOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const { sessionRef, dirtyRef, pointAt, dispatch, moveCursorBySamples } = useMeasure({
    layout,
    sampleRateHz,
    paperSpeedMmS,
    view,
    getSource,
    onResultChange,
  });

  const columns = layout.leadColumns.length;
  const rows = Math.max(...layout.leadColumns.map((column) => column.length));
  const widthPx = layout.metrics.stripWidthPx * columns + COLUMN_GAP_PX * (columns - 1);
  const heightPx = layout.metrics.stripHeightPx * rows + STRIP_GAP_PX * (rows - 1);

  // Bucle propio, independiente del barrido —que estando congelado no tiene
  // nada que hacer—. Solo pinta cuando algo ha cambiado.
  useEffect(() => {
    if (!active) return;
    let frameId: number;
    const tick = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const source = getSource();
      if (canvas && ctx && source && dirtyRef.current) {
        dirtyRef.current = false;
        drawOverlay(ctx, {
          session: sessionRef.current,
          layout,
          view,
          sampleRateHz,
          capacity: source.capacity,
          writtenCount: source.indexRing.writtenCount,
          theme,
          magnifier,
        });
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, layout, view, sampleRateHz, theme, magnifier, getSource, dirtyRef, sessionRef]);

  // Al desactivarse se limpia: las marcas describen un anillo que se va a
  // sobrescribir, y conservar los números sería conservar una referencia a un
  // trazado que ya no está.
  useEffect(() => {
    if (!active) dispatch({ type: "clear" });
  }, [active, dispatch]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = localPoint(event);
      dispatch({ type: "hover", point: pointAt(x, y) });
    },
    [dispatch, pointAt]
  );

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pressRef.current = localPoint(event);
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press) return;
      const { x, y } = localPoint(event);
      if (Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD_PX) return;
      const point = pointAt(x, y);
      if (point) dispatch({ type: "place", point });
    },
    [dispatch, pointAt]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      // Un milímetro de papel en muestras: lo que avanza una pulsación con
      // Shift. Es la unidad con la que se lee un ECG.
      const samplesPerMm = sampleRateHz / paperSpeedMmS;
      const step = event.shiftKey ? Math.round(samplesPerMm) : 1;
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          moveCursorBySamples(step);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveCursorBySamples(-step);
          break;
        case "Enter": {
          event.preventDefault();
          const point = sessionRef.current.hover;
          if (point) dispatch({ type: "place", point });
          else moveCursorBySamples(0);
          break;
        }
        case "Escape":
          event.preventDefault();
          dispatch({ type: "clear" });
          break;
      }
    },
    [dispatch, moveCursorBySamples, paperSpeedMmS, sampleRateHz, sessionRef]
  );

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className={styles.overlay}
      width={widthPx}
      height={heightPx}
      role="application"
      aria-label="Medición sobre el trazado congelado"
      tabIndex={0}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => dispatch({ type: "hover", point: null })}
      onKeyDown={handleKeyDown}
    />
  );
}
