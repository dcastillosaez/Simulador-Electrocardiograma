import { useFrame, useThree } from "@react-three/fiber";
import type { RefObject } from "react";
import { chooseScaleBar, formatScaleLength, pixelsPerMm } from "./heart-scale";

export interface ScaleBarProps {
  /** El trazo de la barra. Se le escribe el ancho en píxeles. */
  barRef: RefObject<HTMLDivElement | null>;
  /** El rótulo. Se le escribe la longitud en texto. */
  labelRef: RefObject<HTMLSpanElement | null>;
  /** Ancho máximo que puede ocupar la barra, en píxeles. */
  maxWidthPx?: number;
}

const DEFAULT_MAX_WIDTH_PX = 120;

/** Mantiene la barra de escala al día con la cámara.
 *
 * Vive dentro del `Canvas` porque necesita la cámara, pero escribe sobre DOM
 * de fuera. Escribe estilos directamente en vez de pasar por el estado de
 * React a propósito: esto cambia en cada fotograma mientras se orbita, y
 * provocar un renderizado de React sesenta veces por segundo para mover una
 * barra de doce píxeles sería tirar la mitad del presupuesto de fotograma.
 *
 * No dibuja nada en la escena 3D: una regla en el espacio del modelo se
 * escorzaría al girar y mediría mal justo cuando más falta hace. */
export function ScaleBar({
  barRef,
  labelRef,
  maxWidthPx = DEFAULT_MAX_WIDTH_PX,
}: ScaleBarProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useFrame(() => {
    const bar = barRef.current;
    const label = labelRef.current;
    if (!bar || !label) return;

    // Distancia al centro del modelo, que está en el origen. Es la
    // profundidad a la que la escala es exacta.
    const distance = camera.position.length();
    const perMm = pixelsPerMm(distance, "fov" in camera ? camera.fov : 0, size.height);
    const { mm, px } = chooseScaleBar(perMm, maxWidthPx);

    const width = `${Math.round(px)}px`;
    if (bar.style.width !== width) bar.style.width = width;
    const text = formatScaleLength(mm);
    if (label.textContent !== text) label.textContent = text;
  });

  return null;
}
