import type { ReactNode } from "react";
import styles from "./StatusBar.module.css";

export interface StatusBarProps {
  children: ReactNode;
}

/** Información técnica: útil para depurar, sin ocupar espacio clínico. */
export function StatusBar({ children }: StatusBarProps) {
  return (
    <footer className={styles.status} role="contentinfo">
      {children}
    </footer>
  );
}
