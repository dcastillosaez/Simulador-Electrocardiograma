import { useCallback, useRef, useState } from "react";
import {
  computeLayoutMetrics,
  type GainSetting,
  type LayoutMetrics,
} from "../../render/layout-engine";

/** Tamaño de partida mientras no hay medida real. No es decorativo: en jsdom
 * todo mide cero, y unas métricas de altura cero producirían canvas
 * degenerados en los que el renderer no puede ni empezar a dibujar. */
const FALLBACK_WIDTH_PX = 800;
const FALLBACK_HEIGHT_PX = 600;

export interface UseLayoutMetricsParams {
  /** Filas visibles, no derivaciones: en el formato de dos columnas son seis
   * con doce derivaciones. */
  rowCount: number;
  columnCount: number;
  /** `"auto"` deja que el reparto de altura elija la ganancia, como haria un
   * electrocardiografo; un numero la fija. */
  gain: GainSetting;
  paperSpeedMmS: number;
  /** Ancho del contenedor medido que NO es para el ECG: el hueco del corazon
   * y el aire entre los dos.
   *
   * Se descuenta aqui y no fuera porque lo que se observa es el area entera.
   * Medir directamente el panel del ECG seria mas corto de escribir y volveria
   * a montar el bucle que hacia encoger la cuadricula sola: el ancho de ese
   * panel sale de estas metricas, asi que no puede ser tambien su entrada. */
  reservedWidthPx?: number;
}

export interface UseLayoutMetricsResult {
  containerRef: (element: HTMLElement | null) => void;
  metrics: LayoutMetrics;
}

/** Observa el contenedor del ECG y traduce su tamaño a `LayoutMetrics`.
 *
 * Es la pieza que el spec llama `LayoutEngine` del lado de React: aquí vivirán
 * las decisiones de reparto que vengan después —ECG junto a corazón 3D,
 * pantalla partida, modo presentación—, y ninguna de ellas debería obligar a
 * tocar el renderer. */
export function useLayoutMetrics({
  rowCount,
  columnCount,
  gain,
  paperSpeedMmS,
  reservedWidthPx = 0,
}: UseLayoutMetricsParams): UseLayoutMetricsResult {
  const [size, setSize] = useState({
    widthPx: FALLBACK_WIDTH_PX,
    heightPx: FALLBACK_HEIGHT_PX,
  });
  const observer = useRef<ResizeObserver | null>(null);

  // El ciclo de vida del observador vive ENTERO en este callback y no hay un
  // `useEffect` de desmontaje aparte, aunque lo parezca natural.
  //
  // React llama al ref con `null` al desmontar, así que la rama de abajo ya
  // desconecta. Un `useEffect(() => () => disconnect(), [])` además de esto no
  // es redundante: es un error. En StrictMode React monta, limpia y vuelve a
  // montar los efectos sin re-ejecutar los ref callbacks, así que esa limpieza
  // desconectaría el observador que el ref ya había conectado y nadie volvería
  // a llamar a `observe()`. El ECG se quedaría congelado en la primera medida
  // y dejaría de responder a cualquier redimensionado.
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
      // Histeresis de medio pixel. El navegador cuantiza el layout a 1/16 de
      // pixel, asi que una medida puede volver como 599,9375 donde antes
      // valia 600. Sin este filtro, cualquier lazo de realimentacion que
      // quede entre medida y contenido convierte esa migaja en una deriva
      // visible: la cuadricula encoge sola, escalon a escalon, sin que nadie
      // haya tocado la ventana. Medio pixel no cambia ninguna decision
      // clinica; una deriva, si.
      setSize((previous) =>
        Math.abs(previous.widthPx - rect.width) < 0.5 &&
        Math.abs(previous.heightPx - rect.height) < 0.5
          ? previous
          : { widthPx: rect.width, heightPx: rect.height }
      );
    });
    observer.current.observe(element);
  }, []);

  return {
    containerRef,
    metrics: computeLayoutMetrics({
      availableWidthPx: Math.max(1, size.widthPx - reservedWidthPx),
      availableHeightPx: size.heightPx,
      rowCount,
      columnCount,
      gain,
      paperSpeedMmS,
    }),
  };
}
