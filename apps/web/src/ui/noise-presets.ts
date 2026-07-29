import type { NoiseParamsPayload } from "../types/engine-params";

export type ConcretePresetId =
  | "perfecta" | "buena" | "urgencias" | "ambulancia" | "uci" | "muy_mala";
export type PresetId = ConcretePresetId | "personalizada";

// Amplitud de la onda R generada por el motor (ver
// `packages/ecg-engine/src/ecg_engine/beat.py`, componente QRS "R":
// amplitude_v=0.00100). Es la referencia de escala para todo el ruido
// aditivo del panel avanzado: un campo que supere unas pocas veces este
// valor ya no deja ver la onda R por encima del ruido.
export const R_WAVE_V = 0.001;

// Valores de primer trazo, calibrables tras la revision clinica (criterio
// de aceptacion 7): el orden de magnitud es lo que importa aqui, no el
// numero exacto de cada campo. Cada campo aditivo (emg_v/mains_v/
// baseline_v/motion_v) esta expresado como fraccion de R_WAVE_V para que
// la progresion de presets quede anclada a la amplitud real de la senal
// en vez de a numeros sueltos: perfecta < buena < uci < urgencias <
// ambulancia < muy_mala, con la onda R siempre distinguible salvo que el
// usuario mueva un slider mas alla del preset.
export const NOISE_PRESETS: Record<ConcretePresetId, NoiseParamsPayload> = {
  perfecta: { emg_v: 0.0, mains_v: 0.0, baseline_v: 0.0, motion_v: 0.0, clip_v: null },
  // Degradacion apenas perceptible: cada campo entre el 2% y el 6% de R_WAVE_V.
  buena: {
    emg_v: R_WAVE_V * 0.03,
    mains_v: R_WAVE_V * 0.04,
    baseline_v: R_WAVE_V * 0.06,
    motion_v: R_WAVE_V * 0.02,
    clip_v: null,
  },
  // Entre buena y urgencias, sin recorte.
  uci: {
    emg_v: R_WAVE_V * 0.06,
    mains_v: R_WAVE_V * 0.06,
    baseline_v: R_WAVE_V * 0.1,
    motion_v: R_WAVE_V * 0.04,
    clip_v: null,
  },
  // Degradacion moderada: varios campos entre el 8% y el 18% de R_WAVE_V, sin recorte.
  urgencias: {
    emg_v: R_WAVE_V * 0.1,
    mains_v: R_WAVE_V * 0.09,
    baseline_v: R_WAVE_V * 0.18,
    motion_v: R_WAVE_V * 0.08,
    clip_v: null,
  },
  // Mas peso en motion_v que en el resto (vibracion de vehiculo en marcha), sin recorte.
  ambulancia: {
    emg_v: R_WAVE_V * 0.12,
    mains_v: R_WAVE_V * 0.1,
    baseline_v: R_WAVE_V * 0.2,
    motion_v: R_WAVE_V * 0.4,
    clip_v: null,
  },
  // La peor, pero aun legible con esfuerzo: emg_v/baseline_v/motion_v entre
  // el 30% y el 60% de R_WAVE_V. clip_v recorta la señal a [-clip_v, clip_v]
  // (ver noise.py); 0,0015V produce un recorte visible de los picos sin
  // aplanar la onda R por completo.
  muy_mala: {
    emg_v: R_WAVE_V * 0.4,
    mains_v: R_WAVE_V * 0.15,
    baseline_v: R_WAVE_V * 0.5,
    motion_v: R_WAVE_V * 0.6,
    clip_v: 0.0015,
  },
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
