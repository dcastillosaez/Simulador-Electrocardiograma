import { describe, expect, it } from "vitest";
import {
  CAMERA_FOV_DEG,
  CAMERA_PRESETS,
  CAMERA_UP,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  MODEL_BOUNDING_RADIUS,
  MODEL_HALF_EXTENTS,
  presetDistance,
  presetPosition,
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
