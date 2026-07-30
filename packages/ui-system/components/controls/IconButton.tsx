import { Icon, type IconName } from "../foundation/Icon";
import styles from "./IconButton.module.css";

export interface IconButtonProps {
  icon: IconName;
  /** Texto visible junto al icono. Es también el nombre accesible, así que no
   * hace falta un `aria-label` que lo duplique. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Para acciones con estado sostenido —grabando, congelado—. Marca el botón
   * con `aria-pressed`, que es lo que un lector de pantalla anuncia; el color
   * es solo el refuerzo visual. */
  active?: boolean;
}

/** Botón de acción con icono y texto.
 *
 * Siempre lleva texto, nunca solo el icono: un icono suelto obliga a
 * adivinar, y en una consola clínica adivinar es exactamente lo que no debe
 * pasar. El icono acompaña, no sustituye. */
export function IconButton({ icon, label, onClick, disabled, active }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active ? styles.active : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}
