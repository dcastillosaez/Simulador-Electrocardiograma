import type { LayoutMetrics } from "../render/layout-engine";
import type { LeadName } from "../render/layout";
import styles from "./EcgDisplay.module.css";
import { LeadStrip } from "./LeadStrip";

export interface EcgDisplayProps {
  containerRef: (element: HTMLElement | null) => void;
  /** Una lista por columna. Con un solo elemento es la vista clásica. */
  leadColumns: readonly (readonly LeadName[])[];
  metrics: LayoutMetrics;
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
}

/** Las columnas van sincronizadas: muestran el mismo instante con
 * derivaciones distintas, como un monitor de cabecera. No es el papel, donde
 * cada bloque es un tramo de tiempo consecutivo — aquí la señal está viva, y
 * poder comparar el mismo latido entre derivaciones es justo lo que se busca
 * al partir la pantalla. */
export function EcgDisplay({
  containerRef,
  leadColumns,
  metrics,
  registerTrace,
  registerGrid,
}: EcgDisplayProps) {
  return (
    <div className={styles.display} ref={containerRef}>
      {leadColumns.map((leads, index) => (
        <div className={styles.column} key={index}>
          {leads.map((lead) => (
            <LeadStrip
              key={lead}
              lead={lead}
              widthPx={metrics.stripWidthPx}
              heightPx={metrics.stripHeightPx}
              registerTrace={registerTrace}
              registerGrid={registerGrid}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
