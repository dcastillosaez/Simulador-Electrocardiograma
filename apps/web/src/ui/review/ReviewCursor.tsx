import { forwardRef, useImperativeHandle, useRef } from "react";
import { COLUMN_GAP_PX, type LayoutMetrics } from "../../render/layout-engine";
import styles from "./ReviewCursor.module.css";

export interface ReviewCursorHandle {
  /** Coloca la línea a `xInStrip` píxeles del borde izquierdo de cada tira,
   * o la esconde con `null`. Se llama desde el bucle del repaso, sin pasar
   * por React. */
  place(xInStrip: number | null): void;
}

export interface ReviewCursorProps {
  columns: number;
  metrics: LayoutMetrics;
}

/** La línea del instante del repaso, sobre el trazado.
 *
 * Distinta del cursor de medida, que no se toca: aquel es de la herramienta y
 * sigue al ratón; este es del repaso y sigue al tiempo. Va en su propia capa,
 * sin recibir el ratón, para que clic y arrastre sobre el trazado sigan siendo
 * de la medida. Una línea por columna de tiras, porque todas las columnas
 * enseñan el mismo eje de tiempo. */
export const ReviewCursor = forwardRef<ReviewCursorHandle, ReviewCursorProps>(
  function ReviewCursor({ columns, metrics }, ref) {
    const lines = useRef<(HTMLDivElement | null)[]>([]);

    useImperativeHandle(
      ref,
      () => ({
        place(xInStrip) {
          lines.current.forEach((line, column) => {
            if (!line) return;
            if (xInStrip === null) {
              line.style.display = "none";
              return;
            }
            const left = column * (metrics.stripWidthPx + COLUMN_GAP_PX) + xInStrip;
            line.style.display = "block";
            line.style.transform = `translateX(${Math.round(left)}px)`;
          });
        },
      }),
      [metrics.stripWidthPx]
    );

    return (
      <div className={styles.layer} aria-hidden="true">
        {Array.from({ length: columns }, (_, column) => (
          <div
            key={column}
            className={styles.line}
            ref={(element) => {
              lines.current[column] = element;
            }}
          />
        ))}
      </div>
    );
  }
);
