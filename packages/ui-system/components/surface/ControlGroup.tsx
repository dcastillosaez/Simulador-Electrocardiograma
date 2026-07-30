import type { ReactNode } from "react";
import styles from "./ControlGroup.module.css";

export interface ControlGroupProps {
  label: string;
  children: ReactNode;
}

/** `fieldset` + `legend` y no `div` + `span`: así el lector de pantalla anuncia
 * el nombre del grupo al entrar en él, en vez de leer controles sueltos sin
 * contexto. */
export function ControlGroup({ label, children }: ControlGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {children}
    </fieldset>
  );
}
