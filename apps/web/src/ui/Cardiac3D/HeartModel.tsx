import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Mesh, MeshStandardMaterial } from "three";
import { applyExcursion, driverFor } from "./HeartAnimator";
import { HEART_NODE_NAMES, bindHeartNodes, type HeartNodeName, type Object3DLike } from "./heart-nodes";
import {
  APPEARANCE,
  VESSEL_GLOW_COLOR,
  opacityFor,
  vesselGlow,
  visibleNodes,
  type HeartGroup,
} from "./heart-appearance";
import type { CardiacTimeline, ChamberName } from "../../cardiac/cardiac-timeline";
import { tremorExcursion } from "../../cardiac/tremor";
import type { HeartStateValues } from "./useCardiacTimeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

export const HEART_MODEL_URL = "/models/heart.glb";

export interface HeartModelProps {
  runtime: SessionRuntime;
  timeline: MutableRefObject<CardiacTimeline>;
  heartState: HeartStateValues | null;
  /** Grupos aislados. Vacío significa el corazón entero. */
  isolated: ReadonlySet<HeartGroup>;
  /** Opacidad de lo que está visible, de 0 a 1. */
  opacity: number;
}

/** Cuánto se descarta de la cola por detrás de la cabeza de reproducción. Un
 * segundo cubre de sobra la contracción más larga en curso. */
const PRUNE_MARGIN_S = 1;

/** Cada cuántos fotogramas se poda. Filtrar un array en cada uno de los 60
 * ticks por segundo es trabajo tirado: la cola crece a unos dos eventos por
 * segundo. */
const PRUNE_EVERY_FRAMES = 120;

export function HeartModel({
  runtime,
  timeline,
  heartState,
  isolated,
  opacity,
}: HeartModelProps) {
  const { scene } = useGLTF(HEART_MODEL_URL);
  const nodes = useMemo(
    () => bindHeartNodes(scene as unknown as Object3DLike),
    [scene]
  );
  const frameCount = useRef(0);

  // Un material por estructura, creado una vez. El `.glb` no trae ninguno
  // —solo posiciones y normales—, así que sin esto Three.js aplica su blanco
  // por defecto a las nueve y el corazón se ve como un bloque gris de una
  // pieza. No es que al modelo le falten cavidades: es que estaban todas del
  // mismo color.
  const materials = useMemo(() => {
    const table = {} as Record<HeartNodeName, MeshStandardMaterial>;
    for (const name of HEART_NODE_NAMES) {
      const look = APPEARANCE[name];
      table[name] = new MeshStandardMaterial({
        color: look.color,
        roughness: look.roughness,
        // El destello de flujo de los grandes vasos se enciende variando
        // `emissiveIntensity` en cada fotograma; el color se fija una vez.
        emissive: VESSEL_GLOW_COLOR,
        emissiveIntensity: 0,
        // Un tejido no es metal. Un pelín por encima de cero para que los
        // grandes vasos cojan algo del reflejo especular y no queden planos.
        metalness: 0.04,
      });
    }
    return table;
  }, []);

  // La escena viene del caché de `useGLTF` y sobrevive a este componente, así
  // que los materiales hay que soltarlos a mano: cambiar de preset de cámara
  // remonta el `Canvas`, y sin esto se acumularía un juego de nueve por cada
  // cambio de vista.
  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
    };
  }, [materials]);

  useEffect(() => {
    const visible = visibleNodes(isolated);
    for (const name of HEART_NODE_NAMES) {
      const mesh = nodes[name] as unknown as Mesh;
      const material = materials[name];
      const alpha = opacityFor(name, visible, opacity);

      const translucent = alpha < 1;

      // `opacity` es un uniforme y se recoge sola. `transparent` no: cambia el
      // programa de sombreado y el renderizador no se entera hasta que se le
      // marca `needsUpdate`. Sin esta línea los mandos de aislamiento y
      // opacidad no hacen nada visible —el estado de React cambia, el material
      // también, y la escena sigue igual—, que es exactamente el fallo que
      // tuvo esta escena hasta que se probó en la aplicación.
      //
      // Se marca solo cuando el flag cambia de verdad: recompilar en cada
      // movimiento del slider costaría un tirón por cada píxel arrastrado.
      if (material.transparent !== translucent) {
        material.transparent = translucent;
        material.needsUpdate = true;
      }
      material.opacity = alpha;
      // Lo translúcido no escribe profundidad: si lo hiciera, una estructura
      // fantasma delante taparía a la que se está aislando, que es justo lo
      // contrario de lo que pide quien la aisló.
      material.depthWrite = !translucent;
      mesh.material = material;
    }
  }, [nodes, materials, isolated, opacity]);

  useFrame(() => {
    // El reloj es la cabeza de reproducción del buffer, NUNCA el reloj de
    // rAF ni `Date.now()`. Es lo que hace que el corazón y el trazado vayan
    // sincronizados por construcción: en pausa, en pre-roll y en underrun
    // este valor se queda quieto, y el corazón se congela con el trazo.
    //
    // `advance()` no se llama aquí: la llama `useSweepRenderer`, una sola vez
    // por tick. Llamarla también aquí consumiría trozos que el ECG nunca
    // llegaría a dibujar.
    const tS = runtime.buffer.playbackTimeS;
    if (tS === null) return;

    frameCount.current += 1;
    if (frameCount.current % PRUNE_EVERY_FRAMES === 0) {
      timeline.current.prune(tS - PRUNE_MARGIN_S);
    }

    const excursions = {
      atria: excursionFor("atria", tS, timeline.current, heartState),
      ventricles: excursionFor("ventricles", tS, timeline.current, heartState),
    };
    applyExcursion(nodes, excursions);

    // Destello de flujo en los grandes vasos. `emissiveIntensity` es un
    // uniforme: se puede escribir en cada fotograma sin recompilar nada, al
    // revés que `transparent`.
    //
    // Se multiplica por la opacidad para que un vaso apartado siga siendo un
    // fantasma. Sin eso, aislar los ventrículos dejaría la aorta invisible
    // pero encendida, brillando en el vacío.
    for (const name of HEART_NODE_NAMES) {
      if (APPEARANCE[name].kind !== "vessel") continue;
      const driver = driverFor(name);
      const material = materials[name];
      material.emissiveIntensity =
        vesselGlow(excursions[driver], isFlowing(driver, heartState)) *
        material.opacity;
    }
  });

  return <primitive object={scene} />;
}

/** Si esa cámara está moviendo sangre de verdad.
 *
 * Solo la contracción organizada expulsa. Un ventrículo que fibrila se mueve
 * mucho y no bombea nada, así que los vasos que dependen de él se quedan
 * apagados — que es exactamente lo que hay que ver en una FV. Sin estado
 * todavía se asume que sí: lo contrario dejaría el corazón apagado durante el
 * cuarto de segundo que tarda en llegar el primero. */
function isFlowing(
  chamber: ChamberName,
  heartState: HeartStateValues | null
): boolean {
  if (heartState === null) return true;
  const mode =
    chamber === "atria" ? heartState.atrial_mode : heartState.ventricular_mode;
  return mode === "synchronous";
}

/** Contracción organizada y temblor son excluyentes por cámara, y quien
 * decide cuál toca es el servidor: una cámara que fibrila no manda eventos,
 * así que consultar la timeline devolvería cero y el corazón se quedaría
 * quieto en una FV. Nótese que aquí no se pregunta por el ritmo, solo por el
 * modo — es lo que mantiene el cliente libre de casos especiales. */
function excursionFor(
  chamber: ChamberName,
  tS: number,
  timeline: CardiacTimeline,
  heartState: HeartStateValues | null
): number {
  // Sin estado todavía: lo único razonable es reproducir los eventos que
  // hayan llegado. El estado llega como muy tarde 250 ms después del primero.
  if (heartState === null) return timeline.excursionAt(chamber, tS);

  const mode =
    chamber === "atria" ? heartState.atrial_mode : heartState.ventricular_mode;
  const amplitude =
    chamber === "atria"
      ? heartState.atrial_amplitude
      : heartState.ventricular_amplitude;

  switch (mode) {
    case "synchronous":
      return timeline.excursionAt(chamber, tS);
    case "fluttering":
    case "fibrillating":
      return tremorExcursion(tS, heartState.flutter_hz, amplitude);
    case "absent":
      return 0;
  }
}

useGLTF.preload(HEART_MODEL_URL);
