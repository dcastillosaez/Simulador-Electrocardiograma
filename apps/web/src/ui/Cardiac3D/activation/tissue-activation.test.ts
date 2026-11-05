import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { ElectricalTimeline } from "../../../cardiac/electrical-timeline";
import type { ElectricalImpulsePayload } from "../../../types/ws-messages";
import {
  ACTIVATED_MESHES,
  ACTIVATION_ATTRIBUTE,
  ACTIVATION_MAP,
  TISSUES,
  attachActivation,
  createTissueUniforms,
  decodeActivation,
  vertexActivationTime,
  writeTissueUniforms,
} from "./tissue-activation";

/** Cuántos vértices trae cada malla en el `.glb` versionado, leídos del
 * propio fichero: el mapa se asigna por índice y tiene que corresponder al
 * modelo que se publica, no a uno anterior. */
function glbVertexCounts(): Record<string, number> {
  // Relativo a `apps/web`, que es desde donde corre vitest (local y en CI).
  const path = resolve(process.cwd(), "public/models/heart.glb");
  const data = readFileSync(path);
  const length = data.readUInt32LE(12);
  const doc = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
  const counts: Record<string, number> = {};
  for (const node of doc.nodes) {
    if (node.mesh === undefined) continue;
    const primitive = doc.meshes[node.mesh].primitives[0];
    counts[node.name] = doc.accessors[primitive.attributes.POSITION].count;
  }
  return counts;
}

function impulse(t0: number): ElectricalImpulsePayload {
  return {
    impulse: 0,
    origin: "sinus",
    outcome: "conducted",
    segments: [
      { structure: "right_atrium", t_start_s: t0, t_end_s: t0 + 0.1 },
      { structure: "left_atrium", t_start_s: t0 + 0.03, t_end_s: t0 + 0.1 },
      { structure: "ventricular_myocardium", t_start_s: t0 + 0.18, t_end_s: t0 + 0.27 },
      { structure: "ventricular_recovery", t_start_s: t0 + 0.45, t_end_s: t0 + 0.65 },
    ],
  };
}

describe("mapa de activación", () => {
  it("cubre las cinco mallas que se activan y cuadra con el modelo", () => {
    const counts = glbVertexCounts();
    expect(new Set(ACTIVATED_MESHES)).toEqual(
      new Set(["RightAtrium", "LeftAtrium", "LeftVentricle", "RightVentricle", "Myocardium"])
    );
    for (const name of ACTIVATED_MESHES) {
      expect(ACTIVATION_MAP.meshes[name].vertices).toBe(counts[name]);
      expect(decodeActivation(name)!.activation).toHaveLength(counts[name]);
    }
  });

  it("ningún vértice se activa fuera de su tramo", () => {
    for (const name of ACTIVATED_MESHES) {
      const { activation, tissue } = decodeActivation(name)!;
      for (let i = 0; i < activation.length; i += 1) {
        const f = activation[i];
        expect(f >= 0 && f <= 1).toBe(true);
        expect(tissue[i] >= 0 && tissue[i] < TISSUES.length).toBe(true);
        const t = vertexActivationTime(f, 2.0, 2.09);
        expect(t >= 2.0 && t <= 2.09 + 1e-12).toBe(true);
      }
    }
  });

  it("el miocardio sintetizado reparte sus vértices entre los tres tejidos", () => {
    const { tissue } = decodeActivation("Myocardium")!;
    const seen = new Set(tissue);
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it("añadir los atributos es idempotente y rechaza una malla que no cuadra", () => {
    const counts = glbVertexCounts();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(counts.LeftVentricle * 3), 3)
    );
    expect(attachActivation("LeftVentricle", geometry)).toBe(true);
    const first = geometry.getAttribute(ACTIVATION_ATTRIBUTE);
    expect(attachActivation("LeftVentricle", geometry)).toBe(true);
    expect(geometry.getAttribute(ACTIVATION_ATTRIBUTE)).toBe(first);

    const wrong = new BufferGeometry();
    wrong.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    const warn = console.warn;
    console.warn = () => {};
    expect(attachActivation("LeftVentricle", wrong)).toBe(false);
    console.warn = warn;
  });
});

describe("writeTissueUniforms", () => {
  const ventricles = TISSUES.indexOf("ventricular_myocardium");
  const right = TISSUES.indexOf("right_atrium");

  it("antes del tramo no hay nada encendido", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([impulse(1)]);
    const uniforms = createTissueUniforms();
    writeTissueUniforms(timeline, 0.5, uniforms);
    for (const value of uniforms.uTissue.value) expect(value.x).toBe(-1);
  });

  it("el ventrículo sigue despolarizado hasta su recuperación", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([impulse(1)]);
    const uniforms = createTissueUniforms();
    writeTissueUniforms(timeline, 1.3, uniforms);
    const v = uniforms.uTissue.value[ventricles];
    expect(v.x).toBeCloseTo(0.12);
    expect(v.y).toBeCloseTo(0.09);
    expect(v.z).toBe(1);
    expect(v.w).toBe(0);
    writeTissueUniforms(timeline, 1.55, uniforms);
    expect(uniforms.uTissue.value[ventricles].z).toBeCloseTo(0.5);
    expect(uniforms.uTissue.value[ventricles].w).toBeCloseTo(1);
    writeTissueUniforms(timeline, 1.7, uniforms);
    expect(uniforms.uTissue.value[ventricles].z).toBe(0);
  });

  it("la aurícula se apaga después de su tramo", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([impulse(1)]);
    const uniforms = createTissueUniforms();
    writeTissueUniforms(timeline, 1.05, uniforms);
    expect(uniforms.uTissue.value[right].z).toBe(1);
    writeTissueUniforms(timeline, 1.6, uniforms);
    expect(uniforms.uTissue.value[right].z).toBeLessThan(0.01);
  });

  it("no crea objetos: escribe en los vectores reservados", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([impulse(1)]);
    const uniforms = createTissueUniforms();
    const before = [...uniforms.uTissue.value];
    for (let t = 0; t < 2; t += 0.01) writeTissueUniforms(timeline, t, uniforms);
    uniforms.uTissue.value.forEach((value, i) => expect(value).toBe(before[i]));
  });

  it("es función pura del instante", () => {
    const timeline = new ElectricalTimeline();
    timeline.push([impulse(1), impulse(1.8)]);
    const a = createTissueUniforms();
    const b = createTissueUniforms();
    for (let t = 0; t < 2.4; t += 0.017) writeTissueUniforms(timeline, t, a);
    writeTissueUniforms(timeline, 2.0, a);
    for (let t = 3; t > 2.0; t -= 0.05) writeTissueUniforms(timeline, t, b);
    writeTissueUniforms(timeline, 2.0, b);
    expect(b.uTissue.value.map((v) => v.toArray())).toEqual(a.uTissue.value.map((v) => v.toArray()));
  });
});
