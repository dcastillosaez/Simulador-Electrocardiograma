import { useEffect, useMemo, type MutableRefObject } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Group, Mesh, Vector3, type Material, type Plane } from "three";
import {
  CONDUCTION_GROUP_NAMES,
  CONDUCTION_GROUPS,
  type ConductionGroupName,
} from "../HeartAnimator";
import type { HeartNodes } from "../heart-nodes";
import {
  CONDUCTION_CHAMBERS,
  CONDUCTION_DATA,
  CONDUCTION_STRUCTURES,
  structureAt,
  type ConductionChamber,
  type ConductionStructure,
} from "./conduction-structures";
import { STRUCTURE_ATTRIBUTE, buildConductionGeometries } from "./conduction-geometry";
import { createConductionMaterial, type ConductionUniforms } from "./conduction-material";

export interface ConductionSystemProps {
  nodes: HeartNodes;
  uniforms: ConductionUniforms;
  /** Los grupos se entregan aquí para que `HeartModel` les aplique la misma
   * excursión que a su cámara, en el mismo fotograma. */
  groups: MutableRefObject<Partial<Record<ConductionGroupName, Group>>>;
  visible: boolean;
  opacity: number;
  /** Los mismos planos de corte que el resto del corazón. */
  planes: Plane[] | null;
  /** Orden de dibujo cuando hay corte: detrás de las tapas, como las valvas. */
  renderOrder: number;
  selected: ConductionStructure | null;
  onSelect?: (structure: ConductionStructure | null) => void;
}

/** El sistema de conducción sobre el corazón: cuatro mallas, una por cámara,
 * con los tubos de todas las estructuras que cuelgan de ella.
 *
 * La geometría y el material se crean una vez, al montar. Lo que cambia
 * durante la reproducción —la escala de cada grupo y el pulso— son números
 * que escribe el bucle de dibujo: ni una geometría ni un material nuevos por
 * fotograma. */
export function ConductionSystem({
  nodes,
  uniforms,
  groups,
  visible,
  opacity,
  planes,
  renderOrder,
  selected,
  onSelect,
}: ConductionSystemProps) {
  // Los pivotes salen de los nodos del modelo cargado y no del fichero de
  // trayectos: así el grupo cae exactamente donde está el nodo que imita,
  // aunque el `.glb` se reexporte con otro origen.
  const pivots = useMemo(() => {
    const result = {} as Record<ConductionChamber, Vector3>;
    for (const chamber of CONDUCTION_CHAMBERS) {
      const node = nodes[chamber] as unknown as { position: Vector3 };
      result[chamber] = node.position.clone();
    }
    return result;
  }, [nodes]);

  const geometries = useMemo(
    () => buildConductionGeometries(CONDUCTION_DATA, pivots),
    [pivots]
  );
  const material = useMemo(() => createConductionMaterial(uniforms), [uniforms]);

  useEffect(
    () => () => {
      for (const geometry of Object.values(geometries)) geometry?.dispose();
      material.dispose();
    },
    [geometries, material]
  );

  useEffect(() => {
    const translucent = opacity < 1;
    const before = material.clippingPlanes?.length ?? 0;
    material.clippingPlanes = planes;
    if (material.transparent !== translucent || before !== (planes?.length ?? 0)) {
      material.transparent = translucent;
      material.needsUpdate = true;
    }
    material.opacity = opacity;
    material.depthWrite = !translucent;
  }, [material, opacity, planes]);

  useEffect(() => {
    uniforms.uSelected.value = selected === null ? -1 : CONDUCTION_STRUCTURES.indexOf(selected);
  }, [uniforms, selected]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return;
    // El clic llega también a lo que hay detrás; el tubo es el primero que
    // toca el rayo y con él basta.
    event.stopPropagation();
    const mesh = event.object as Mesh;
    const face = event.face;
    if (!face) return;
    const attribute = mesh.geometry.getAttribute(STRUCTURE_ATTRIBUTE);
    const structure = structureAt(attribute.getX(face.a));
    onSelect(structure === selected ? null : structure);
  };

  // Apagada no se monta: un grupo invisible seguiría recibiendo los rayos del
  // clic. La geometría está memorizada y sobrevive al apagado, así que
  // encender la capa no construye nada.
  if (!visible) return null;

  return (
    <>
      {CONDUCTION_GROUP_NAMES.map((name) => {
        const chamber = CONDUCTION_GROUPS[name];
        const geometry = geometries[chamber];
        if (geometry === null) return null;
        return (
          <group
            key={name}
            position={pivots[chamber]}
            ref={(group: Group | null) => {
              if (group) groups.current[name] = group;
              else delete groups.current[name];
            }}
          >
            <mesh
              geometry={geometry}
              material={material as Material}
              renderOrder={renderOrder}
              onClick={handleClick}
            />
          </group>
        );
      })}
    </>
  );
}
