/** Vistas anatómicas estándar.
 *
 * El spec descarta la cámara libre: en una herramienta clínica, una vista sin
 * nombre no se puede comunicar ni reproducir. Se orbita desde un preset, y el
 * preset siempre se puede recuperar.
 *
 * Coordenadas en el sistema del modelo tal y como lo escribe
 * `docs/fase-d/build-heart-model.py`: Y hacia la cabeza, Z hacia el frente del
 * paciente, X hacia su izquierda. */
export const CAMERA_PRESETS = {
  anterior: [0, 0, 1],
  posterior: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  superior: [0, 1, 0.001],
  inferior: [0, -1, 0.001],
} as const satisfies Record<string, readonly [number, number, number]>;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

export const DEFAULT_PRESET: CameraPreset = "anterior";

/** Campo de visión vertical de la escena, en grados. Tiene que coincidir con
 * el `fov` que `HeartScene` le pasa a la cámara: de ahí sale la distancia. */
export const CAMERA_FOV_DEG = 35;

/** Radio de la esfera que envuelve el modelo, medido sobre `heart.glb` con las
 * transformaciones de nodo aplicadas.
 *
 * El conjunto se normaliza a altura 1 y se centra en el origen, así que el
 * corazón llega a ±0,5 en Y — y con los grandes vasos, a 0,654 del centro en
 * diagonal. Ese es el número que importa: no la altura, que es la que hace
 * pensar que 0,3 es una distancia razonable.
 *
 * Cuidado al remedirlo: los nodos del GLB llevan su transformación en
 * `matrix`, no en `translation`. Leer solo `translation` deja las nueve mallas
 * apiladas en el origen y sale un radio mucho menor. */
export const MODEL_BOUNDING_RADIUS = 0.654;

/** Distancia de la cámara al centro del modelo, en unidades de escena.
 *
 * Sale de encajar la esfera envolvente en el campo de visión —
 * `r / sin(fov/2)`— y no de un número elegido a ojo. Así ninguna de las seis
 * vistas recorta: la anterior y las laterales son las que más silueta
 * presentan, pero la superior mira un corazón que sigue midiendo 0,63 de ancho
 * y también tiene que caber.
 *
 * El valor anterior era 0,32, por debajo del radio del propio modelo: la
 * cámara quedaba *dentro* del corazón y la escena mostraba una pared de un
 * solo color que se leía como un bloque gris de una pieza. Es el motivo de que
 * el modelo pareciera no tener cavidades. */
export const CAMERA_DISTANCE =
  MODEL_BOUNDING_RADIUS / Math.sin((CAMERA_FOV_DEG / 2) * (Math.PI / 180));

/** Límites del zoom de `OrbitControls`.
 *
 * El mínimo se queda justo fuera de la esfera envolvente: acercarse más mete
 * la cámara en la geometría y se vuelve al problema de arriba. El máximo da
 * margen para alejarse sin perder el corazón de vista. */
export const MIN_ZOOM_DISTANCE = MODEL_BOUNDING_RADIUS * 1.05;
export const MAX_ZOOM_DISTANCE = CAMERA_DISTANCE * 3;

/** Las vistas superior e inferior llevan un Z mínimo a propósito: una cámara
 * exactamente sobre el eje Y mirando hacia abajo tiene su vector "arriba"
 * paralelo a su dirección de vista, y la matriz de orientación degenera —la
 * escena aparece rotada al azar o directamente en negro. */
export function presetPosition(preset: CameraPreset): [number, number, number] {
  const [x, y, z] = CAMERA_PRESETS[preset];
  return [x * CAMERA_DISTANCE, y * CAMERA_DISTANCE, z * CAMERA_DISTANCE];
}
