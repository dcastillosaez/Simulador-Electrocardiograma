import { describe, expect, it } from "vitest";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEG,
  CAMERA_PRESETS,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  MODEL_BOUNDING_RADIUS,
  presetPosition,
  type CameraPreset,
} from "./HeartCamera";

const PRESETS = Object.keys(CAMERA_PRESETS) as CameraPreset[];

function distanceFromOrigin(preset: CameraPreset): number {
  const [x, y, z] = presetPosition(preset);
  return Math.hypot(x, y, z);
}

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

  it("encaja el modelo entero en el campo de visión", () => {
    // Media altura visible a la distancia de la cámara. Si es menor que el
    // radio del modelo, alguna vista recorta.
    const halfFov = (CAMERA_FOV_DEG / 2) * (Math.PI / 180);
    const halfVisible = CAMERA_DISTANCE * Math.tan(halfFov);
    expect(halfVisible).toBeGreaterThanOrEqual(MODEL_BOUNDING_RADIUS);
  });

  it("no deja acercarse hasta meterse en la geometría", () => {
    expect(MIN_ZOOM_DISTANCE).toBeGreaterThan(MODEL_BOUNDING_RADIUS);
    expect(MAX_ZOOM_DISTANCE).toBeGreaterThan(CAMERA_DISTANCE);
  });

  it("las vistas superior e inferior no degeneran sobre el eje Y", () => {
    // Una cámara exactamente sobre Y mirando hacia abajo tiene su vector
    // "arriba" paralelo a la dirección de vista y la orientación se vuelve
    // indefinida.
    for (const preset of ["superior", "inferior"] as const) {
      const [x, , z] = CAMERA_PRESETS[preset];
      expect(Math.hypot(x, z)).toBeGreaterThan(0);
    }
  });
});
