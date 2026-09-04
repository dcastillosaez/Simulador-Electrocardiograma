import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { DoubleSide, Mesh, MeshStandardMaterial, Plane, Vector3 } from "three";
import { applyExcursion } from "./HeartAnimator";
import { HEART_NODE_NAMES, bindHeartNodes, type HeartNodeName, type Object3DLike } from "./heart-nodes";
import {
  APPEARANCE,
  GHOST_OPACITY,
  VALVE_APPEARANCE,
  groupIsVisible,
  opacityFor,
  visibleNodes,
  type HeartGroup,
} from "./heart-appearance";
import { VALVE_LEAFLET_NAMES, bindValveNodes } from "./heart-valves";
import { applyAperture } from "./ValveAnimator";
import {
  CUT_AXES,
  CUT_AXIS_ORDER,
  cutPlaneConstant,
  type ActiveCut,
  type CutAxis,
} from "./heart-cut";
import {
  CLIPPED_MESH_ORDER,
  HeartCutaway,
  createCapMaterial,
} from "./HeartCutaway";
import type { CardiacTimeline, ChamberName } from "../../cardiac/cardiac-timeline";
import type { ValveTimeline } from "../../cardiac/valve-timeline";
import { tremorExcursion } from "../../cardiac/tremor";
import type { HeartStateValues } from "./useCardiacTimeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

export const HEART_MODEL_URL = "/models/heart.glb";

export interface HeartModelProps {
  runtime: SessionRuntime;
  timeline: MutableRefObject<CardiacTimeline>;
  valves: MutableRefObject<ValveTimeline>;
  heartState: HeartStateValues | null;
  /** Grupos aislados. Vacío significa el corazón entero. */
  isolated: ReadonlySet<HeartGroup>;
  /** Opacidad de lo que está visible, de 0 a 1. */
  opacity: number;
  /** Enseña la capa de miocardio sintetizado. Apagada por defecto: es
   * geometría derivada, no anatomía de la fuente, y además tapa las cavidades
   * desde fuera. */
  showMyocardium: boolean;
  /** Cortes anatómicos activos. Vacío deja el corazón entero. No son
   * excluyentes: dos planos abren una esquina y tres un octante. */
  cuts: ActiveCut[];
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
  valves,
  heartState,
  isolated,
  opacity,
  showMyocardium,
  cuts,
}: HeartModelProps) {
  const { scene } = useGLTF(HEART_MODEL_URL);
  const nodes = useMemo(
    () => bindHeartNodes(scene as unknown as Object3DLike),
    [scene]
  );
  const valveNodes = useMemo(
    () => bindValveNodes(scene as unknown as Object3DLike),
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

  // Un solo material para las once valvas: las cuatro válvulas comparten
  // aspecto, y darle a cada valva el suyo serían once programas de sombreado
  // que recompilar cada vez que cambia el aislamiento para pintar exactamente
  // lo mismo.
  const valveMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: VALVE_APPEARANCE.color,
        roughness: VALVE_APPEARANCE.roughness,
        metalness: 0.04,
        // Una valva es una membrana abierta de medio milímetro: vista desde el
        // lado de la aurícula se le ve la cara interior. Sin `DoubleSide`
        // desaparecería justo desde la mitad de los ángulos de cámara.
        side: DoubleSide,
      }),
    []
  );

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

  // Un plano por eje, creados una vez. Three.js guarda la referencia dentro
  // de cada material, así que hay que mover *estos* objetos, no sustituirlos:
  // creando uno nuevo en cada cambio del mando, los materiales seguirían
  // apuntando al viejo y el corte no se movería.
  const planes = useMemo(() => {
    const table = {} as Record<CutAxis, Plane>;
    for (const axis of CUT_AXIS_ORDER) {
      const [x, y, z] = CUT_AXES[axis].normal;
      table[axis] = new Plane(new Vector3(x, y, z), 0);
    }
    return table;
  }, []);

  // La lista que reciben los materiales. Se reconstruye solo cuando cambia
  // qué ejes están activos, no cuando se mueve un mando: el número de planos
  // está cocido en el programa de sombreado y cambiarlo obliga a recompilar.
  const activePlanes = useMemo(
    () => cuts.map((cut) => planes[cut.axis]),
    [planes, cuts]
  );

  // La escena viene del caché de `useGLTF` y sobrevive a este componente, así
  // que los materiales hay que soltarlos a mano: cambiar de preset de cámara
  // remonta el `Canvas`, y sin esto se acumularía un juego por cada cambio de
  // vista.
  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
      for (const material of Object.values(capMaterials)) material.dispose();
      valveMaterial.dispose();
    };
  }, [materials, capMaterials, valveMaterial]);

  useEffect(() => {
    for (const cut of cuts) {
      planes[cut.axis].constant = cutPlaneConstant(cut.axis, cut.position);
    }
  }, [planes, cuts]);

  useEffect(() => {
    const list = activePlanes.length === 0 ? null : activePlanes;
    for (const name of HEART_NODE_NAMES) {
      const mesh = nodes[name] as unknown as Mesh;
      const material = materials[name];
      // El número de planos de recorte se compila dentro del sombreador, así
      // que pasar de uno a dos exige recompilar. Cambiar la constante de un
      // plano ya existente no: eso es un uniforme y se recoge solo.
      const antes = material.clippingPlanes?.length ?? 0;
      material.clippingPlanes = list;
      if (antes !== activePlanes.length) material.needsUpdate = true;
      // Las mallas de color van detrás de todas las pasadas de stencil y de
      // todas las tapas. Con el orden por defecto —cero para todo— la tapa se
      // dibujaría antes de que el stencil dijera dónde va.
      mesh.renderOrder = list === null ? 0 : CLIPPED_MESH_ORDER;
    }

    // Las valvas se recortan con los mismos planos. Sin esto se quedarían
    // flotando delante de la sección, que es la forma más rápida de que un
    // corte anatómico deje de leerse como un corte.
    const before = valveMaterial.clippingPlanes?.length ?? 0;
    valveMaterial.clippingPlanes = list;
    if (before !== activePlanes.length) valveMaterial.needsUpdate = true;
    for (const name of VALVE_LEAFLET_NAMES) {
      const mesh = valveNodes[name] as unknown as Mesh;
      // Detrás de las mallas de color: una valva vive dentro de la cavidad, y
      // con un corte abierto tiene que dibujarse después de la tapa que la
      // destapa.
      mesh.renderOrder = list === null ? 0 : CLIPPED_MESH_ORDER + 1;
    }
  }, [nodes, materials, activePlanes, valveNodes, valveMaterial]);

  const hidden = useMemo(
    () => new Set<HeartNodeName>(showMyocardium ? [] : ["Myocardium"]),
    [showMyocardium]
  );

  useEffect(() => {
    const visible = visibleNodes(isolated);
    for (const name of HEART_NODE_NAMES) {
      const mesh = nodes[name] as unknown as Mesh;
      const material = materials[name];
      const alpha = opacityFor(name, visible, opacity);
      // Apagar el nodo entero, no bajarle la opacidad: un miocardio fantasma
      // seguiría velando lo que hay debajo.
      mesh.visible = !hidden.has(name);

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

    // Las válvulas son un grupo más, con el mismo trato: en el corazón entero
    // se ven con la opacidad del mando, y aisladas dejan el resto en
    // fantasma. Es el modo en que este grupo se usa de verdad — enterradas
    // dentro de las cavidades no se ven, y con las cámaras insinuadas se ve
    // exactamente lo que hacen.
    const valveAlpha = groupIsVisible("valves", isolated) ? opacity : GHOST_OPACITY;
    const valveTranslucent = valveAlpha < 1;
    if (valveMaterial.transparent !== valveTranslucent) {
      valveMaterial.transparent = valveTranslucent;
      valveMaterial.needsUpdate = true;
    }
    valveMaterial.opacity = valveAlpha;
    valveMaterial.depthWrite = !valveTranslucent;
    for (const name of VALVE_LEAFLET_NAMES) {
      (valveNodes[name] as unknown as Mesh).material = valveMaterial;
    }
  }, [
    nodes,
    materials,
    capMaterials,
    isolated,
    opacity,
    hidden,
    valveNodes,
    valveMaterial,
  ]);

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
      valves.current.prune(tS - PRUNE_MARGIN_S);
    }

    applyExcursion(nodes, {
      atria: excursionFor("atria", tS, timeline.current, heartState),
      ventricles: excursionFor("ventricles", tS, timeline.current, heartState),
    });

    // El mismo `tS` que acaba de mover las cámaras. Que sea el mismo no es un
    // detalle de implementación: es lo único que garantiza que la mitral se
    // cierre en el fotograma en que el ventrículo empieza a contraerse, y que
    // las dos cosas coincidan con el QRS que el trazado está pintando.
    applyAperture(valveNodes, {
      atrioventricular: valves.current.apertureAt("atrioventricular", tS),
      semilunar: valves.current.apertureAt("semilunar", tS),
    });
  });

  return (
    <>
      <primitive object={scene} />
      {activePlanes.length > 0 && (
        <HeartCutaway
          nodes={nodes}
          planes={activePlanes}
          capMaterials={capMaterials}
          hidden={hidden}
        />
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
