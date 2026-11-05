import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HeartStateValues } from "../../../cardiac/heart-state-timeline";
import { createConductionUniforms } from "../ConductionSystem/conduction-material";
import { CONDUCTION_STRUCTURES } from "../ConductionSystem/conduction-structures";
import { CONTINUOUS_MODE, hash01, writeContinuousActivity } from "./continuous-activity";
import { TISSUES, createTissueUniforms } from "./tissue-activation";

const BASE: HeartStateValues = {
  rhythm_id: "x",
  heart_rate_bpm: 150,
  atrial_mode: "synchronous",
  ventricular_mode: "synchronous",
  atrial_amplitude: 1,
  ventricular_amplitude: 1,
  flutter_hz: 5,
};

describe("writeContinuousActivity", () => {
  const pathways = CONDUCTION_STRUCTURES.indexOf("atrial_pathways");
  const purkinje = CONDUCTION_STRUCTURES.indexOf("purkinje");
  const right = TISSUES.indexOf("right_atrium");
  const ventricles = TISSUES.indexOf("ventricular_myocardium");

  it("un flutter recorre el circuito auricular a flutter_hz", () => {
    const conduction = createConductionUniforms();
    const tissue = createTissueUniforms();
    const state = { ...BASE, atrial_mode: "fluttering" as const };
    writeContinuousActivity(state, 10.05, conduction, tissue);
    expect(conduction.uFront.value[pathways]).toBeCloseTo(0.25);
    writeContinuousActivity(state, 10.15, conduction, tissue);
    expect(conduction.uFront.value[pathways]).toBeCloseTo(0.75);
    expect(tissue.uContinuous.value[right].x).toBe(CONTINUOUS_MODE.circuit);
    expect(tissue.uContinuous.value[ventricles].x).toBe(CONTINUOUS_MODE.none);
  });

  it("una fibrilación ventricular es caótica pero se repite igual en el repaso", () => {
    const state = { ...BASE, atrial_mode: "fibrillating" as const, ventricular_mode: "fibrillating" as const };
    const a = createConductionUniforms();
    const b = createConductionUniforms();
    const ta = createTissueUniforms();
    const tb = createTissueUniforms();
    for (let t = 0; t < 3; t += 0.016) writeContinuousActivity(state, t, a, ta);
    writeContinuousActivity(state, 2.5, a, ta);
    writeContinuousActivity(state, 2.5, b, tb);
    expect(b.uFront.value).toEqual(a.uFront.value);
    expect(b.uGlow.value).toEqual(a.uGlow.value);
    expect(tb.uContinuous.value.map((v) => v.toArray())).toEqual(
      ta.uContinuous.value.map((v) => v.toArray())
    );
    // Y cambia con el tiempo: no es una imagen fija.
    const fronts = new Set<number>();
    for (let t = 0; t < 1; t += 0.05) {
      writeContinuousActivity(state, t, a, ta);
      fronts.add(a.uFront.value[purkinje]);
    }
    expect(fronts.size).toBeGreaterThan(5);
  });

  it("un ritmo organizado no pisa lo que escribió el pulso", () => {
    const conduction = createConductionUniforms();
    conduction.uFront.value[pathways] = 0.4;
    writeContinuousActivity(BASE, 1, conduction, createTissueUniforms());
    expect(conduction.uFront.value[pathways]).toBe(0.4);
  });

  it("el generador del caos es determinista", () => {
    expect(hash01(12, 3)).toBe(hash01(12, 3));
    expect(hash01(12, 3)).not.toBe(hash01(13, 3));
  });
});

/** Ningún componente visual decide cómo se propaga el impulso preguntando por
 * el ritmo. Si alguno lo necesitara, el contrato habría fallado, igual que una
 * molécula que obligara a tocar código fuera de su YAML. */
describe("sin casos especiales por ritmo", () => {
  const ROOTS = [
    "src/ui/Cardiac3D/ConductionSystem",
    "src/ui/Cardiac3D/activation",
    "src/ui/review",
    "src/ui/ladder",
  ];
  const FILES = [
    "src/cardiac/electrical-timeline.ts",
    "src/cardiac/electrical-phase.ts",
    "src/cardiac/review-controller.ts",
    "src/cardiac/playback-clock.ts",
    "src/cardiac/ladder.ts",
    "src/ui/Cardiac3D/HeartModel.tsx",
  ];
  const RHYTHMS = [
    "sinus_normal",
    "sinus_tachycardia",
    "sinus_bradycardia",
    "atrial_fibrillation",
    "atrial_flutter",
    "svt",
    "ventricular_tachycardia",
    "ventricular_fibrillation",
    "av_block_first",
    "av_block_second_mobitz_i",
    "av_block_third",
    "custom_patient",
    "stemi_inferior",
  ];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it("los módulos de la propagación no nombran ningún ritmo ni leen rhythm_id", () => {
    const base = process.cwd();
    const files = [
      ...ROOTS.flatMap((root) => walk(resolve(base, root))),
      ...FILES.map((file) => resolve(base, file)),
    ].filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      // Los comentarios pueden nombrar lo que el código no hace; lo que se mira
      // es el código.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/rhythm_id/);
      for (const rhythm of RHYTHMS) {
        expect(text, `${file} nombra ${rhythm}`).not.toContain(`"${rhythm}"`);
      }
    }
  });
});
