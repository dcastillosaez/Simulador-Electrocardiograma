import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export interface PanelProps {
  children: ReactNode;
  /** Para que el layout pueda colocarlo en su área de grid sin que el panel
   * sepa nada del layout. */
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return <div className={[styles.panel, className].filter(Boolean).join(" ")}>{children}</div>;
}
