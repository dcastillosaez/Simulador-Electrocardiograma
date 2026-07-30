import { cloneElement, useId, useState, type ReactElement } from "react";
import styles from "./Tooltip.module.css";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  content: string;
  placement?: TooltipPlacement;
  /** Un único elemento enfocable. Recibe `aria-describedby` mientras el
   * tooltip está visible. */
  children: ReactElement;
}

/** Tooltip mínimo: posicionamiento absoluto, cuatro colocaciones, sin portal y
 * sin animación.
 *
 * No usa el `title=""` nativo porque hace falta que aparezca también con el
 * foco de teclado y que su contenido sea un nodo describible por
 * `aria-describedby`. No usa una librería de posicionamiento porque dentro de
 * paneles de anchura conocida las cuatro colocaciones fijas bastan. */
export function Tooltip({ content, placement = "top", children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const child = cloneElement(children, {
    "aria-describedby": visible ? id : undefined,
  } as Record<string, unknown>);

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {child}
      {visible && (
        <span role="tooltip" id={id} className={`${styles.bubble} ${styles[placement]}`}>
          {content}
        </span>
      )}
    </span>
  );
}
