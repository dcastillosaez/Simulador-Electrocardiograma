import type { NoiseParamsPayload } from "../types/engine-params";

export type ConcretePresetId =
  | "perfecta" | "buena" | "urgencias" | "ambulancia" | "uci" | "muy_mala";
export type PresetId = ConcretePresetId | "personalizada";

// Valores de primer trazo, calibrables tras la revision clinica (criterio
// de aceptacion 7): el orden de magnitud es lo que importa aqui, no el
// numero exacto de cada campo.
export const NOISE_PRESETS: Record<ConcretePresetId, NoiseParamsPayload> = {
  perfecta:   { emg_v: 0.0,   mains_v: 0.0,   baseline_v: 0.0,  motion_v: 0.0,  clip_v: null },
  buena:      { emg_v: 0.005, mains_v: 0.01,  baseline_v: 0.02, motion_v: 0.0,  clip_v: null },
  urgencias:  { emg_v: 0.02,  mains_v: 0.02,  baseline_v: 0.05, motion_v: 0.03, clip_v: null },
  ambulancia: { emg_v: 0.05,  mains_v: 0.03,  baseline_v: 0.1,  motion_v: 0.15, clip_v: null },
  uci:        { emg_v: 0.015, mains_v: 0.015, baseline_v: 0.03, motion_v: 0.02, clip_v: null },
  // clip_v recorta la señal a [-clip_v, clip_v] (ver noise.py); la onda R
  // real mide ~0,001-0,002V, así que 0,5V no recortaba nada — era un
  // no-op. 0,0015V sí produce un recorte visible de los picos.
  muy_mala:   { emg_v: 0.1,   mains_v: 0.05,  baseline_v: 0.2,  motion_v: 0.3,  clip_v: 0.0015 },
};

export const PRESET_LABELS: Record<PresetId, string> = {
  perfecta: "Perfecta",
  buena: "Buena",
  urgencias: "Urgencias",
  ambulancia: "Ambulancia",
  uci: "UCI",
  muy_mala: "Muy mala",
  personalizada: "Personalizada",
};

export function matchPreset(noise: NoiseParamsPayload): PresetId {
  const entry = (Object.entries(NOISE_PRESETS) as [ConcretePresetId, NoiseParamsPayload][]).find(
    ([, preset]) => sameNoise(preset, noise)
  );
  return entry ? entry[0] : "personalizada";
}

function sameNoise(a: NoiseParamsPayload, b: NoiseParamsPayload): boolean {
  return (
    a.emg_v === b.emg_v &&
    a.mains_v === b.mains_v &&
    a.baseline_v === b.baseline_v &&
    a.motion_v === b.motion_v &&
    a.clip_v === b.clip_v
  );
}
