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
}
