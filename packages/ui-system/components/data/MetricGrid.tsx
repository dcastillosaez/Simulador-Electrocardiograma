import { Children, type ReactNode } from "react";
import styles from "./MetricGrid.module.css";

export interface MetricGridProps {
  children: ReactNode;
  columns?: number;
}

/** Lista real (`ul`/`li`) y no una rejilla de `div`: un lector de pantalla
 * anuncia cuántas medidas hay y por dónde va, que en un inspector de seis
 * valores es la diferencia entre orientarse y no. */
export function MetricGrid({ children, columns = 2 }: MetricGridProps) {
  return (
    <ul className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Children.map(children, (child, index) => (
        <li key={index}>{child}</li>
      ))}
    </ul>
  );
}
