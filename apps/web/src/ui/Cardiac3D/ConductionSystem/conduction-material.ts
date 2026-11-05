import { Color, DoubleSide, MeshStandardMaterial } from "three";
import {
  CONDUCTION_STRUCTURES,
  STRUCTURE_INFO,
} from "./conduction-structures";
import { PROGRESS_ATTRIBUTE, STRUCTURE_ATTRIBUTE } from "./conduction-geometry";

const COUNT = CONDUCTION_STRUCTURES.length;

/** Uniformes del pulso, uno por estructura. Los escribe el bucle de dibujo
 * sin pasar por React: son números en arrays que el sombreador lee, igual que
 * las excursiones mueven las escalas.
 *
 * `front` es dónde va el frente del impulso en esa estructura, de 0 a 1 en la
 * escala de `aProgress`, o negativo si no hay impulso. `glow` es cuánto brilla
 * el tramo recorrido: 1 mientras el impulso avanza y cayendo después. Los dos
 * salen de la línea temporal eléctrica que manda el servidor; aquí no se
 * decide cuándo empieza un tramo ni si llega. */
export interface ConductionUniforms {
  uColors: { value: Color[] };
  uFront: { value: number[] };
  uGlow: { value: number[] };
  uSelected: { value: number };
}

export function createConductionUniforms(): ConductionUniforms {
  return {
    uColors: {
      value: CONDUCTION_STRUCTURES.map((s) => new Color(STRUCTURE_INFO[s].color)),
    },
    uFront: { value: new Array<number>(COUNT).fill(-1) },
    uGlow: { value: new Array<number>(COUNT).fill(0) },
    uSelected: { value: -1 },
  };
}

/** Color del impulso. Blanco cálido: tiene que destacar contra los siete
 * colores de las estructuras y contra el rojo y el azul de las cámaras. */
const PULSE_COLOR = "vec3(1.0, 0.97, 0.85)";

/** El material de la conducción: el estándar de la escena con el pulso
 * inyectado.
 *
 * Se inyecta en un `MeshStandardMaterial` en vez de escribir uno propio para
 * conservar lo que la escena ya hace con todos los materiales —iluminación,
 * planos de corte, transparencia del aislamiento—. El sombreador no guarda
 * estado: compara el progreso de cada vértice con el frente que le llega en
 * los uniformes, así que el mismo instante da siempre la misma imagen, se
 * llegue a él desde delante o desde detrás. */
export function createConductionMaterial(uniforms: ConductionUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.02,
    // Tubos abiertos por los extremos: sin las dos caras se vería el hueco.
    side: DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float ${PROGRESS_ATTRIBUTE};
attribute float ${STRUCTURE_ATTRIBUTE};
varying float vProgress;
varying float vStructure;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vProgress = ${PROGRESS_ATTRIBUTE};
vStructure = ${STRUCTURE_ATTRIBUTE};`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uColors[${COUNT}];
uniform float uFront[${COUNT}];
uniform float uGlow[${COUNT}];
uniform float uSelected;
varying float vProgress;
varying float vStructure;`
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `int structureIndex = int(vStructure + 0.5);
vec4 diffuseColor = vec4( diffuse * uColors[structureIndex], opacity );`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  float front = uFront[structureIndex];
  float pulse = 0.0;
  if (front >= 0.0) {
    // Por detrás del frente, una estela que se apaga; por delante, un borde
    // corto. El tejido que el impulso aún no ha alcanzado no brilla.
    float behind = front - vProgress;
    pulse = behind >= 0.0
      ? exp(-behind * 6.0)
      : max(0.0, 1.0 - (-behind) * 60.0);
    pulse *= uGlow[structureIndex];
  }
  totalEmissiveRadiance += ${PULSE_COLOR} * pulse * 1.4;
  if (abs(vStructure - uSelected) < 0.5) {
    totalEmissiveRadiance += uColors[structureIndex] * 0.45;
  }
}`
      );
  };
  // Una clave propia para que Three.js no reutilice el programa de otro
  // `MeshStandardMaterial` sin inyección.
  material.customProgramCacheKey = () => "conduction-pulse-v1";
  return material;
}
