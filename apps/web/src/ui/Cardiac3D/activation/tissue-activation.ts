import { BufferAttribute, Vector4, type BufferGeometry, type MeshStandardMaterial } from "three";
import {
  createSegmentWindow,
  type ElectricalTimeline,
} from "../../../cardiac/electrical-timeline";
import type { ElectricalStructureName } from "../../../types/ws-messages";
import type { HeartNodeName } from "../heart-nodes";
import map from "./activation-map.json";

/** Los tejidos que se activan, en el orden del índice que lleva cada vértice
 * (`aTissue`). Lo fija `docs/fase-h/build-activation-map.py`. */
export const TISSUES = ["ventricular_myocardium", "right_atrium", "left_atrium"] as const;
export type Tissue = (typeof TISSUES)[number];

interface MeshMap {
  segment: Tissue;
  vertices: number;
  activation: string;
  tissue: string;
}

interface ActivationMapData {
  format_version: number;
  tissues: Tissue[];
  meshes: Record<string, MeshMap>;
}

export const ACTIVATION_MAP = map as unknown as ActivationMapData;

export const ACTIVATED_MESHES = Object.keys(ACTIVATION_MAP.meshes) as HeartNodeName[];

export const ACTIVATION_ATTRIBUTE = "aActivation";
export const TISSUE_ATTRIBUTE = "aTissue";

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** La activación normalizada de cada vértice de una malla, de 0 a 1. */
export function decodeActivation(name: string): { activation: Float32Array; tissue: Float32Array } | null {
  const entry = ACTIVATION_MAP.meshes[name];
  if (!entry) return null;
  const bytes = decode(entry.activation);
  const tissues = decode(entry.tissue);
  const activation = new Float32Array(bytes.length);
  const tissue = new Float32Array(tissues.length);
  for (let i = 0; i < bytes.length; i += 1) {
    activation[i] = bytes[i] / 255;
    tissue[i] = tissues[i];
  }
  return { activation, tissue };
}

/** Añade los dos atributos del mapa a la geometría de una malla. Una vez, al
 * cargar el modelo: nada de esto corre durante la reproducción.
 *
 * Devuelve `false` si la malla no tiene los vértices que el mapa espera —un
 * `.glb` reexportado sin regenerar el mapa—: el atributo se asigna por índice,
 * y con otra malla cada número caería en un vértice que no es el suyo. En ese
 * caso la malla se queda sin activación en vez de enseñar una falsa. */
export function attachActivation(name: string, geometry: BufferGeometry): boolean {
  if (geometry.getAttribute(ACTIVATION_ATTRIBUTE)) return true;
  const decoded = decodeActivation(name);
  if (!decoded) return false;
  if (geometry.getAttribute("position").count !== decoded.activation.length) {
    console.warn(
      `Mapa de activación de ${name}: ${decoded.activation.length} vértices frente a ` +
        `${geometry.getAttribute("position").count} en el modelo. Regenera el mapa.`
    );
    return false;
  }
  geometry.setAttribute(ACTIVATION_ATTRIBUTE, new BufferAttribute(decoded.activation, 1));
  geometry.setAttribute(TISSUE_ATTRIBUTE, new BufferAttribute(decoded.tissue, 1));
  return true;
}

/** Uniformes de la activación, compartidos por los materiales de las cinco
 * mallas. Uno por tejido:
 *
 *   x  segundos desde que empezó el tramo, o negativo si no hay ninguno
 *   y  duración del tramo
 *   z  cuánto del tejido sigue despolarizado (1 hasta que llega su
 *      recuperación, que lo devuelve a 0)
 *   w  intensidad de la recuperación, sin orden espacial
 *
 * El vértice compara `x` con su propia activación por `y` y no guarda nada:
 * el mismo instante da siempre la misma imagen. */
export interface TissueUniforms {
  uTissue: { value: Vector4[] };
  uActivationOn: { value: number };
}

export function createTissueUniforms(): TissueUniforms {
  return {
    uTissue: { value: TISSUES.map(() => new Vector4(-1, 0, 0, 0)) },
    uActivationOn: { value: 0 },
  };
}

/** Cuánto tarda una aurícula en apagarse después de su tramo. Es presentación:
 * la repolarización auricular queda oculta en el QRS y el fichero de tiempos no
 * le da ningún instante. */
const ATRIAL_HOLD_S = 0.1;
const ATRIAL_FADE_S = 0.08;

/** Sin recuperación conocida, un ventrículo se da por repolarizado pasado este
 * tiempo: un impulso sin T (una sesión cortada) no deja el tejido encendido. */
const MAX_DEPOLARIZED_S = 1;

const SEGMENT_OF: Record<Tissue, ElectricalStructureName> = {
  ventricular_myocardium: "ventricular_myocardium",
  right_atrium: "right_atrium",
  left_atrium: "left_atrium",
};

const activation = createSegmentWindow();
const recovery = createSegmentWindow();

/** Escribe en los uniformes el estado de los tres tejidos en `tS`. Función
 * pura del instante, como el pulso de la conducción. */
export function writeTissueUniforms(
  timeline: ElectricalTimeline,
  tS: number,
  uniforms: TissueUniforms
): void {
  TISSUES.forEach((tissue, index) => {
    const out = uniforms.uTissue.value[index];
    timeline.windowAt([SEGMENT_OF[tissue]], tS, activation);
    if (!activation.found) {
      out.set(-1, 0, 0, 0);
      return;
    }
    const elapsed = tS - activation.startS;
    const span = Math.max(0, activation.endS - activation.startS);
    let depolarized = 1;
    let recovering = 0;
    if (tissue === "ventricular_myocardium") {
      timeline.windowAt(["ventricular_recovery"], tS, recovery);
      if (recovery.found && recovery.startS >= activation.startS) {
        const length = Math.max(1e-3, recovery.endS - recovery.startS);
        const progress = Math.min(1, (tS - recovery.startS) / length);
        depolarized = 1 - progress;
        recovering = progress < 1 ? Math.sin(Math.PI * progress) : 0;
      } else if (tS - activation.endS > MAX_DEPOLARIZED_S) {
        depolarized = 0;
      }
    } else {
      const after = tS - activation.endS - ATRIAL_HOLD_S;
      depolarized = after <= 0 ? 1 : Math.exp(-after / ATRIAL_FADE_S);
    }
    out.set(elapsed, span, depolarized, recovering);
  });
}

/** El instante en que se activa un vértice con activación normalizada `f`
 * dentro de un tramo. Es la cuenta del sombreador escrita para poder probarla:
 * con `f` entre 0 y 1, cae siempre dentro del tramo. */
export function vertexActivationTime(f: number, startS: number, endS: number): number {
  return startS + f * (endS - startS);
}

/** Inyecta la activación en el material de una cámara.
 *
 * Se inyecta en el material que ya tiene —el de `heart-appearance.ts`, con su
 * color, sus cortes y su transparencia— en vez de sustituirlo: el aspecto del
 * corazón no cambia con la capa apagada, y con ella encendida el frente se
 * suma como emisión. */
export function injectActivation(material: MeshStandardMaterial, uniforms: TissueUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${ACTIVATION_ATTRIBUTE};
attribute float ${TISSUE_ATTRIBUTE};
varying float vActivation;
varying float vTissue;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vActivation = ${ACTIVATION_ATTRIBUTE};
vTissue = ${TISSUE_ATTRIBUTE};`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec4 uTissue[${TISSUES.length}];
uniform float uActivationOn;
varying float vActivation;
varying float vTissue;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
if (uActivationOn > 0.5) {
  vec4 w = uTissue[int(vTissue + 0.5)];
  float since = w.x - vActivation * w.y;
  if (w.x >= 0.0 && since >= 0.0) {
    // El frente brilla al pasar y deja el tejido despolarizado en un tono
    // tenue hasta que llega su recuperación.
    float front = exp(-since / 0.012);
    totalEmissiveRadiance += vec3(1.0, 0.78, 0.25) * front * 0.55;
    totalEmissiveRadiance += vec3(0.9, 0.42, 0.1) * 0.2 * w.z;
  }
  // La recuperación tiene color propio y no afirma ningún orden espacial.
  totalEmissiveRadiance += vec3(0.35, 0.6, 1.0) * 0.3 * w.w;
}`
      );
  };
  material.customProgramCacheKey = () => "tissue-activation-v1";
}
