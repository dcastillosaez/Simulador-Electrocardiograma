import { useEffect, useMemo, useState } from "react";
import { ControlGroup } from "@ui-system/components/surface/index";
import { NumberField, Select } from "@ui-system/components/controls/index";
import { Badge } from "@ui-system/components/data/index";
import type { CatalogClient } from "../simulation-runtime/catalog-client";
import {
  DRUG_CATEGORY_LABEL,
  DRUG_CATEGORY_ORDER,
  type ActiveDrug,
  type DrugCategoryId,
  type DrugSummary,
  type FiredInteraction,
} from "../types/drugs";
import styles from "./PharmacologyPanel.module.css";

export interface PharmacologyPanelProps {
  catalogClient: CatalogClient;
  /** Fármacos vivos ahora mismo, publicados por el servidor. */
  activeDrugs: ActiveDrug[];
  interactions: FiredInteraction[];
  /** Sin sesión no se puede administrar: el servidor rechazaría el mensaje
   * y el usuario vería un error en vez de entender que primero hay que
   * elegir un ritmo. */
  disabled: boolean;
  onAdminister: (drugId: string, dose: number, route: string) => void;
}

/** Segundos a `m:ss`, o a segundos pelados por debajo del minuto.
 *
 * La adenosina dura treinta segundos y la digoxina seis horas: un formato
 * único obligaría a leer «0:08» para lo primero o «21600 s» para lo
 * segundo. */
export function formatRemaining(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Redondeo de dosis que no miente en ninguna escala.
 *
 * El catálogo va de 0,1 mg de noradrenalina a 1000 mg de procainamida.
 * Redondear a entero convertiría la noradrenalina en «0 mg». */
export function formatDose(dose: number, unit: string): string {
  const text = dose < 1 ? dose.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(dose * 10) / 10);
  return `${text} ${unit}`;
}

export function PharmacologyPanel({
  catalogClient,
  activeDrugs,
  interactions,
  disabled,
  onAdminister,
}: PharmacologyPanelProps) {
  const [drugs, setDrugs] = useState<DrugSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<DrugCategoryId | "">("");
  const [drugId, setDrugId] = useState<string>("");
  const [dose, setDose] = useState<number | null>(null);
  const [route, setRoute] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    catalogClient
      .listDrugs()
      .then((list) => {
        if (!cancelled) setDrugs(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [catalogClient]);

  const categories = useMemo(() => {
    const present = new Set(drugs.map((d) => d.category));
    return DRUG_CATEGORY_ORDER.filter((c) => present.has(c));
  }, [drugs]);

  const visibleDrugs = useMemo(
    () => (category ? drugs.filter((d) => d.category === category) : drugs),
    [drugs, category]
  );

  const selected = useMemo(
    () => drugs.find((d) => d.drug_id === drugId) ?? null,
    [drugs, drugId]
  );

  // Al cambiar de molécula, la dosis y la vía vuelven a las suyas. Conservar
  // «300» al pasar de amiodarona a atropina dejaría el campo cargado con
  // trescientas veces la dosis máxima, y bastaría un clic para administrarla.
  useEffect(() => {
    if (!selected) {
      setDose(null);
      setRoute("");
      return;
    }
    setDose(selected.reference_dose);
    setRoute(selected.routes[0] ?? "IV");
  }, [selected]);

  const handleCategory = (value: string) => {
    setCategory(value as DrugCategoryId | "");
    // El fármaco elegido puede no pertenecer a la familia nueva: dejarlo
    // seleccionado mostraría un desplegable que no contiene su propio valor.
    setDrugId("");
  };

  const canAdminister = !disabled && selected !== null && dose !== null && dose > 0;

  const handleAdminister = () => {
    if (!canAdminister || !selected || dose === null) return;
    onAdminister(selected.drug_id, dose, route || selected.routes[0] || "IV");
  };

  if (loadError) {
    return (
      <ControlGroup label="Farmacología">
        <p role="alert">No se pudo cargar el catálogo de fármacos: {loadError}</p>
      </ControlGroup>
    );
  }

  return (
    <>
      <ControlGroup label="Farmacología">
        <Select
          label="Categoría"
          value={category}
          placeholder="Todas las categorías"
          options={categories.map((c) => ({
            value: c,
            label: DRUG_CATEGORY_LABEL[c],
          }))}
          onChange={handleCategory}
        />
        <Select
          label="Medicamento"
          value={drugId}
          placeholder="Elige un medicamento"
          options={visibleDrugs.map((d) => ({
            value: d.drug_id,
            label: d.display_name,
          }))}
          onChange={setDrugId}
        />
        {selected && dose !== null && (
          <>
            {/* El paso es una décima de la dosis de referencia: con un paso
                fijo de 1, subir la noradrenalina de 0,1 a 0,2 sería
                imposible y bajar la procainamida de 500 costaría cientos de
                clics. */}
            <NumberField
              label="Dosis"
              value={dose}
              min={0}
              max={selected.max_cumulative_dose}
              step={Math.max(selected.reference_dose / 10, 0.01)}
              unit={selected.dose_unit}
              decrementLabel="Bajar dosis"
              incrementLabel="Subir dosis"
              onChange={setDose}
            />
            <Select
              label="Vía"
              value={route}
              options={selected.routes.map((r) => ({ value: r, label: r }))}
              onChange={setRoute}
            />
            <p className={styles.note}>
              Referencia {formatDose(selected.reference_dose, selected.dose_unit)} ·
              máximo acumulado {formatDose(selected.max_cumulative_dose, selected.dose_unit)}
            </p>
          </>
        )}
        <button
          type="button"
          className={styles.administer}
          onClick={handleAdminister}
          disabled={!canAdminister}
        >
          Administrar
        </button>
        {disabled && (
          <p role="status" className={styles.note}>
            Elige un ritmo antes de administrar.
          </p>
        )}
      </ControlGroup>

      <ControlGroup label="Medicamentos activos">
        {activeDrugs.length === 0 ? (
          <p role="status" className={styles.note}>
            Ninguno.
          </p>
        ) : (
          <ul className={styles.activeList}>
            {activeDrugs.map((drug) => (
              <li key={drug.drug_id} className={styles.activeItem}>
                <div className={styles.activeHeader}>
                  <span className={styles.activeName}>{drug.display_name}</span>
                  <span className={styles.activeDose}>
                    {formatDose(drug.cumulative_dose, drug.dose_unit)}
                  </span>
                </div>
                {/* `progressbar` y no una barra decorativa: la concentración
                    es información clínica y un lector de pantalla tiene que
                    poder leerla. */}
                <div
                  className={styles.bar}
                  role="progressbar"
                  aria-label={`Concentración de ${drug.display_name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(drug.concentration * 100)}
                >
                  <div
                    className={styles.barFill}
                    style={{ width: `${Math.round(drug.concentration * 100)}%` }}
                  />
                </div>
                <div className={styles.activeFooter}>
                  <span>{DRUG_CATEGORY_LABEL[drug.category]}</span>
                  <span>{formatRemaining(drug.remaining_s)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {interactions.length > 0 && (
          <ul className={styles.interactionList}>
            {interactions.map((interaction) => (
              <li key={interaction.rule_id} className={styles.interaction}>
                <Badge tone="warning">Interacción</Badge>
                <span>{interaction.description}</span>
              </li>
            ))}
          </ul>
        )}
      </ControlGroup>
    </>
  );
}
