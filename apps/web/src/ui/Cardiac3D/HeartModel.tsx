import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Mesh, MeshStandardMaterial } from "three";
import { applyExcursion } from "./HeartAnimator";
import { HEART_NODE_NAMES, bindHeartNodes, type HeartNodeName, type Object3DLike } from "./heart-nodes";
import {
  APPEARANCE,
  opacityFor,
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

      material.opacity = alpha;
      material.transparent = alpha < 1;
      // Lo translúcido no escribe profundidad: si lo hiciera, una estructura
      // fantasma delante taparía a la que se está aislando, que es justo lo
      // contrario de lo que pide quien la aisló.
      material.depthWrite = alpha >= 1;
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

    applyExcursion(nodes, {
      atria: excursionFor("atria", tS, timeline.current, heartState),
      ventricles: excursionFor("ventricles", tS, timeline.current, heartState),
    });
  });

  return <primitive object={scene} />;
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
