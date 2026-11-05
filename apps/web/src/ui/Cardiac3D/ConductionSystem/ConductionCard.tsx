import { STRUCTURE_INFO, type ConductionStructure } from "./conduction-structures";
import styles from "./ConductionCard.module.css";

export interface ConductionCardProps {
  structure: ConductionStructure;
  onClose?: () => void;
}

/** La ficha de una estructura del sistema de conducción.
 *
 * No sabe de qué estructura habla: pinta lo que dice `STRUCTURE_INFO`. Los
 * textos son datos, y su revisión clínica no obliga a tocar este componente. */
export function ConductionCard({ structure, onClose }: ConductionCardProps) {
  const info = STRUCTURE_INFO[structure];
  return (
    <div className={styles.card}>
      <p className={styles.title}>
        <span
          className={styles.swatch}
          style={{ background: `#${info.color.toString(16).padStart(6, "0")}` }}
          aria-hidden="true"
        />
        {info.label}
      </p>
      <p className={styles.text}>{info.summary}</p>
      <p className={styles.note}>{info.placement}</p>
      {info.didactic && (
        <p className={styles.note} role="note">
          Esquema didáctico: el trazado no reconstruye fibras reales.
        </p>
      )}
      {onClose && (
        <button type="button" className={styles.close} onClick={onClose}>
          Cerrar ficha
        </button>
      )}
    </div>
  );
}
