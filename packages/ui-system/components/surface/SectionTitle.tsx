import type { ReactNode } from "react";
import styles from "./SectionTitle.module.css";

export interface SectionTitleProps {
  children: ReactNode;
}

/** `h2` y no un `div` con estilo: los títulos de sección son la estructura por
 * la que navega un lector de pantalla. */
export function SectionTitle({ children }: SectionTitleProps) {
  return <h2 className={styles.title}>{children}</h2>;
}
