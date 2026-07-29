import { describe, expect, it } from "vitest";
import { NOISE_PRESETS, R_WAVE_V, type ConcretePresetId, matchPreset } from "./noise-presets";

const ADDITIVE_FIELDS = ["emg_v", "mains_v", "baseline_v", "motion_v"] as const;

describe("noise-presets", () => {
  it("matchPreset reconoce un preset exacto", () => {
    expect(matchPreset(NOISE_PRESETS.buena)).toBe("buena");
    expect(matchPreset(NOISE_PRESETS.perfecta)).toBe("perfecta");
  });

  it("matchPreset devuelve 'personalizada' para una combinacion que no coincide con ningun preset", () => {
    const noise = { ...NOISE_PRESETS.buena, emg_v: 0.123 };
    expect(matchPreset(noise)).toBe("personalizada");
  });

  it("ningun campo aditivo de ningun preset supera 1x R_WAVE_V", () => {
    // Guardarraíl de escala: el bug original (C1) pasó desapercibido porque
    // ningún test afirmaba nada sobre la magnitud de los valores de los
    // presets respecto a la amplitud real de la onda R, solo sobre el
    // round-trip de matchPreset. Con esto, un preset que vuelva a
    // calibrarse 100-300x por encima de R_WAVE_V rompe el test.
    for (const [presetId, preset] of Object.entries(NOISE_PRESETS) as [
      ConcretePresetId,
      (typeof NOISE_PRESETS)[ConcretePresetId],
    ][]) {
      for (const field of ADDITIVE_FIELDS) {
        expect(preset[field], `${presetId}.${field}`).toBeLessThanOrEqual(R_WAVE_V);
      }
    }
  });

  it("muy_mala es el preset con mas ruido aditivo total y perfecta el que tiene menos", () => {
    const totalNoise = (preset: (typeof NOISE_PRESETS)[ConcretePresetId]) =>
      ADDITIVE_FIELDS.reduce((sum, field) => sum + preset[field], 0);

    expect(totalNoise(NOISE_PRESETS.perfecta)).toBe(0);
    expect(totalNoise(NOISE_PRESETS.muy_mala)).toBeGreaterThan(totalNoise(NOISE_PRESETS.buena));
    expect(totalNoise(NOISE_PRESETS.muy_mala)).toBeGreaterThan(totalNoise(NOISE_PRESETS.urgencias));
    expect(totalNoise(NOISE_PRESETS.muy_mala)).toBeGreaterThan(totalNoise(NOISE_PRESETS.ambulancia));
  });

  it("la progresion buena < uci < urgencias < ambulancia es monotona en ruido total", () => {
    const totalNoise = (preset: (typeof NOISE_PRESETS)[ConcretePresetId]) =>
      ADDITIVE_FIELDS.reduce((sum, field) => sum + preset[field], 0);

    expect(totalNoise(NOISE_PRESETS.buena)).toBeLessThan(totalNoise(NOISE_PRESETS.uci));
    expect(totalNoise(NOISE_PRESETS.uci)).toBeLessThan(totalNoise(NOISE_PRESETS.urgencias));
    expect(totalNoise(NOISE_PRESETS.urgencias)).toBeLessThan(totalNoise(NOISE_PRESETS.ambulancia));
  });
});
