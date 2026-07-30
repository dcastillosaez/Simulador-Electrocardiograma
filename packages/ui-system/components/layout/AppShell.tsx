import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  ecg: ReactNode;
  inspector: ReactNode;
  status: ReactNode;
}

/** Las cinco zonas fijas del puesto de simulación.
 *
 * El panel derecho es contextual y cambiará —inspector ahora, corazón 3D
 * después, farmacología más tarde—. El área de ECG no se mueve nunca. */
export function AppShell({ header, sidebar, ecg, inspector, status }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.header}>{header}</div>
      <div className={styles.sidebar}>{sidebar}</div>
      <main className={styles.ecg}>{ecg}</main>
      <div className={styles.inspector}>{inspector}</div>
      <div className={styles.status}>{status}</div>
    </div>
  );
}
