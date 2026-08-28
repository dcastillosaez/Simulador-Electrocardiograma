import { NumberField, Select } from "@ui-system/components/controls/index";
import type { ParameterRange } from "../types/rhythms";
import styles from "./PatientEditor.module.css";

/** Cómo se llama cada mando en pantalla, y en qué unidades se piensa.
 *
 * Los nombres del catálogo son del motor y van en hercios, porque ahí todo va
 * en unidades SI. Una frecuencia se piensa en latidos por minuto, así que la
 * conversión vive aquí —igual que en `HeartRateControl`— y no en el
 * componente genérico, que no sabe de fisiología.
 */
interface ControlSpec {
  label: string;
  unit?: string;
  /** Del valor del motor al que se enseña. */
  toDisplay: (value: number) => number;
  /** Y de vuelta. */
  toEngine: (value: number) => number;
  step: number;
  hint?: (displayed: number) => string;
}

const PER_MINUTE: Omit<ControlSpec, "label"> = {
  unit: "lpm",
  toDisplay: (hz) => Math.round(hz * 60),
  toEngine: (bpm) => bpm / 60,
  step: 5,
};

export const RHYTHM_CONTROLS: Record<string, ControlSpec> = {
  atrial_rate_hz: {
    label: "Frecuencia auricular",
    ...PER_MINUTE,
    hint: (bpm) =>
      bpm >= 250
        ? "Las ondas F del circuito auricular, que no cambian con el bloqueo."
        : "El nodo sinusal, que en un bloqueo completo va a lo suyo.",
  },
  escape_rate_hz: {
    label: "Frecuencia de escape",
    ...PER_MINUTE,
    hint: (bpm) =>
      bpm >= 40
        ? "Escape de la unión: relativamente estable."
        : "Escape ventricular: lento e inestable, mal tolerado.",
  },
  ventricular_rate_hz: {
    label: "Frecuencia del foco",
    ...PER_MINUTE,
  },
  conduction_ratio: {
    label: "Conducción AV",
    toDisplay: (value) => value,
    toEngine: (value) => value,
    step: 1,
    hint: (ratio) => `Conduce una de cada ${ratio} ondas F.`,
  },
};

export interface RhythmControlsProps {
  /** Los rangos que publica el catálogo para este ritmo. */
  ranges: Record<string, ParameterRange>;
  /** Los valores vigentes, tal y como los devolvió el servidor. */
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
  /** El pulso que resulta de todo lo anterior, en lpm. */
  pulseBpm: number | null;
}

/** Los mandos propios de un ritmo, cuando su frecuencia no cabe en un número.
 *
 * Un flutter tiene una aurícula girando a su velocidad y un nodo AV que deja
 * pasar una de cada dos, tres o cuatro; un bloqueo completo tiene dos
 * marcapasos que no se hablan. Antes de esto, esos ritmos declaraban su
 * frecuencia como fija y el panel enseñaba «150 lpm (fija)»: cierto para el
 * programa, falso para el paciente.
 *
 * El pulso no es uno de los controles: es lo que sale de ellos, y por eso se
 * muestra abajo y no se puede escribir. Es la misma idea que la previsión del
 * editor de paciente.
 */
export function RhythmControls({
  ranges,
  values,
  onChange,
  pulseBpm,
}: RhythmControlsProps) {
  return (
    <>
      {Object.entries(ranges).map(([name, range]) => {
        const spec = RHYTHM_CONTROLS[name];
        // Un mando que el catálogo declare y esta versión de la interfaz no
        // conozca todavía se ignora en silencio: mejor un control de menos
        // que una caja sin nombre y sin unidades.
        if (!spec) return null;
        const current = values[name] ?? range.default;
        const displayed = spec.toDisplay(current);

        return (
          <div className={styles.field} key={name}>
            <span className={styles.fieldLabel}>{spec.label}</span>
            {name === "conduction_ratio" ? (
              <Select
                label={spec.label}
                value={String(Math.round(displayed))}
                options={ratioOptions(range)}
                onChange={(value) => onChange(name, spec.toEngine(Number(value)))}
              />
            ) : (
              <NumberField
                label={spec.label}
                value={displayed}
                min={spec.toDisplay(range.minimum)}
                max={spec.toDisplay(range.maximum)}
                step={spec.step}
                unit={spec.unit}
                decrementLabel={`Bajar ${spec.label.toLowerCase()}`}
                incrementLabel={`Subir ${spec.label.toLowerCase()}`}
                onChange={(value) => onChange(name, spec.toEngine(value))}
              />
            )}
            {spec.hint && <p className={styles.hint}>{spec.hint(displayed)}</p>}
          </div>
        );
      })}
      {pulseBpm !== null && (
        <p className={styles.anticipated}>
          Pulso: <strong>{Math.round(pulseBpm)} lpm</strong>
        </p>
      )}
    </>
  );
}

/** «2:1», «3:1», «4:1» — como se escribe en un informe, no como un número. */
function ratioOptions(range: ParameterRange) {
  const options = [];
  for (let ratio = range.minimum; ratio <= range.maximum; ratio += 1) {
    options.push({ value: String(ratio), label: `${ratio}:1` });
  }
  return options;
}
