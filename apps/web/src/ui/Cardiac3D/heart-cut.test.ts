import { describe, expect, it } from "vitest";
import { MODEL_HALF_EXTENTS } from "./HeartCamera";
import {
  CAP_SIZE,
  CUT_AXES,
  DEFAULT_CUT_AXIS,
  DEFAULT_CUT_POSITION,
  MAX_CUT_POSITION,
  MIN_CUT_POSITION,
  cutPlaneConstant,
  type CutAxis,
} from "./heart-cut";

const AXES = Object.keys(CUT_AXES) as CutAxis[];

describe("ejes de corte", () => {
  it("el coronal es el que por defecto, que es el que más enseña", () => {
    // Medido barriendo los tres planos sobre la geometría real: el coronal
    // deja ocho de las nueve estructuras a la vista, el transversal seis y el
    // sagital cinco.
    expect(DEFAULT_CUT_AXIS).toBe("coronal");
  });

  it("cada eje recorre la extensión del modelo en su dirección", () => {
    expect(CUT_AXES.coronal.halfExtent).toBe(MODEL_HALF_EXTENTS.z);
    expect(CUT_AXES.transversal.halfExtent).toBe(MODEL_HALF_EXTENTS.y);
    expect(CUT_AXES.sagittal.halfExtent).toBe(MODEL_HALF_EXTENTS.x);
  });

  it("las normales apuntan en sentido contrario a su eje", () => {
    // Three descarta donde `normal · punto + constante < 0`. Con la normal
    // invertida se conserva la mitad de coordenada menor, que en el coronal es
    // la posterior: la que se mira desde la vista anterior. Girar una de estas
    // normales dejaría el corte enseñando la mitad de atrás.
    expect(CUT_AXES.coronal.normal).toEqual([0, 0, -1]);
    expect(CUT_AXES.transversal.normal).toEqual([0, -1, 0]);
    expect(CUT_AXES.sagittal.normal).toEqual([-1, 0, 0]);
  });
});

describe("cutPlaneConstant", () => {
  it("recorre el modelo de lado a lado", () => {
    const half = CUT_AXES.coronal.halfExtent;
    expect(cutPlaneConstant("coronal", 0.5)).toBeCloseTo(0);
    expect(cutPlaneConstant("coronal", MIN_CUT_POSITION)).toBeLessThan(0);
    expect(cutPlaneConstant("coronal", MAX_CUT_POSITION)).toBeGreaterThan(0);
    expect(Math.abs(cutPlaneConstant("coronal", MAX_CUT_POSITION))).toBeLessThan(half);
  });

  it("nunca deja el modelo entero ni lo quita entero", () => {
    // En los extremos exactos el corte no se ve o se lo lleva todo, y las dos
    // cosas se leen como una avería.
    for (const axis of AXES) {
      const half = CUT_AXES[axis].halfExtent;
      for (const position of [-5, 0, 1, 9]) {
        expect(Math.abs(cutPlaneConstant(axis, position))).toBeLessThan(half);
      }
    }
  });

  it("avanza de forma monótona con el mando", () => {
    let previous = -Infinity;
    for (let p = 0; p <= 1; p += 0.1) {
      const current = cutPlaneConstant("coronal", p);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("arranca por delante del centro", () => {
    expect(DEFAULT_CUT_POSITION).toBeGreaterThan(0.5);
    expect(cutPlaneConstant("coronal", DEFAULT_CUT_POSITION)).toBeGreaterThan(0);
  });
});

describe("CAP_SIZE", () => {
  it("cubre la sección más grande de cualquiera de los tres ejes", () => {
    // Lo que la tapa tiene que cubrir no es el eje por el que corta, sino la
    // sección perpendicular a él, y en el peor caso su diagonal. La tapa no se
    // ve entera nunca —solo asoma por donde hay corte— así que pasarse es
    // gratis y quedarse corto deja cámaras sin tapar por los bordes.
    const { x, y, z } = MODEL_HALF_EXTENTS;
    const diagonals = {
      coronal: 2 * Math.hypot(x, y),
      transversal: 2 * Math.hypot(x, z),
      sagittal: 2 * Math.hypot(y, z),
    };
    for (const axis of AXES) {
      expect(CAP_SIZE).toBeGreaterThan(diagonals[axis]);
    }
  });
});
