import styles from "./Stepper.module.css";

export interface StepperProps {
  label: string;
  /** Ya formateado por el llamante: el Stepper no sabe de unidades. */
  value: string;
  decrementLabel: string;
  incrementLabel: string;
  onDecrement: () => void;
  onIncrement: () => void;
  disabled?: boolean;
}

export function Stepper({
  label,
  value,
  decrementLabel,
  incrementLabel,
  onDecrement,
  onIncrement,
  disabled,
}: StepperProps) {
  return (
    <div className={styles.wrapper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.button}
        aria-label={decrementLabel}
        disabled={disabled}
        onClick={onDecrement}
      >
        −
      </button>
      <span className={styles.value} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={styles.button}
        aria-label={incrementLabel}
        disabled={disabled}
        onClick={onIncrement}
      >
        +
      </button>
    </div>
  );
}
