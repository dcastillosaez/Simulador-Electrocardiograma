import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Mesh, MeshStandardMaterial, Plane, Vector3 } from "three";
import { applyExcursion } from "./HeartAnimator";
import { HEART_NODE_NAMES, bindHeartNodes, type HeartNodeName, type Object3DLike } from "./heart-nodes";
import {
  APPEARANCE,
  opacityFor,
  visibleNodes,
  type HeartGroup,
} from "./heart-appearance";
import { CUT_AXES, cutPlaneConstant, type CutAxis } from "./heart-cut";
import {
  CLIPPED_MESH_ORDER,
  HeartCutaway,
  createCapMaterial,
} from "./HeartCutaway";
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
  /** Corte anatómico activo, o `null` si el corazón se ve entero. */
  cut: { axis: CutAxis; position: number } | null;
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
  cut,
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
  // Un material de tapa por estructura, con su mismo color. Se crean siempre,
  // aunque no haya corte: son nueve materiales que no se dibujan si el grupo
  // de tapas no está montado, y crearlos y destruirlos al vuelo cada vez que
  // se activa el corte daría un tirón en el primer fotograma.
  const capMaterials = useMemo(() => {
    const table = {} as Record<HeartNodeName, MeshStandardMaterial>;
    for (const name of HEART_NODE_NAMES) {
      table[name] = createCapMaterial(APPEARANCE[name].color);
    }
    return table;
  }, []);

  // El plano vive fuera del render: Three.js guarda la referencia dentro de
  // cada material, así que hay que mover *este* objeto, no sustituirlo. Si se
  // creara uno nuevo en cada cambio del mando, los materiales seguirían
  // apuntando al viejo y el corte no se movería.
  const plane = useMemo(() => new Plane(new Vector3(0, 0, -1), 0), []);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
      for (const material of Object.values(capMaterials)) material.dispose();
    };
  }, [materials, capMaterials]);

  useEffect(() => {
    if (cut === null) return;
    const [x, y, z] = CUT_AXES[cut.axis].normal;
    plane.normal.set(x, y, z);
    plane.constant = cutPlaneConstant(cut.axis, cut.position);
  }, [plane, cut]);

  useEffect(() => {
    const planes = cut === null ? null : [plane];
    for (const name of HEART_NODE_NAMES) {
      const mesh = nodes[name] as unknown as Mesh;
      materials[name].clippingPlanes = planes;
      // Las mallas de color van detrás de todas las pasadas de stencil y de
      // todas las tapas. Con el orden por defecto —cero para todo— la tapa se
      // dibujaría antes de que el stencil dijera dónde va.
      mesh.renderOrder = cut === null ? 0 : CLIPPED_MESH_ORDER;
    }
  }, [nodes, materials, plane, cut]);

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

      // La tapa hereda la misma opacidad: una estructura apartada tiene que
      // ser fantasma también por dentro del corte, o el aislamiento se rompe
      // justo en la superficie que más se mira.
      const cap = capMaterials[name];
      if (cap.transparent !== translucent) {
        cap.transparent = translucent;
        cap.needsUpdate = true;
      }
      cap.opacity = alpha;
      cap.depthWrite = !translucent;
    }
  }, [nodes, materials, capMaterials, isolated, opacity]);

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

  return (
    <>
      <primitive object={scene} />
      {cut !== null && (
        <HeartCutaway nodes={nodes} plane={plane} capMaterials={capMaterials} />
      )}
    </>
  );
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
