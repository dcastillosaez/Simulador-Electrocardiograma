import { useCallback, useEffect, useRef, useState } from "react";
import { computeLayoutMetrics, type LayoutMetrics } from "../../render/layout-engine";

/** Tamaño de partida mientras no hay medida real. No es decorativo: en jsdom
 * todo mide cero, y unas métricas de altura cero producirían canvas
 * degenerados en los que el renderer no puede ni empezar a dibujar. */
const FALLBACK_WIDTH_PX = 800;
const FALLBACK_HEIGHT_PX = 600;

export interface UseLayoutMetricsParams {
  leadCount: number;
  clinicalGainMmPerMv: number;
  paperSpeedMmS: number;
}

export interface UseLayoutMetricsResult {
  containerRef: (element: HTMLElement | null) => void;
  metrics: LayoutMetrics;
  widthPx: number;
}

/** Observa el contenedor del ECG y traduce su tamaño a `LayoutMetrics`.
 *
 * Es la pieza que el spec llama `LayoutEngine` del lado de React: aquí vivirán
 * las decisiones de reparto que vengan después —ECG junto a corazón 3D,
 * pantalla partida, modo presentación—, y ninguna de ellas debería obligar a
 * tocar el renderer. */
export function useLayoutMetrics({
  leadCount,
  clinicalGainMmPerMv,
  paperSpeedMmS,
}: UseLayoutMetricsParams): UseLayoutMetricsResult {
  const [size, setSize] = useState({
    widthPx: FALLBACK_WIDTH_PX,
    heightPx: FALLBACK_HEIGHT_PX,
  });
  const observer = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!element) {
      observer.current = null;
      return;
    }
    observer.current = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Un contenedor de 0x0 es lo que reporta un elemento aún sin layout. No
      // se acepta: dejaría el ECG con canvas de altura cero hasta el siguiente
      // redimensionado.
      if (rect.width <= 0 || rect.height <= 0) return;
      setSize({ widthPx: rect.width, heightPx: rect.height });
    });
    observer.current.observe(element);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return {
    containerRef,
    widthPx: size.widthPx,
    metrics: computeLayoutMetrics(
      size.heightPx,
      leadCount,
      clinicalGainMmPerMv,
      paperSpeedMmS
    ),
  };
}
