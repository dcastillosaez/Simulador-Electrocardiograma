import type { PatientPayload } from "./patients";

export interface NoiseParamsPayload {
  emg_v: number;
  mains_v: number;
  baseline_v: number;
  motion_v: number;
  clip_v: number | null;
}

export interface VariabilityParamsPayload {
  respiration_hz: number;
  rsa_fraction: number;
  amplitude_fraction: number;
  rr_jitter_fraction: number;
}

export interface AxisParamsPayload {
  orientation_deg: number;
  p_offset_deg: number;
  qrs_offset_deg: number;
  st_offset_deg: number;
  t_offset_deg: number;
}

export interface EngineParamsPayload {
  heart_rate_hz: number;
  noise: NoiseParamsPayload;
  variability: VariabilityParamsPayload;
  axis: AxisParamsPayload;
  /** Los mandos propios del ritmo elegido. Vacío en los que se manejan con
   * `heart_rate_hz` a secas. */
  rhythm?: Record<string, number>;
  /** El paciente inventado, solo en el ritmo `custom_patient`. Los doce del
   * catálogo lo dejan sin poner. */
  patient?: PatientPayload;
}
