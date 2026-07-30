import type { ReactNode } from "react";
import styles from "./Inspector.module.css";

export interface InspectorProps {
  children: ReactNode;
}

export function Inspector({ children }: InspectorProps) {
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      {children}
    </aside>
  );
}
