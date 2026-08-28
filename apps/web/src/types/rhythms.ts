export interface ParameterRange {
  minimum: number;
  maximum: number;
  default: number;
}

export interface RhythmSummary {
  rhythm_id: string;
  display_name: string;
  category: string;
  ventricular_rate_hz: number;
  pr_is_measurable: boolean;
}

export interface RhythmDetail extends RhythmSummary {
  default_parameters: Record<string, number>;
  editable_parameters: Record<string, ParameterRange>;
  clinical_description: string;
  references: string[];
  allowed_overlays: string[];
  /** Los mandos propios del ritmo, si los tiene: la aurícula y el grado de
   * bloqueo de un flutter, el foco de una TV, la sinusal y el escape de un
   * bloqueo completo. Vacío en los ritmos que se manejan con la frecuencia. */
  rhythm_parameters: Record<string, ParameterRange>;
  /** Los límites del editor de paciente. Solo lo trae `custom_patient`; en
   * los doce ritmos del catálogo llega `null`, y eso es lo que distingue una
   * entrada configurable de un hallazgo clínico cerrado. */
  patient_parameters: Record<string, ParameterRange> | null;
}

/** El identificador del paciente personalizado, tal y como lo publica el
 * catálogo. Se compara contra él para saber cuándo abrir el editor. */
export const CUSTOM_PATIENT_ID = "custom_patient";
