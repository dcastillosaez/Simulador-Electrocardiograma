import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AlwaysStencilFunc,
  BackSide,
  DecrementWrapStencilOp,
  DoubleSide,
  FrontSide,
  IncrementWrapStencilOp,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  Group,
  Plane,
  PlaneGeometry,
  ReplaceStencilOp,
  type BufferGeometry,
} from "three";
import { HEART_NODE_NAMES, type HeartNodeName, type HeartNodes } from "./heart-nodes";
import { CAP_SIZE } from "./heart-cut";

/** Tapas de la sección.
 *
 * Cortar una malla cerrada con un plano no deja una superficie: deja un
 * agujero por el que se ve el interior de la cáscara, y una cavidad hueca se
 * lee como un error de modelado, no como un corte. Estas tapas son lo que
 * convierte el agujero en una sección maciza del color de la estructura.
 *
 * La técnica es la del ejemplo `webgl_clipping_stencil` de Three.js, y no hay
 * otra más simple que funcione: por cada estructura se cuentan en el buffer de
 * stencil las caras traseras menos las delanteras que hay delante del plano
 * —donde el resultado no es cero, el rayo entró en el sólido y no salió, así
 * que ahí hay material cortado— y después se pinta un cuadrado enorme dejando
 * pasar solo esos píxeles.
 *
 * Tres detalles que no son opcionales:
 *
 * Las mallas de stencil **copian la matriz del nodo** en cada fotograma en vez
 * de colgar de él. Tienen que seguir la escala que el animador escribe con
 * cada latido —si no, el borde del corte bailaría contra la cavidad que late—
 * y colgarlas del nodo con `createPortal` lo conseguía, pero al desmontar el
 * portal React Three Fiber se lleva por delante los nodos del GLTF. Como la
 * escena viene del caché de `useGLTF` y sobrevive al componente, el siguiente
 * montaje ya no encontraba las estructuras y `bindHeartNodes` reventaba.
 * Comprobado: encender y apagar el corte tres veces y cambiar de vista bastaba.
 *
 * El orden de dibujado importa y por eso va explícito: stencil, tapa, y las
 * mallas de color al final. Con el orden por defecto la tapa se dibujaría
 * antes de que el stencil estuviera escrito.
 *
 * El stencil se limpia después de cada tapa. Sin eso, la cuenta de una
 * estructura contaminaría la siguiente y las cámaras se taparían unas con el
 * color de otras. */

export interface HeartCutawayProps {
  nodes: HeartNodes;
  plane: Plane;
  /** Material de tapa por estructura. Los crea y actualiza `HeartModel`, que
   * es quien sabe de opacidad y aislamiento. */
  capMaterials: Record<HeartNodeName, MeshStandardMaterial>;
}

/** Dónde entra cada cosa en el orden de dibujado. Separados de diez en diez
 * para que quepan las tres pasadas de cada estructura sin solaparse. */
const STENCIL_ORDER = (index: number) => index * 10 + 1;
const CAP_ORDER = (index: number) => index * 10 + 2;

/** Las nueve mallas de color, después de todas las tapas. */
export const CLIPPED_MESH_ORDER = HEART_NODE_NAMES.length * 10 + 10;

export function HeartCutaway({ nodes, plane, capMaterials }: HeartCutawayProps) {
  const capGroup = useRef<Group>(null);
  const stencilMeshes = useRef<Mesh[]>([]);

  const capGeometry = useMemo(() => new PlaneGeometry(CAP_SIZE, CAP_SIZE), []);

  const stencilMaterials = useMemo(() => {
    const table = {} as Record<
      HeartNodeName,
      { back: MeshBasicMaterial; front: MeshBasicMaterial }
    >;
    for (const name of HEART_NODE_NAMES) {
      // `colorWrite: false` y `depthTest: false`: estas dos pasadas no pintan
      // nada ni miran la profundidad, solo llevan la cuenta en el stencil.
      const base = {
        depthWrite: false,
        depthTest: false,
        colorWrite: false,
        stencilWrite: true,
        stencilFunc: AlwaysStencilFunc,
        clippingPlanes: [plane],
      };
      const back = new MeshBasicMaterial({ ...base, side: BackSide });
      back.stencilFail = IncrementWrapStencilOp;
      back.stencilZFail = IncrementWrapStencilOp;
      back.stencilZPass = IncrementWrapStencilOp;

      const front = new MeshBasicMaterial({ ...base, side: FrontSide });
      front.stencilFail = DecrementWrapStencilOp;
      front.stencilZFail = DecrementWrapStencilOp;
      front.stencilZPass = DecrementWrapStencilOp;

      table[name] = { back, front };
    }
    return table;
  }, [plane]);

  useEffect(() => {
    const tracked = stencilMeshes;
    return () => {
      tracked.current = [];
      capGeometry.dispose();
      for (const pair of Object.values(stencilMaterials)) {
        pair.back.dispose();
        pair.front.dispose();
      }
    };
  }, [capGeometry, stencilMaterials]);

  useFrame(() => {
    // Las mallas de stencil siguen a su nodo copiándole la matriz de mundo.
    // Con `matrixAutoUpdate` apagado, Three la usa tal cual en vez de
    // recomponerla desde posición, rotación y escala.
    for (const mesh of stencilMeshes.current) {
      const source = mesh.userData.source as Mesh | undefined;
      if (!source) continue;
      source.updateWorldMatrix(true, false);
      mesh.matrix.copy(source.matrixWorld);
      mesh.matrixWorldNeedsUpdate = true;
    }

    // El plano se mueve con el mando, así que la tapa se recoloca en cada
    // fotograma. Son nueve objetos que comparten transformación: se mueve el
    // grupo una vez y no cada malla.
    const group = capGroup.current;
    if (!group) return;
    plane.coplanarPoint(group.position);
    // `lookAt` orienta el +Z del objeto hacia el punto. El cuadrado tiene su
    // normal en +Z y la normal del plano apunta hacia la mitad que se quita,
    // así que se mira al lado contrario para que la tapa dé la cara a quien
    // observa.
    group.lookAt(
      group.position.x - plane.normal.x,
      group.position.y - plane.normal.y,
      group.position.z - plane.normal.z
    );
  });

  return (
    <>
      {HEART_NODE_NAMES.map((name, index) => {
        const node = nodes[name] as unknown as Mesh;
        const geometry = node.geometry as BufferGeometry;
        const { back, front } = stencilMaterials[name];
        const track = (mesh: Mesh | null) => {
          if (mesh === null) return;
          mesh.matrixAutoUpdate = false;
          mesh.userData.source = node;
          if (!stencilMeshes.current.includes(mesh)) stencilMeshes.current.push(mesh);
        };
        return (
          <group key={`stencil-${name}`}>
            <mesh
              ref={track}
              geometry={geometry}
              material={back}
              renderOrder={STENCIL_ORDER(index)}
            />
            <mesh
              ref={track}
              geometry={geometry}
              material={front}
              renderOrder={STENCIL_ORDER(index)}
            />
          </group>
        );
      })}

      <group ref={capGroup}>
        {HEART_NODE_NAMES.map((name, index) => (
          <CapMesh
            key={`cap-${name}`}
            geometry={capGeometry}
            material={capMaterials[name]}
            renderOrder={CAP_ORDER(index)}
          />
        ))}
      </group>
    </>
  );
}

/** Una tapa. Vive aparte porque necesita una referencia para colgarle el
 * `onAfterRender` que limpia el stencil, y eso no se puede pasar como
 * propiedad: React Three Fiber trata los `on*` como manejadores de puntero. */
function CapMesh({
  geometry,
  material,
  renderOrder,
}: {
  geometry: PlaneGeometry;
  material: MeshStandardMaterial;
  renderOrder: number;
}) {
  const ref = useRef<Mesh>(null);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.onAfterRender = (renderer) => renderer.clearStencil();
    return () => {
      mesh.onAfterRender = () => {};
    };
  }, []);

  return (
    <mesh ref={ref} geometry={geometry} material={material} renderOrder={renderOrder} />
  );
}

/** Material de tapa para una estructura. La cara se ve por los dos lados
 * porque el plano puede acabar mirando hacia cualquier parte al orbitar. */
export function createCapMaterial(color: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color,
    side: DoubleSide,
    // Una sección de tejido no brilla. Más mate que la superficie exterior,
    // que es lo que la hace leerse como corte y no como otra cara del modelo.
    roughness: 0.95,
    metalness: 0,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: NotEqualStencilFunc,
  });
  material.stencilFail = ReplaceStencilOp;
  material.stencilZFail = ReplaceStencilOp;
  material.stencilZPass = ReplaceStencilOp;
  return material;
}
