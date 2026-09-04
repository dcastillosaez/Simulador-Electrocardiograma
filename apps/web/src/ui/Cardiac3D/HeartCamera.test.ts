import { describe, expect, it } from "vitest";
import {
  CAMERA_FOV_DEG,
  CAMERA_PRESETS,
  CAMERA_UP,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  MODEL_BOUNDING_RADIUS,
  MODEL_HALF_EXTENTS,
  framingRadius,
  presetDistance,
  presetPosition,
  silhouetteHalfExtents,
  silhouetteRadius,
  viewDepth,
  type CameraPreset,
} from "./HeartCamera";

const PRESETS = Object.keys(CAMERA_PRESETS) as CameraPreset[];
const HALF_FOV = (CAMERA_FOV_DEG / 2) * (Math.PI / 180);

function distanceFromOrigin(preset: CameraPreset): number {
  const [x, y, z] = presetPosition(preset);
  return Math.hypot(x, y, z);
}

/** Lo que se ve de alto y de ancho a la distancia de la cara de delante, que
 * es la que decide el encuadre. */
function visibleHalfExtents(
  preset: CameraPreset,
  aspect: number
): { up: number; right: number } {
  const toNearFace = presetDistance(preset, aspect) - viewDepth(preset);
  const up = toNearFace * Math.tan(HALF_FOV);
  return { up, right: up * aspect };
}

describe("silueta por vista", () => {
  it("de frente y de lado presenta el alzado; desde arriba, la planta", () => {
    const { x, y, z } = MODEL_HALF_EXTENTS;
    // El corazón mide 1 de alto y 0,63 de ancho: desde arriba se ve una
    // silueta bastante más pequeña, y encuadrarla igual que la frontal deja
    // el panel medio vacío.
    expect(silhouetteRadius("anterior")).toBe(Math.max(x, y));
    expect(silhouetteRadius("posterior")).toBe(Math.max(x, y));
    expect(silhouetteRadius("left")).toBe(Math.max(y, z));
    expect(silhouetteRadius("right")).toBe(Math.max(y, z));
    expect(silhouetteRadius("superior")).toBe(Math.max(x, z));
    expect(silhouetteRadius("inferior")).toBe(Math.max(x, z));
  });

  it("acerca la cámara en las vistas de silueta menor", () => {
    expect(presetDistance("superior")).toBeLessThan(presetDistance("anterior"));
  });
});

describe("encuadre de la cámara", () => {
  it("deja la cámara fuera del modelo en las seis vistas", () => {
    // El fallo que esto vigila no da error ni pantalla negra: la cámara
    // quedaba a 0,32 del centro, dentro de una esfera envolvente de 0,654, y
    // la escena mostraba una pared de un solo color. Se lee como un corazón
    // gris de una pieza, no como una cámara mal puesta.
    for (const preset of PRESETS) {
      expect(distanceFromOrigin(preset)).toBeGreaterThan(MODEL_BOUNDING_RADIUS);
    }
  });

  it("coloca la cámara exactamente a la distancia calculada", () => {
    // Las vistas superior e inferior llevan un Z mínimo que alarga el vector:
    // sin normalizar, la distancia real no sería la que se pidió.
    for (const preset of PRESETS) {
      expect(distanceFromOrigin(preset)).toBeCloseTo(presetDistance(preset), 6);
    }
  });

  it("encaja la cara de delante, que es la que se ve más grande", () => {
    // Con perspectiva, lo que decide el encuadre no es la silueta al plano
    // central sino la cara cercana a la cámara. Medir contra el centro daba
    // por bueno un encuadre en el que el modelo se salía un 29% en la vista
    // superior, que es donde más profundidad hay.
    for (const preset of PRESETS) {
      const distanceToNearFace = presetDistance(preset) - viewDepth(preset);
      const halfVisible = distanceToNearFace * Math.tan(HALF_FOV);
      expect(halfVisible).toBeGreaterThan(silhouetteRadius(preset));
    }
  });

  it("la vista superior encuadra más cerca que la anterior, pero cuenta su profundidad", () => {
    // El corazón mide 1,0 de alto: mirando desde arriba la silueta es la
    // menor de las tres, pero la profundidad es la mayor y se come parte de
    // lo ganado.
    expect(silhouetteRadius("superior")).toBeLessThan(silhouetteRadius("anterior"));
    expect(viewDepth("superior")).toBeGreaterThan(viewDepth("anterior"));
    expect(presetDistance("superior")).toBeLessThan(presetDistance("anterior"));
  });

  it("no deja acercarse hasta meterse en la geometría", () => {
    expect(MIN_ZOOM_DISTANCE).toBeGreaterThan(MODEL_BOUNDING_RADIUS);
    for (const preset of PRESETS) {
      expect(MAX_ZOOM_DISTANCE).toBeGreaterThan(presetDistance(preset));
    }
  });

  it("ninguna vista tiene el 'arriba' paralelo a la dirección de mirada", () => {
    // Si lo fuera, la orientación de la cámara queda indefinida: la escena
    // sale girada de forma imprevisible, y una silueta girada ocupa en
    // vertical hasta su diagonal, así que además se sale del encuadre.
    for (const preset of PRESETS) {
      const [dx, dy, dz] = CAMERA_PRESETS[preset];
      const [ux, uy, uz] = CAMERA_UP[preset];
      const cross = Math.hypot(
        dy * uz - dz * uy,
        dz * ux - dx * uz,
        dx * uy - dy * ux
      );
      expect(cross).toBeGreaterThan(0.5);
    }
  });
});

describe("encuadre en un marco más alto que ancho", () => {
  // El corazón dejó de vivir en una franja apaisada: ocupa el sobrante que le
  // deja el papel del ECG, que es una columna estrecha y alta —258×787 en una
  // pantalla de 1600×900—. Con el `fov` vertical de una cámara en perspectiva,
  // el campo horizontal se estrecha con la proporción, y encuadrar por la
  // vertical recortaba el modelo por los costados sin dar ningún error.
  const TALL = 258 / 787;

  it("no cambia nada mientras el marco sea al menos tan ancho como alto", () => {
    for (const preset of PRESETS) {
      expect(framingRadius(preset, 1)).toBeCloseTo(silhouetteRadius(preset), 12);
      expect(framingRadius(preset, 2.5)).toBeCloseTo(silhouetteRadius(preset), 12);
      expect(presetDistance(preset, 1)).toBeCloseTo(presetDistance(preset), 12);
    }
  });

  it("aleja la cámara cuando el marco se estrecha", () => {
    for (const preset of PRESETS) {
      expect(presetDistance(preset, TALL)).toBeGreaterThan(presetDistance(preset, 1));
    }
  });

  it("mantiene el modelo entero dentro del encuadre en las seis vistas", () => {
    for (const preset of PRESETS) {
      const silhouette = silhouetteHalfExtents(preset);
      const visible = visibleHalfExtents(preset, TALL);
      expect(visible.up).toBeGreaterThan(silhouette.up);
      // Esta es la que fallaba: en la vista superior el corazón mide 0,317 de
      // semiancho y solo 0,278 de semialto, así que el costado es lo primero
      // que se sale en cuanto el marco deja de ser apaisado.
      expect(visible.right).toBeGreaterThan(silhouette.right);
    }
  });

  it("con la vista superior en un marco estrecho manda el ancho, no el alto", () => {
    const { up, right } = silhouetteHalfExtents("superior");
    expect(right).toBeGreaterThan(up);
    expect(framingRadius("superior", TALL)).toBeCloseTo(right / TALL, 12);
  });
});
