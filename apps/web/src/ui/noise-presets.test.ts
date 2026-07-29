import { describe, expect, it } from "vitest";
import { NOISE_PRESETS, matchPreset } from "./noise-presets";

describe("noise-presets", () => {
  it("matchPreset reconoce un preset exacto", () => {
    expect(matchPreset(NOISE_PRESETS.buena)).toBe("buena");
    expect(matchPreset(NOISE_PRESETS.perfecta)).toBe("perfecta");
  });

  it("matchPreset devuelve 'personalizada' para una combinacion que no coincide con ningun preset", () => {
    const noise = { ...NOISE_PRESETS.buena, emg_v: 0.123 };
    expect(matchPreset(noise)).toBe("personalizada");
  });
});
