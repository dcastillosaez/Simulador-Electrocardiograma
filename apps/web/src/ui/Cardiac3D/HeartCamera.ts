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

/** Distancia de la cámara al centro del modelo, en unidades de escena.
 *
 * El modelo se normaliza a altura 1, así que este número no depende de las
 * unidades de la fuente anatómica: con un campo de visión de 35 grados, 0,32
 * deja el corazón encuadrado con algo de aire alrededor. */
export const CAMERA_DISTANCE = 0.32;

/** Las vistas superior e inferior llevan un Z mínimo a propósito: una cámara
 * exactamente sobre el eje Y mirando hacia abajo tiene su vector "arriba"
 * paralelo a su dirección de vista, y la matriz de orientación degenera —la
 * escena aparece rotada al azar o directamente en negro. */
export function presetPosition(preset: CameraPreset): [number, number, number] {
  const [x, y, z] = CAMERA_PRESETS[preset];
  return [x * CAMERA_DISTANCE, y * CAMERA_DISTANCE, z * CAMERA_DISTANCE];
}
