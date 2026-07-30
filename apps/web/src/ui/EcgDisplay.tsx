import type { LayoutMetrics } from "../render/layout-engine";
import type { LeadName } from "../render/layout";
import styles from "./EcgDisplay.module.css";
import { LeadStrip } from "./LeadStrip";

export interface EcgDisplayProps {
  containerRef: (element: HTMLElement | null) => void;
  leads: readonly LeadName[];
  metrics: LayoutMetrics;
  widthPx: number;
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
}

export function EcgDisplay({
  containerRef,
  leads,
  metrics,
  widthPx,
  registerTrace,
  registerGrid,
}: EcgDisplayProps) {
  return (
    <div className={styles.display} ref={containerRef}>
      {leads.map((lead) => (
        <LeadStrip
          key={lead}
          lead={lead}
          widthPx={widthPx}
          heightPx={metrics.stripHeightPx}
          registerTrace={registerTrace}
          registerGrid={registerGrid}
        />
      ))}
    </div>
  );
}
