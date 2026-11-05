import { describe, expect, it } from "vitest";
import { ElectricalTimeline, createSegmentWindow } from "./electrical-timeline";
import type { ElectricalImpulsePayload } from "../types/ws-messages";
import { writePulseUniforms } from "../ui/Cardiac3D/ConductionSystem/conduction-pulse";
import { createConductionUniforms } from "../ui/Cardiac3D/ConductionSystem/conduction-material";
import { CONDUCTION_STRUCTURES } from "../ui/Cardiac3D/ConductionSystem/conduction-structures";

/** Un impulso sinusal completo que empieza en `t0`. Los números enseñan la
 * forma; los de verdad los manda el servidor. */
function sinus(impulse: number, t0: number): ElectricalImpulsePayload {
  return {
    impulse,
    origin: "sinus",
    outcome: "conducted",
    segments: [
      { structure: "sa_node", t_start_s: t0, t_end_s: t0 },
      { structure: "right_atrium", t_start_s: t0, t_end_s: t0 + 0.1 },
      { structure: "left_atrium", t_start_s: t0 + 0.03, t_end_s: t0 + 0.1 },
      { structure: "av_node", t_start_s: t0 + 0.1, t_end_s: t0 + 0.13 },
      { structure: "his_bundle", t_start_s: t0 + 0.13, t_end_s: t0 + 0.15 },
      { structure: "bundle_branches", t_start_s: t0 + 0.15, t_end_s: t0 + 0.175 },
      { structure: "purkinje", t_start_s: t0 + 0.15, t_end_s: t0 + 0.175 },
      { structure: "ventricular_myocardium", t_start_s: t0 + 0.175, t_end_s: t0 + 0.265 },
      { structure: "ventricular_recovery", t_start_s: t0 + 0.4, t_end_s: t0 + 0.6 },
    ],
  };
}

function blocked(impulse: number, t0: number): ElectricalImpulsePayload {
  return {
    impulse,
    origin: "sinus",
    outcome: "blocked",
    segments: [
      { structure: "sa_node", t_start_s: t0, t_end_s: t0 },
      { structure: "right_atrium", t_start_s: t0, t_end_s: t0 + 0.1 },
      { structure: "left_atrium", t_start_s: t0 + 0.03, t_end_s: t0 + 0.1 },
      { structure: "av_node", t_start_s: t0 + 0.1, t_end_s: t0 + 0.1 },
    ],
  };
}

describe("ElectricalTimeline", () => {
  it("devuelve el tramo vigente de una estructura", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)]);
    const window = timeline.windowAt(["his_bundle"], 1.14, createSegmentWindow());
    expect(window.found).toBe(true);
    expect(window.startS).toBeCloseTo(1.13);
    expect(window.endS).toBeCloseTo(1.15);
  });

  it("une las dos aurículas en una sola ventana", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)]);
    const window = timeline.windowAt(
      ["right_atrium", "left_atrium"],
      1.05,
      createSegmentWindow()
    );
    expect(window.startS).toBeCloseTo(1);
    expect(window.endS).toBeCloseTo(1.1);
  });

  it("antes de empezar no hay nada que enseñar", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)]);
    expect(timeline.windowAt(["sa_node"], 0.99, createSegmentWindow()).found).toBe(false);
  });

  it("deduplica por época, origen e impulso", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)], 0);
    timeline.push([sinus(0, 1)], 0);
    expect(timeline.size).toBe(1);
    // El escape de un bloqueo completo numera aparte: mismo número, otro
    // impulso.
    timeline.push([{ ...sinus(0, 2), origin: "ventricular" }], 0);
    expect(timeline.size).toBe(2);
  });

  it("al reconstruirse la fuente descarta lo anunciado para después", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1), sinus(1, 1.8), sinus(2, 2.6)], 0);
    // La fuente se reconstruye en t = 2: el impulso de 2,6 no va a existir.
    timeline.push([sinus(0, 2.2)], 2);
    const starts = [0.5, 1.5, 2.1, 2.65].map(
      (t) => timeline.windowAt(["sa_node"], t, createSegmentWindow()).startS
    );
    expect(starts).toEqual([0, 1, 1.8, 2.2]);
    expect(timeline.size).toBe(3);
  });

  it("el impulso bloqueado se marca como tal", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([blocked(3, 1)]);
    const window = timeline.windowAt(["av_node"], 1.2, createSegmentWindow());
    expect(window.blocked).toBe(true);
    expect(timeline.windowAt(["his_bundle"], 1.2, createSegmentWindow()).found).toBe(false);
  });

  it("encuentra el siguiente y el anterior límite de tramo", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)]);
    expect(timeline.boundaryFrom(1.11, 1)).toBeCloseTo(1.13);
    expect(timeline.boundaryFrom(1.11, -1)).toBeCloseTo(1.1);
    expect(timeline.boundaryFrom(5, 1)).toBeNull();
  });

  it("poda lo que ya terminó y limpia del todo", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1), sinus(1, 2)]);
    timeline.prune(1.7);
    expect(timeline.size).toBe(1);
    timeline.clear();
    expect(timeline.size).toBe(0);
  });
});

describe("writePulseUniforms", () => {
  const his = CONDUCTION_STRUCTURES.indexOf("his_bundle");
  const purkinje = CONDUCTION_STRUCTURES.indexOf("purkinje");
  const left = CONDUCTION_STRUCTURES.indexOf("left_bundle_branch");
  const sa = CONDUCTION_STRUCTURES.indexOf("sa_node");

  it("coloca el frente donde va el impulso dentro de su tramo", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)]);
    const uniforms = createConductionUniforms();
    writePulseUniforms(timeline, 1.14, uniforms);
    expect(uniforms.uFront.value[his]).toBeCloseTo(0.5);
    expect(uniforms.uGlow.value[his]).toBe(1);
    // Ramas y Purkinje comparten tramo y frente.
    writePulseUniforms(timeline, 1.16, uniforms);
    expect(uniforms.uFront.value[purkinje]).toBeCloseTo(uniforms.uFront.value[left]);
  });

  it("es función pura del instante, se llegue desde donde se llegue", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1), sinus(1, 1.8)]);
    const forward = createConductionUniforms();
    const backward = createConductionUniforms();
    for (let t = 0.9; t <= 2.0; t += 0.01) writePulseUniforms(timeline, t, forward);
    writePulseUniforms(timeline, 1.95, forward);
    for (let t = 2.6; t >= 1.95; t -= 0.037) writePulseUniforms(timeline, t, backward);
    writePulseUniforms(timeline, 1.95, backward);
    expect(backward.uFront.value).toEqual(forward.uFront.value);
    expect(backward.uGlow.value).toEqual(forward.uGlow.value);
  });

  it("una marca de duración cero brilla y se apaga", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([sinus(0, 1)]);
    const uniforms = createConductionUniforms();
    writePulseUniforms(timeline, 1.0, uniforms);
    expect(uniforms.uGlow.value[sa]).toBeCloseTo(1);
    writePulseUniforms(timeline, 2.0, uniforms);
    expect(uniforms.uFront.value[sa]).toBe(-1);
  });

  it("sin impulsos todo queda apagado", () => {
    const uniforms = createConductionUniforms();
    writePulseUniforms(new ElectricalTimeline(), 3, uniforms);
    expect(uniforms.uFront.value.every((v) => v === -1)).toBe(true);
  });
});
