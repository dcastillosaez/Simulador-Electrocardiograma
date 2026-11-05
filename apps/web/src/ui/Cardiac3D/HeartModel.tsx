import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { DoubleSide, Group, Mesh, MeshStandardMaterial, Plane, Vector3 } from "three";
import { applyExcursion, type ConductionGroupName } from "./HeartAnimator";
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
import { excursionFor, ventricularFlow } from "./chamber-excursion";
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
import type { CardiacTimeline } from "../../cardiac/cardiac-timeline";
import type { ValveTimeline } from "../../cardiac/valve-timeline";
import type { ElectricalTimeline } from "../../cardiac/electrical-timeline";
import type { HeartStateTimeline } from "../../cardiac/heart-state-timeline";
import type { PlaybackClock } from "../../cardiac/playback-clock";
import { writePulseUniforms } from "./ConductionSystem/conduction-pulse";
import {
  ACTIVATED_MESHES,
  attachActivation,
  createTissueUniforms,
  injectActivation,
  writeTissueUniforms,
} from "./activation/tissue-activation";
import type { HeartStateValues } from "./useCardiacTimeline";
import { ConductionSystem } from "./ConductionSystem/ConductionSystem";
import type { ConductionUniforms } from "./ConductionSystem/conduction-material";
import type { ConductionStructure } from "./ConductionSystem/conduction-structures";

export const HEART_MODEL_URL = "/models/heart.glb";

export interface HeartModelProps {
  /** La cabeza de reproducción: la del directo, o el cursor del repaso. */
  clock: PlaybackClock;
  heartStates: MutableRefObject<HeartStateTimeline>;
  timeline: MutableRefObject<CardiacTimeline>;
  valves: MutableRefObject<ValveTimeline>;
  electrical: MutableRefObject<ElectricalTimeline>;
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
  /** Enseña el sistema de conducción. */
  showConduction: boolean;
  conductionUniforms: ConductionUniforms;
  selectedStructure: ConductionStructure | null;
  onSelectStructure?: (structure: ConductionStructure | null) => void;
}

/** Cuánto se descarta de la cola por detrás de la cabeza de reproducción. Un
 * segundo cubre de sobra la contracción más larga en curso. */
const PRUNE_MARGIN_S = 1;

/** Cada cuántos fotogramas se poda. Filtrar un array en cada uno de los 60
 * ticks por segundo es trabajo tirado: la cola crece a unos dos eventos por
 * segundo. */
const PRUNE_EVERY_FRAMES = 120;

export function HeartModel({
  clock,
  heartStates,
  timeline,
  valves,
  electrical,
  heartState: latestHeartState,
  isolated,
  opacity,
  showMyocardium,
  cuts,
  showConduction,
  conductionUniforms,
  selectedStructure,
  onSelectStructure,
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
  const conductionGroups = useRef<Partial<Record<ConductionGroupName, Group>>>({});

  // Un material por estructura, creado una vez. El `.glb` no trae ninguno
  // —solo posiciones y normales—, así que sin esto Three.js aplica su blanco
  // por defecto a las nueve y el corazón se ve como un bloque gris de una
  // pieza. No es que al modelo le falten cavidades: es que estaban todas del
  // mismo color.
  // La activación del tejido (fase H4): un uniforme por tejido, compartido por
  // las cinco mallas que se activan, y dos atributos por vértice que se añaden
  // una vez al cargar. Las mallas cuyo número de vértices no cuadra con el
  // mapa se quedan sin activación (ver `attachActivation`).
  const tissueUniforms = useMemo(() => createTissueUniforms(), []);
  const activated = useMemo(() => {
    const ok = new Set<HeartNodeName>();
    for (const name of ACTIVATED_MESHES) {
      const mesh = nodes[name] as unknown as Mesh;
      if (mesh.geometry && attachActivation(name, mesh.geometry)) ok.add(name);
    }
    return ok;
  }, [nodes]);

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
      if (activated.has(name)) injectActivation(table[name], tissueUniforms);
    }
    return table;
  }, [activated, tissueUniforms]);

  useEffect(() => {
    tissueUniforms.uActivationOn.value = showConduction ? 1 : 0;
  }, [tissueUniforms, showConduction]);

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
    //
    // En el repaso, el cursor manda en vez de la cabeza: `clock` devuelve uno u
    // otro y aquí no se distingue. Todo lo que sigue es función pura de `tS`,
    // así que el mismo instante da la misma pose llegando desde delante,
    // desde detrás o a cualquier velocidad.
    const tS = clock.timeS;
    if (tS === null) return;

    frameCount.current += 1;
    const liveS = clock.liveTimeS;
    if (liveS !== null && frameCount.current % PRUNE_EVERY_FRAMES === 0) {
      // La poda va contra la cabeza del directo y no contra `tS`, que en el
      // repaso va hacia atrás: podar contra el cursor tiraría justo el pasado
      // que se quiere mirar. El margen es lo que abarca el papel.
      const horizon = liveS - clock.retentionS - PRUNE_MARGIN_S;
      timeline.current.prune(horizon);
      valves.current.prune(horizon);
      electrical.current.prune(horizon);
      heartStates.current.prune(horizon);
    }
    const heartState = heartStates.current.valuesAt(tS) ?? latestHeartState;

    const atria = excursionFor("atria", tS, timeline.current, heartState);
    // La conducción recibe la escala en la misma llamada que las cámaras: si
    // fuera en otra, un fotograma podría dibujar el His con la excursión del
    // anterior y el corazón con la de este.
    applyExcursion(
      nodes,
      {
        atria,
        ventricles: excursionFor("ventricles", tS, timeline.current, heartState),
      },
      conductionGroups.current
    );

    // El mismo `tS` que acaba de mover las cámaras. Que sea el mismo no es un
    // detalle de implementación: es lo único que garantiza que la mitral se
    // cierre en el fotograma en que el ventrículo empieza a contraerse, y que
    // las dos cosas coincidan con el QRS que el trazado está pintando.
    // La misma excursión auricular que acaba de encoger las aurículas levanta
    // la onda A de la mitral y la tricúspide. No se recalcula ni se aproxima:
    // la patada auricular *es* la sístole auricular, y quién decide cuándo
    // ocurre es el servidor.
    // El pulso, del mismo `tS`. Se escribe aunque la capa esté apagada: son
    // siete pares de números, y así encenderla no enseña un fotograma viejo.
    writePulseUniforms(electrical.current, tS, conductionUniforms);
    writeTissueUniforms(electrical.current, tS, tissueUniforms);

    applyAperture(valveNodes, {
      atrioventricular: valves.current.apertureAt("atrioventricular", tS, atria),
      semilunar: valves.current.apertureAt(
        "semilunar",
        tS,
        ventricularFlow(tS, timeline.current, heartState)
      ),
    });
  });

  return (
    <>
      <primitive object={scene} />
      <ConductionSystem
        nodes={nodes}
        uniforms={conductionUniforms}
        groups={conductionGroups}
        visible={showConduction}
        // Mismo trato que las válvulas: con su grupo aislado o sin aislar
        // nada se ve con la opacidad del mando; si se aísla otra cosa, queda
        // en fantasma.
        opacity={groupIsVisible("conduction", isolated) ? opacity : GHOST_OPACITY}
        planes={activePlanes.length === 0 ? null : activePlanes}
        renderOrder={activePlanes.length === 0 ? 0 : CLIPPED_MESH_ORDER + 1}
        selected={selectedStructure}
        onSelect={onSelectStructure}
      />
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

useGLTF.preload(HEART_MODEL_URL);
