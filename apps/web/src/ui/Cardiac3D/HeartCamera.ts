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
  superior: [0, 1, 0],
  inferior: [0, -1, 0],
} as const satisfies Record<string, readonly [number, number, number]>;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

/** Qué eje del modelo apunta hacia arriba en la pantalla, por vista.
 *
 * En las cuatro vistas de perfil es la cabeza del paciente. En la superior y
 * la inferior no puede serlo —la cámara mira justo por ese eje— y se usa el
 * frente del paciente, que es como se orienta un corte axial: anterior arriba.
 *
 * Antes esto no se declaraba. Las vistas superior e inferior llevaban un Z de
 * 0,001 para que la orientación no degenerara, y con eso *no* degeneraba pero
 * quedaba indefinida: el corazón salía girado en diagonal, distinto según el
 * redondeo. Y una silueta girada ocupa en vertical hasta su diagonal, así que
 * además se salía del encuadre. */
export const CAMERA_UP = {
  anterior: [0, 1, 0],
  posterior: [0, 1, 0],
  left: [0, 1, 0],
  right: [0, 1, 0],
  superior: [0, 0, 1],
  inferior: [0, 0, 1],
} as const satisfies Record<CameraPreset, readonly [number, number, number]>;

export const DEFAULT_PRESET: CameraPreset = "anterior";

/** Campo de visión vertical de la escena, en grados. Tiene que coincidir con
 * el `fov` que `HeartScene` le pasa a la cámara: de ahí sale la distancia. */
export const CAMERA_FOV_DEG = 35;

/** Media caja del modelo en cada eje, medida sobre `heart.glb` con las
 * transformaciones de nodo aplicadas. El conjunto se normaliza a altura 1 y se
 * centra en el origen, así que llega a ±0,5 en Y.
 *
 * Cuidado al remedirlo: los nodos del GLB llevan su transformación en
 * `matrix`, no en `translation`. Leer solo `translation` deja las nueve mallas
 * apiladas en el origen y sale una caja mucho menor. */
export const MODEL_HALF_EXTENTS = { x: 0.317, y: 0.5, z: 0.278 } as const;

/** Radio de la esfera que envuelve el modelo: 0,654, la diagonal de esa caja.
 *
 * Ya no se usa para encuadrar —para eso está la silueta de cada vista— pero
 * sigue siendo el suelo del zoom: por dentro de esa esfera la cámara puede
 * meterse en la geometría. Es exactamente lo que pasaba con la distancia de
 * 0,32 que había antes, que dejaba la cámara *dentro* del corazón y llenaba el
 * panel con una pared de un solo color. De ahí venía la impresión de que el
 * modelo era un bloque gris sin cavidades. */
export const MODEL_BOUNDING_RADIUS = Math.hypot(
  MODEL_HALF_EXTENTS.x,
  MODEL_HALF_EXTENTS.y,
  MODEL_HALF_EXTENTS.z
);

/** Aire alrededor de la silueta. Un 8%: lo justo para que el corazón no toque
 * los bordes del panel. */
export const FRAMING_MARGIN = 1.08;

const HALF_FOV_RAD = (CAMERA_FOV_DEG / 2) * (Math.PI / 180);

/** Mitad de la silueta que presenta el modelo en una vista, separada en sus
 * dos ejes de pantalla, en unidades de escena.
 *
 * Las seis vistas miran por un eje, así que la silueta es la cara de la caja
 * perpendicular a ese eje y no hace falta proyectar nada: mirando de frente se
 * ve el alzado (0,317 × 0,5) y desde arriba la planta (0,317 × 0,278), que es
 * bastante más pequeña.
 *
 * Vertical y horizontal van por separado porque el encuadre las trata
 * distinto: el `fov` de una cámara en perspectiva es el vertical, y el
 * horizontal sale de multiplicarlo por la proporción del lienzo. Mientras el
 * panel fue una franja apaisada bastaba con la mayor de las dos —el ancho
 * sobraba siempre—; con el marco alto que ocupa el sobrante del ECG ya no.
 *
 * Esto solo vale porque `CAMERA_UP` alinea los ejes de pantalla con los del
 * modelo. Con una orientación cualquiera la silueta sale girada y llega a
 * ocupar su diagonal, que es bastante más. */
export function silhouetteHalfExtents(preset: CameraPreset): {
  up: number;
  right: number;
} {
  const { x: hx, y: hy, z: hz } = MODEL_HALF_EXTENTS;
  switch (viewAxis(preset)) {
    // Vistas superior e inferior: `CAMERA_UP` pone el frente del paciente
    // hacia arriba, así que la pantalla es Z arriba y X a la derecha.
    case "y":
      return { up: hz, right: hx };
    case "x":
      return { up: hy, right: hz };
    default:
      return { up: hy, right: hx };
  }
}

/** La mayor de las dos semiextensiones de la silueta. Sigue siendo lo que
 * encuadra un panel al menos tan ancho como alto. */
export function silhouetteRadius(preset: CameraPreset): number {
  const { up, right } = silhouetteHalfExtents(preset);
  return Math.max(up, right);
}

/** Radio que de verdad hay que encuadrar en un lienzo de esa proporción.
 *
 * `aspect` es ancho/alto. Por encima de 1 manda la vertical y esto devuelve lo
 * mismo que `silhouetteRadius`: es el caso que ya había. Por debajo de 1 —un
 * marco más alto que ancho— el campo horizontal se estrecha en esa misma
 * proporción, y encuadrar por la vertical recorta el corazón por los costados
 * sin avisar. Dividir la semiextensión horizontal por la proporción es
 * exactamente lo que hace falta para que quepan las dos.
 *
 * Se acota `aspect` a 1 por arriba a propósito: en un panel apaisado el ancho
 * sobra, pero reducir el radio por eso acercaría la cámara hasta que la
 * silueta tocara el borde superior. El aire del 8% se mantiene. */
export function framingRadius(preset: CameraPreset, aspect: number): number {
  const { up, right } = silhouetteHalfExtents(preset);
  return Math.max(up, right / Math.min(aspect, 1));
}

/** Eje del modelo por el que mira esa vista. */
function viewAxis(preset: CameraPreset): "x" | "y" | "z" {
  const [x, y, z] = CAMERA_PRESETS[preset];
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return "y";
  if (ax >= az) return "x";
  return "z";
}

/** Media profundidad del modelo en la dirección de la mirada.
 *
 * Hace falta porque la proyección es en perspectiva y no ortográfica: lo que
 * tiene que caber en el encuadre no es la silueta a la distancia del centro,
 * sino la **cara de delante**, que está media profundidad más cerca y por
 * tanto se ve más grande.
 *
 * En la vista superior esto no es un detalle: el corazón mide 1,0 de alto, así
 * que su cara superior está a media unidad de ventaja. Encuadrando por el
 * plano central el modelo se salía del panel un 29% — comprobado proyectando
 * las esquinas de las nueve mallas a coordenadas de pantalla. */
export function viewDepth(preset: CameraPreset): number {
  return MODEL_HALF_EXTENTS[viewAxis(preset)];
}

/** Distancia de la cámara para esa vista.
 *
 * `profundidad + radio/tan(fov/2)`: el primer sumando lleva la cámara hasta la
 * cara de delante del modelo y el segundo la aleja lo justo para que esa cara
 * quepa. Es la condición exacta para una caja — la esquina que más se acerca
 * al borde del encuadre es siempre una de las cuatro de esa cara.
 *
 * Sustituye a encajar la esfera envolvente, que daba una distancia única de
 * 2,17 para las seis vistas y dejaba el corazón pequeño con los lados vacíos,
 * sobre todo desde arriba, donde su silueta mide la mitad.
 *
 * El precio de encuadrar ajustado: orbitando lejos del preset el modelo puede
 * salirse por los bordes. Se arregla con la rueda, y a cambio las seis vistas
 * nombradas —que es como se usa esto— llenan el panel. */
export function presetDistance(preset: CameraPreset, aspect = 1): number {
  return (
    viewDepth(preset) +
    (framingRadius(preset, aspect) * FRAMING_MARGIN) / Math.tan(HALF_FOV_RAD)
  );
}

/** Límites del zoom de `OrbitControls`.
 *
 * El mínimo se queda justo fuera de la esfera envolvente: acercarse más mete
 * la cámara en la geometría. El máximo se mide contra la vista que más lejos
 * pone la cámara, para que siempre se pueda alejar de verdad. */
export const MIN_ZOOM_DISTANCE = MODEL_BOUNDING_RADIUS * 1.05;
export const MAX_ZOOM_DISTANCE =
  Math.max(...(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map(presetDistance)) * 3;

/** Posición de la cámara para esa vista. La dirección se normaliza antes de
 * escalarla, para que la distancia sea exactamente la calculada. */
export function presetPosition(
  preset: CameraPreset,
  aspect = 1
): [number, number, number] {
  const [x, y, z] = CAMERA_PRESETS[preset];
  const length = Math.hypot(x, y, z);
  const distance = presetDistance(preset, aspect) / length;
  return [x * distance, y * distance, z * distance];
}
