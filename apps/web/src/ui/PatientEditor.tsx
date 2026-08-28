import { useEffect, useState, type ReactNode } from "react";
import { ControlGroup } from "@ui-system/components/surface/index";
import { NumberField, Select, Slider } from "@ui-system/components/controls/index";
import type { CatalogClient } from "../simulation-runtime/catalog-client";
import type { ParameterRange } from "../types/rhythms";
import {
  anticipatedVentricularRate,
  type AvConductionName,
  type CustomPatientSummary,
  type PatientPayload,
} from "../types/patients";
import styles from "./PatientEditor.module.css";

const CONDUCTION_LABELS: Record<AvConductionName, string> = {
  conducted: "Conducida 1:1",
  ratio: "Bloqueo fijo n:1",
  wenckebach: "Wenckebach",
  complete_block: "Bloqueo completo",
};

/** Lo que hace cada modo, en una línea. El editor es también material
 * docente: quien elige «Wenckebach» debería poder recordar aquí qué es. */
const CONDUCTION_HINTS: Record<AvConductionName, string> = {
  conducted: "Todas las P conducen con el mismo PR.",
  ratio: "Conduce una de cada n. Es el flutter 2:1 y el Mobitz II.",
  wenckebach: "El PR se alarga hasta que un latido cae, y vuelve a empezar.",
  complete_block:
    "Ninguna P alcanza el ventrículo, que late por su cuenta al ritmo de escape.",
};

/** Rango de emergencia si la API no lo trajo.
 *
 * No es una copia de los límites clínicos —esos los sirve el servidor en
 * `patient_parameters`— sino lo mínimo para que el control se pueda pintar
 * sin romperse mientras la petición está en vuelo. */
const FALLBACK: ParameterRange = { minimum: 0, maximum: 400, default: 0 };

/** Rótulo visible sobre un control.
 *
 * `NumberField` y `Slider` llevan su nombre en `aria-label`, que basta para
 * un lector de pantalla y no se ve. En un panel con tres campos seguidos
 * —PR, QRS, QT— eso deja tres cajas idénticas donde hay que adivinar cuál es
 * cuál, y adivinar un intervalo es justo lo contrario de lo que enseña este
 * simulador.
 */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

export interface PatientEditorProps {
  patient: PatientPayload;
  /** Los límites, tal y como los publica el catálogo para `custom_patient`. */
  ranges: Record<string, ParameterRange> | null;
  onChange: (patient: PatientPayload) => void;
  catalogClient: CatalogClient;
}

/** El editor del paciente inventado.
 *
 * Es el único sitio del puesto donde el usuario **escribe** fisiología en vez
 * de elegirla de un catálogo. Todo lo que se toca aquí se aplica en caliente:
 * mover el PR y ver cómo se separa la P del QRS es la mitad del valor
 * docente de esto.
 *
 * La previsión de frecuencia ventricular se calcula aquí y se enseña junto a
 * la conducción, pero no sustituye al panel derecho: aquello son medidas
 * sobre la señal generada, y esto es aritmética. Cuando las dos coinciden, el
 * alumno acaba de comprobar que el bloqueo hace lo que dice.
 */
export function PatientEditor({
  patient,
  ranges,
  onChange,
  catalogClient,
}: PatientEditorProps) {
  const range = (name: string) => ranges?.[name] ?? FALLBACK;
  const set = <K extends keyof PatientPayload>(
    key: K,
    value: PatientPayload[K]
  ) => onChange({ ...patient, [key]: value });

  const anticipated = Math.round(anticipatedVentricularRate(patient));
  const hasAtria = patient.atrial_rate_bpm > 0;

  return (
    <>
      <ControlGroup label="Aurícula">
        <Labeled label="FC auricular">
          <NumberField
            label="Frecuencia auricular"
            value={Math.round(patient.atrial_rate_bpm)}
            min={range("atrial_rate_bpm").minimum}
            max={range("atrial_rate_bpm").maximum}
            step={5}
            unit="lpm"
            decrementLabel="Bajar la frecuencia auricular"
            incrementLabel="Subir la frecuencia auricular"
            onChange={(value) => set("atrial_rate_bpm", value)}
          />
        </Labeled>
        <p className={styles.hint}>
          {hasAtria
            ? "Cero deja al paciente sin ondas P: el ventrículo pasa a depender del escape."
            : "Sin actividad auricular. El ventrículo late por escape."}
        </p>
        <Slider
          label="Onda P"
          value={patient.p_amplitude_scale}
          min={range("p_amplitude_scale").minimum}
          max={range("p_amplitude_scale").maximum}
          step={0.05}
          onChange={(value) => set("p_amplitude_scale", value)}
        />
        <p className={styles.hint}>
          {patient.p_amplitude_scale === 0
            ? "P invisible, pero la aurícula sigue despolarizando."
            : `${patient.p_amplitude_scale.toFixed(2)}× la P normal.`}
        </p>
      </ControlGroup>

      <ControlGroup label="Conducción AV">
        <Select
          label="Conducción auriculoventricular"
          value={patient.av_conduction}
          options={(Object.keys(CONDUCTION_LABELS) as AvConductionName[]).map(
            (value) => ({ value, label: CONDUCTION_LABELS[value] })
          )}
          onChange={(value) => set("av_conduction", value as AvConductionName)}
        />
        <p className={styles.hint}>{CONDUCTION_HINTS[patient.av_conduction]}</p>

        {patient.av_conduction === "ratio" && (
          <Labeled label="Relación de bloqueo">
            <NumberField
              label="Ondas P por cada QRS"
              value={patient.conduction_ratio}
              min={range("conduction_ratio").minimum}
              max={range("conduction_ratio").maximum}
              step={1}
              unit=":1"
              decrementLabel="Menos ondas P por QRS"
              incrementLabel="Más ondas P por QRS"
              onChange={(value) => set("conduction_ratio", value)}
            />
          </Labeled>
        )}

        {patient.av_conduction === "wenckebach" && (
          <>
            <Labeled label="Latidos por ciclo">
              <NumberField
                label="Latidos por ciclo"
                value={patient.wenckebach_cycle}
                min={range("wenckebach_cycle").minimum}
                max={range("wenckebach_cycle").maximum}
                step={1}
                decrementLabel="Ciclo más corto"
                incrementLabel="Ciclo más largo"
                onChange={(value) => set("wenckebach_cycle", value)}
              />
            </Labeled>
            <Labeled label="Alargamiento del PR">
              <NumberField
                label="Alargamiento del PR por latido"
                value={Math.round(patient.wenckebach_increment_ms)}
                min={range("wenckebach_increment_ms").minimum}
                max={range("wenckebach_increment_ms").maximum}
                step={10}
                unit="ms"
                decrementLabel="Alargar menos"
                incrementLabel="Alargar más"
                onChange={(value) => set("wenckebach_increment_ms", value)}
              />
            </Labeled>
            <p className={styles.hint}>
              De cada {patient.wenckebach_cycle} ondas P conducen{" "}
              {patient.wenckebach_cycle - 1}.
            </p>
          </>
        )}

        {(patient.av_conduction === "complete_block" || !hasAtria) && (
          <Labeled label="FC de escape">
            <NumberField
              label="Frecuencia de escape"
              value={Math.round(patient.escape_rate_bpm)}
              min={range("escape_rate_bpm").minimum}
              max={range("escape_rate_bpm").maximum}
              step={5}
              unit="lpm"
              decrementLabel="Bajar el escape"
              incrementLabel="Subir el escape"
              onChange={(value) => set("escape_rate_bpm", value)}
            />
          </Labeled>
        )}

        <p className={styles.anticipated}>
          Ventrículo: <strong>{anticipated} lpm</strong>
        </p>
      </ControlGroup>

      <ControlGroup label="Intervalos">
        {patient.av_conduction !== "complete_block" && hasAtria && (
          <Labeled label="PR">
            <NumberField
              label="PR"
              value={Math.round(patient.pr_ms)}
              min={range("pr_ms").minimum}
              max={range("pr_ms").maximum}
              step={10}
              unit="ms"
              decrementLabel="Acortar el PR"
              incrementLabel="Alargar el PR"
              onChange={(value) => set("pr_ms", value)}
            />
          </Labeled>
        )}
        <Labeled label="QRS">
          <NumberField
            label="QRS"
            value={Math.round(patient.qrs_ms)}
            min={range("qrs_ms").minimum}
            max={range("qrs_ms").maximum}
            step={10}
            unit="ms"
            decrementLabel="Estrechar el QRS"
            incrementLabel="Ensanchar el QRS"
            onChange={(value) =>
              // El QT se mide DESDE el inicio del QRS, así que nunca puede ser
              // más corto: en vez de rechazar el cambio, se empuja el QT. Un
              // control que se niega a moverse sin decir por qué se lee como
              // una avería.
              onChange({
                ...patient,
                qrs_ms: value,
                qt_ms: Math.max(patient.qt_ms, value + 100),
              })
            }
          />
        </Labeled>
        <p className={styles.hint}>
          {patient.qrs_ms >= 120
            ? "Ancho: se dibuja con morfología de origen ventricular."
            : "Estrecho: conducción por el sistema His-Purkinje."}
        </p>
        <Labeled label="QT">
          <NumberField
            label="QT"
            value={Math.round(patient.qt_ms)}
            min={range("qt_ms").minimum}
            max={range("qt_ms").maximum}
            step={10}
            unit="ms"
            decrementLabel="Acortar el QT"
            incrementLabel="Alargar el QT"
            onChange={(value) => set("qt_ms", Math.max(value, patient.qrs_ms + 100))}
          />
        </Labeled>
      </ControlGroup>

      <ControlGroup label="Morfología">
        <Slider
          label="ST (mV)"
          value={patient.st_shift_mv}
          min={range("st_shift_mv").minimum}
          max={range("st_shift_mv").maximum}
          step={0.05}
          onChange={(value) => set("st_shift_mv", value)}
        />
        <p className={styles.hint}>
          {patient.st_shift_mv === 0
            ? "ST isoeléctrico."
            : `${patient.st_shift_mv > 0 ? "Elevación" : "Descenso"} de ${Math.abs(
                patient.st_shift_mv * 10
              ).toFixed(1)} mm.`}
        </p>
        <Slider
          label="Onda T"
          value={patient.t_amplitude_scale}
          min={range("t_amplitude_scale").minimum}
          max={range("t_amplitude_scale").maximum}
          step={0.1}
          onChange={(value) => set("t_amplitude_scale", value)}
        />
        <p className={styles.hint}>
          {patient.t_amplitude_scale < 0
            ? "T invertida."
            : `${patient.t_amplitude_scale.toFixed(1)}× la T normal.`}
        </p>
      </ControlGroup>

      <ControlGroup label="Constantes">
        <Labeled label="TA sistólica">
          <NumberField
            label="Tensión sistólica"
            value={Math.round(patient.systolic_bp_mmhg)}
            min={range("systolic_bp_mmhg").minimum}
            max={range("systolic_bp_mmhg").maximum}
            step={5}
            unit="mmHg"
            decrementLabel="Bajar la sistólica"
            incrementLabel="Subir la sistólica"
            onChange={(value) =>
              onChange({
                ...patient,
                systolic_bp_mmhg: value,
                // La diastólica no puede quedar por encima: es un estado
                // imposible y el servidor lo rechazaría.
                diastolic_bp_mmhg: Math.min(patient.diastolic_bp_mmhg, value),
              })
            }
          />
        </Labeled>
        <Labeled label="TA diastólica">
          <NumberField
            label="Tensión diastólica"
            value={Math.round(patient.diastolic_bp_mmhg)}
            min={range("diastolic_bp_mmhg").minimum}
            max={range("diastolic_bp_mmhg").maximum}
            step={5}
            unit="mmHg"
            decrementLabel="Bajar la diastólica"
            incrementLabel="Subir la diastólica"
            onChange={(value) =>
              set("diastolic_bp_mmhg", Math.min(value, patient.systolic_bp_mmhg))
            }
          />
        </Labeled>
        <Labeled label="FR">
          <NumberField
            label="Frecuencia respiratoria"
            value={Math.round(patient.respiratory_rate_bpm)}
            min={range("respiratory_rate_bpm").minimum}
            max={range("respiratory_rate_bpm").maximum}
            step={1}
            unit="rpm"
            decrementLabel="Bajar la frecuencia respiratoria"
            incrementLabel="Subir la frecuencia respiratoria"
            onChange={(value) => set("respiratory_rate_bpm", value)}
          />
        </Labeled>
        <Labeled label="Volumen sistólico">
          <NumberField
            label="Volumen sistólico"
            value={Math.round(patient.stroke_volume_ml)}
            min={range("stroke_volume_ml").minimum}
            max={range("stroke_volume_ml").maximum}
            step={5}
            unit="mL"
            decrementLabel="Bajar el volumen sistólico"
            incrementLabel="Subir el volumen sistólico"
            onChange={(value) => set("stroke_volume_ml", value)}
          />
        </Labeled>
      </ControlGroup>

      <PatientLibrary
        patient={patient}
        catalogClient={catalogClient}
        onLoad={onChange}
      />
    </>
  );
}

interface PatientLibraryProps {
  patient: PatientPayload;
  catalogClient: CatalogClient;
  onLoad: (patient: PatientPayload) => void;
}

/** Guardar, cargar y borrar casos con nombre.
 *
 * Sin base de datos el resto del editor sigue funcionando —se configura un
 * paciente y se usa— así que un fallo aquí se cuenta y no se propaga: lo que
 * se pierde es la biblioteca, no la sesión.
 */
function PatientLibrary({ patient, catalogClient, onLoad }: PatientLibraryProps) {
  const [saved, setSaved] = useState<CustomPatientSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const refresh = () =>
    catalogClient
      .listPatients()
      .then(setSaved)
      .catch((err: unknown) => {
        setAvailable(false);
        setError(String(err));
      });

  useEffect(() => {
    void refresh();
    // El cliente es estable durante toda la sesión: se construye una vez en
    // el workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogClient]);

  if (!available) {
    return (
      <ControlGroup label="Casos guardados">
        <p className={styles.hint}>
          No disponible: la aplicación arrancó sin base de datos. El paciente
          se puede configurar y usar igual, pero no guardar.
        </p>
      </ControlGroup>
    );
  }

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    setStatus(null);
    try {
      await action();
      setStatus(done);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLoad = async (id: string) => {
    setSelectedId(id);
    if (!id) return;
    await run(async () => {
      const detail = await catalogClient.getPatient(id);
      onLoad(detail.patient);
      setName(detail.name);
    }, "Caso cargado.");
  };

  return (
    <ControlGroup label="Casos guardados">
      <Select
        label="Cargar un caso"
        value={selectedId}
        placeholder="Elige un caso guardado"
        options={saved.map((row) => ({ value: row.id, label: row.name }))}
        onChange={(id) => void handleLoad(id)}
      />
      <label className={styles.nameField}>
        <span className={styles.nameLabel}>Nombre del caso</span>
        <input
          className={styles.nameInput}
          type="text"
          value={name}
          maxLength={120}
          placeholder="Bloqueo para la clase del martes"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          disabled={!name.trim()}
          onClick={() =>
            void run(
              () => catalogClient.createPatient(name.trim(), patient),
              "Caso guardado."
            )
          }
        >
          Guardar como nuevo
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={!selectedId || !name.trim()}
          onClick={() =>
            void run(
              () =>
                catalogClient.updatePatient(selectedId, name.trim(), patient),
              "Caso actualizado."
            )
          }
        >
          Actualizar
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={!selectedId}
          onClick={() =>
            void run(async () => {
              await catalogClient.deletePatient(selectedId);
              setSelectedId("");
            }, "Caso borrado.")
          }
        >
          Borrar
        </button>
      </div>
      {status && <p className={styles.status}>{status}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ControlGroup>
  );
}
