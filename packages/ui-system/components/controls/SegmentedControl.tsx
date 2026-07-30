import { useId } from "react";
import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
}

/** Un grupo de radios con aspecto de botonera de consola.
 *
 * Radios de verdad y no botones: el teclado ya sabe recorrer un radiogroup con
 * las flechas, y un lector de pantalla anuncia "2 de 4". Reimplementar eso con
 * botones sale siempre peor.
 *
 * Absorbe cuatro usos —derivaciones, presets de ruido, velocidad de papel y
 * selector de tema—, que de otro modo serían cuatro componentes casi
 * idénticos. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId();

  return (
    <fieldset className={styles.group} role="radiogroup" aria-label={label}>
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`${styles.option} ${option.value === value ? styles.selected : ""}`}
        >
          <input
            className={styles.input}
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.text}>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
