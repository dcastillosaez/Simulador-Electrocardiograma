import type { LeadName } from "../render/layout";
import styles from "./LeadStrip.module.css";

export interface LeadStripProps {
  lead: LeadName;
  widthPx: number;
  heightPx: number;
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
}

/** Una derivación: canvas de rejilla al fondo, canvas de trazo encima,
 * etiqueta sobre ambos.
 *
 * Dos canvas y no uno porque el trazo se borra por bandas mientras la rejilla
 * permanece: con una sola capa habría que redibujar la rejilla de la banda en
 * cada tick. Y por tira, no global, porque el canvas suelto de 800x600 que
 * había antes no se alineaba con nada — además, así cada derivación es
 * autónoma y mañana se puede ampliar, congelar o resaltar una sin tocar el
 * resto. */
export function LeadStrip({
  lead,
  widthPx,
  heightPx,
  registerTrace,
  registerGrid,
}: LeadStripProps) {
  return (
    <div className={styles.strip} style={{ width: widthPx, height: heightPx }}>
      <canvas
        className={styles.canvas}
        ref={(element) => registerGrid(lead, element)}
        width={widthPx}
        height={heightPx}
        aria-hidden="true"
      />
      <canvas
        className={styles.canvas}
        data-testid={`lead-canvas-${lead}`}
        ref={(element) => registerTrace(lead, element)}
        width={widthPx}
        height={heightPx}
        aria-hidden="true"
      />
      <span className={styles.label}>{lead}</span>
    </div>
  );
}
