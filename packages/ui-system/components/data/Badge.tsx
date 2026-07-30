import type { ReactNode } from "react";
import styles from "./Badge.module.css";
import type { Tone } from "./Metric";

export interface BadgeProps {
  tone: Tone;
  /** Siempre texto, nunca solo color: un indicador que se distingue únicamente
   * por el tono deja fuera a quien no distingue esos tonos. */
  children: ReactNode;
}

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
