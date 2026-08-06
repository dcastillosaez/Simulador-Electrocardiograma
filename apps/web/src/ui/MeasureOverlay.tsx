import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { EcgTheme } from "@ui-system/themes/types";
import { COLUMN_GAP_PX, STRIP_GAP_PX } from "../render/layout-engine";
import { pxPerSample, type StripLayout, type TraceView } from "../render/measure-geometry";
import { drawOverlay } from "../render/overlay-layer";
import type { MeasurementSession } from "../measure/session";
import type { SnapMode } from "../measure/snap";
import type { ToolId } from "../measure/tools";
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
  /** Desplaza la ventana visible. En muestras, no en píxeles: el consumidor no
   * tiene por qué conocer la escala. */
  onPan: (deltaSamples: number) => void;
  /** Un escalón de velocidad de papel arriba (`1`) o abajo (`-1`). */
  onZoom: (direction: 1 | -1) => void;
}

/** Lo que un consumidor externo puede pedirle al overlay.
 *
 * La sesión de medición vive dentro de este componente (en `useMeasure`), pero
 * el panel de herramientas vive en el inspector, fuera de aquí. Sin este
 * puente, elegir "RR" en el panel no tendría forma de llegar hasta la sesión
 * que el overlay dibuja y con la que responde al ratón y al teclado. */
export interface MeasureOverlayHandle {
  setTool: (tool: ToolId) => void;
  setSnapMode: (mode: SnapMode) => void;
}

export const MeasureOverlay = forwardRef<MeasureOverlayHandle, MeasureOverlayProps>(
  function MeasureOverlay(
    {
      active,
      layout,
      sampleRateHz,
      paperSpeedMmS,
      theme,
      view,
      magnifier,
      getSource,
      onResultChange,
      onPan,
      onZoom,
    },
    handleRef
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const pressRef = useRef<{ x: number; y: number } | null>(null);
    /** Un arrastre ya empezado. Sin esta bandera, el `pointerup` al final de un
     * desplazamiento colocaría una marca no pedida: `pressRef` se va moviendo
     * con el puntero, así que la distancia contra la posición final siempre
     * acaba por debajo del umbral. */
    const draggedRef = useRef(false);
    const { sessionRef, dirtyRef, pointAt, dispatch, moveCursorBySamples, setTool, setSnapMode } =
      useMeasure({
        layout,
        sampleRateHz,
        paperSpeedMmS,
        view,
        getSource,
        onResultChange,
      });

    useImperativeHandle(handleRef, () => ({ setTool, setSnapMode }), [setTool, setSnapMode]);

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
            sweeps: source.sweeps,
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
        const press = pressRef.current;

        // Arrastrar desplaza, un clic coloca marca. Distinguirlos por el
        // movimiento —y no por un modo que haya que activar— es lo que permite
        // que el mismo botón haga las dos cosas sin ambigüedad.
        if (press && Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD_PX) {
          draggedRef.current = true;
          onPan(Math.round((x - press.x) / pxPerSample(layout.metrics, sampleRateHz)));
          pressRef.current = { x, y };
          return;
        }

        dispatch({ type: "hover", point: pointAt(x, y) });
      },
      [dispatch, layout.metrics, onPan, pointAt, sampleRateHz]
    );

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
      pressRef.current = localPoint(event);
      draggedRef.current = false;
    }, []);

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        if (!press) return;
        const { x, y } = localPoint(event);
        if (Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD_PX) return;
        const point = pointAt(x, y);
        if (point) dispatch({ type: "place", point });
      },
      [dispatch, pointAt]
    );

    // La rueda vive aquí y no en el contenedor del ECG porque este canvas
    // existe exactamente cuando el zoom está permitido: solo congelado.
    const handleWheel = useCallback(
      (event: React.WheelEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        onZoom(event.deltaY < 0 ? 1 : -1);
      },
      [onZoom]
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
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      />
    );
  }
);
