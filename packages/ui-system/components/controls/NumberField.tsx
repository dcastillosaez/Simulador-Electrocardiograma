import { useEffect, useState } from "react";
import styles from "./NumberField.module.css";

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Cuánto mueve cada botón. No restringe lo que se puede escribir: el campo
   * acepta cualquier entero del rango. */
  step: number;
  unit?: string;
  decrementLabel: string;
  incrementLabel: string;
  onChange: (value: number) => void;
  /** El valor no se puede cambiar: se muestra como texto, sin campo ni
   * botones. Es el caso de los ritmos de frecuencia fija. */
  readOnly?: boolean;
  /** Texto que sustituye al valor cuando es de solo lectura. */
  readOnlyText?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Campo numérico con botones de paso a los lados.
 *
 * El valor se escribe y se confirma con Enter o al salir del campo, no en cada
 * pulsación: validar mientras se teclea hace imposible escribir «120», porque
 * al llegar a «1» el valor ya se habría corregido al mínimo del rango. Ese es
 * el error clásico de los campos numéricos controlados.
 *
 * Mientras se edita, el texto del campo es del usuario; al confirmar se acota
 * al rango y se propaga. Escape devuelve el valor vigente. */
export function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  decrementLabel,
  incrementLabel,
  onChange,
  readOnly,
  readOnlyText,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));

  // Un cambio que venga de fuera —los botones, el motor, otro control— tiene
  // que verse en el campo. Solo cuando no se está editando: pisar el texto a
  // medio teclear sería exasperante.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  if (readOnly) {
    return (
      <div className={styles.wrapper} role="group" aria-label={label}>
        <span className={styles.fixed}>{readOnlyText ?? `${value} ${unit ?? ""}`}</span>
      </div>
    );
  }

  return (
    <div className={styles.wrapper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.button}
        aria-label={decrementLabel}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step, min, max))}
      >
        −
      </button>
      <input
        className={styles.field}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") setDraft(String(value));
        }}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
      <button
        type="button"
        className={styles.button}
        aria-label={incrementLabel}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step, min, max))}
      >
        +
      </button>
    </div>
  );
}
