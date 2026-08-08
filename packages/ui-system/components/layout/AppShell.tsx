import { forwardRef, type ReactNode } from "react";
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
 * después, farmacología más tarde—. El área de ECG no se mueve nunca.
 *
 * Expone su elemento por `ref` porque el puesto entero es una unidad
 * exportable: la captura del PNG es de las cinco zonas, no del ECG suelto. */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  { header, sidebar, ecg, inspector, status },
  ref
) {
  return (
    <div className={styles.shell} ref={ref}>
      <div className={styles.header}>{header}</div>
      <div className={styles.sidebar}>{sidebar}</div>
      <main className={styles.ecg}>{ecg}</main>
      <div className={styles.inspector}>{inspector}</div>
      <div className={styles.status}>{status}</div>
    </div>
  );
});
