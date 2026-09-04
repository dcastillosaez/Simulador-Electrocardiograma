import { forwardRef, type ReactNode } from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  ecg: ReactNode;
  inspector: ReactNode;
  status: ReactNode;
}

/** Las cinco zonas fijas del puesto de simulación, en cuatro columnas de
 * pantalla: escenario e inspector comparten la de la izquierda, uno encima del
 * otro.
 *
 * Estuvieron a los dos lados, y el precio lo pagaba el centro: entre 280px de
 * escenario y 320px de inspector se iban 600 de ancho, y lo que quedaba tenía
 * que repartirse entre el papel del ECG —cuyo ancho no es negociable, lo dicta
 * la ganancia— y el corazón, que se quedaba con las sobras. Juntas en una sola
 * columna liberan casi 300px, y todos van al corazón.
 *
 * Siguen siendo dos zonas y no una: son dos landmarks con nombre distinto, y
 * un lector de pantalla tiene que poder saltar del escenario al inspector sin
 * recorrer los doce mandos que hay en medio.
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
      <div className={styles.aside}>
        <div className={styles.sidebar}>{sidebar}</div>
        <div className={styles.inspector}>{inspector}</div>
      </div>
      <main className={styles.ecg}>{ecg}</main>
      <div className={styles.status}>{status}</div>
    </div>
  );
});
