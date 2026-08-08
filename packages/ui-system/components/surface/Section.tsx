import type { ReactNode } from "react";
import { SectionTitle } from "./SectionTitle";
import styles from "./Section.module.css";

export interface SectionProps {
  title: string;
  children: ReactNode;
}

/** Un apartado dentro de un panel: fondo hundido, borde tenue y su título.
 *
 * `section` con nombre accesible y no un `div`: lo que separa visualmente
 * tiene que separar también para quien navega por regiones, o el panel sigue
 * siendo una lista larga para la mitad de sus usuarios.
 *
 * El título va dentro y no lo pone quien lo usa: un apartado sin rótulo es un
 * recuadro que no dice de qué es, y esa es la única forma de usar esto mal. */
export function Section({ title, children }: SectionProps) {
  return (
    <section className={styles.section} aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}
