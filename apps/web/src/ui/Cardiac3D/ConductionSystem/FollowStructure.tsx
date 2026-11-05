import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { CONDUCTION_DATA, type ConductionStructure } from "./conduction-structures";

/** El centro de una estructura, en coordenadas de la escena: la media de los
 * puntos de sus trayectos. Para Purkinje es el centro de la red, que cae
 * dentro de los ventrículos; para un nodo, el propio nodo. */
export function structureCentroid(structure: ConductionStructure): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const path of CONDUCTION_DATA.structures[structure].paths) {
    for (const [px, py, pz] of path.points) {
      x += px;
      y += py;
      z += pz;
      count += 1;
    }
  }
  return count === 0 ? [0, 0, 0] : [x / count, y / count, z / count];
}

interface OrbitLike {
  target: Vector3;
  update(): void;
}

/** Cuánto se acerca el objetivo de la cámara al de la estructura en cada
 * fotograma. Un salto seco desorienta; así llega en un cuarto de segundo. */
const EASE = 0.15;

/** Lleva el objetivo de la órbita a la estructura elegida y lo mantiene ahí.
 * El usuario sigue orbitando y acercándose a su gusto: solo cambia el punto
 * alrededor del que gira. */
export function FollowStructure({ structure }: { structure: ConductionStructure | null }) {
  const controls = useThree((state) => state.controls) as OrbitLike | null;
  const target = useMemo(
    () => (structure ? new Vector3(...structureCentroid(structure)) : null),
    [structure]
  );
  useFrame(() => {
    if (!controls || !target) return;
    if (controls.target.distanceToSquared(target) < 1e-10) return;
    controls.target.lerp(target, EASE);
    controls.update();
  });
  return null;
}
