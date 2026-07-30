import styles from "./Metric.module.css";

export type Tone = "neutral" | "ok" | "warning" | "critical";

export interface MetricProps {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  /** La medida no existe todavía en el sistema, no es que haya fallado. Es el
   * caso de PR/QRS/QT hasta la Entrega 2. */
  unavailable?: boolean;
}

export function Metric({ label, value, unit, tone = "neutral", unavailable }: MetricProps) {
  return (
    <div className={styles.metric}>
      <span className={styles.label}>{label}</span>
      <span className={styles.readout} aria-live="polite">
        {unavailable ? (
          <span className={`${styles.value} ${styles.unavailable}`} aria-label="no disponible">
            —
          </span>
        ) : (
          <>
            <span className={`${styles.value} ${styles[tone]}`}>{value}</span>
            {unit && <span className={styles.unit}>{unit}</span>}
          </>
        )}
      </span>
    </div>
  );
}
