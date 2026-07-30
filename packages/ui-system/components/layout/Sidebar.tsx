import type { ReactNode } from "react";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  children: ReactNode;
}

/** Panel de escenario. `complementary` con nombre: comparte rol con el
 * inspector, y sin nombre un lector de pantalla lee "region" dos veces sin
 * forma de distinguirlas. */
export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="Escenario">
      {children}
    </aside>
  );
}
