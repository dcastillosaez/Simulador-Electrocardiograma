/** Contratos del catálogo de fármacos y del canal de farmacología.
 *
 * Espejo de `pharmacology_engine` y de los esquemas de `ecg_api`. El
 * frontend no calcula nada farmacológico: recibe concentraciones, dosis
 * acumuladas y estado fisiológico ya resueltos y los pinta.
 */

export type DrugCategoryId =
  | "antiarrhythmic"
  | "beta_blocker"
  | "calcium_blocker"
  | "sympathomimetic"
  | "parasympatholytic"
  | "electrolyte";

/** Rótulos clínicos de las familias. Viven aquí y no en el servidor porque
 * son texto de interfaz: el servidor manda identificadores estables, la
 * interfaz decide cómo se llaman en pantalla. */
export const DRUG_CATEGORY_LABEL: Record<DrugCategoryId, string> = {
  antiarrhythmic: "Antiarrítmicos",
  beta_blocker: "Betabloqueantes",
  calcium_blocker: "Calcioantagonistas",
  sympathomimetic: "Simpaticomiméticos",
  parasympatholytic: "Parasimpaticolíticos",
  electrolyte: "Electrolitos",
};

/** El orden en que se muestran las familias. Fijo: una lista de filtros que
 * cambia de orden entre sesiones es una lista que no se puede memorizar. */
export const DRUG_CATEGORY_ORDER: DrugCategoryId[] = [
  "antiarrhythmic",
  "beta_blocker",
  "calcium_blocker",
  "sympathomimetic",
  "parasympatholytic",
  "electrolyte",
];

export interface DrugSummary {
  drug_id: string;
  display_name: string;
  category: DrugCategoryId;
  routes: string[];
  dose_unit: string;
  reference_dose: number;
  max_cumulative_dose: number;
  onset_s: number;
  peak_s: number;
  duration_s: number;
}

export interface DrugDetail extends DrugSummary {
  half_life_s: number;
  clinical_note: string;
  references: string[];
  effects: Record<string, number>;
}

/** Un fármaco vivo en el instante actual.
 *
 * `concentration` (0–1) es lo que llena la barra; `intensity` incluye la
 * dosis acumulada y puede pasar de 1. Son dos números distintos a
 * propósito: una barra llena no significa dosis máxima. */
export interface ActiveDrug {
  drug_id: string;
  display_name: string;
  category: DrugCategoryId;
  concentration: number;
  intensity: number;
  cumulative_dose: number;
  dose_unit: string;
  elapsed_s: number;
  remaining_s: number;
}

export interface FiredInteraction {
  rule_id: string;
  description: string;
  intensity: number;
  drug_ids: string[];
}

export interface DrugAdministrationRecord {
  id: string;
  drug_id: string;
  dose: number;
  dose_unit: string;
  route: string;
  t_s: number;
  operator: string | null;
  notes: string | null;
}
