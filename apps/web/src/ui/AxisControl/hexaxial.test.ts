import { describe, expect, it } from "vitest";
import { angleFromPoint, tipFor } from "./hexaxial";

describe("hexaxial — geometría del disco", () => {
  it("convención ECG: 0° a la derecha, +90° hacia abajo", () => {
    // Centro (100,100). Un punto a la derecha es 0°, abajo es +90°.
    expect(angleFromPoint(100, 100, 200, 100)).toBeCloseTo(0);
    expect(angleFromPoint(100, 100, 100, 200)).toBeCloseTo(90);
    expect(angleFromPoint(100, 100, 0, 100)).toBeCloseTo(180);
    expect(angleFromPoint(100, 100, 100, 0)).toBeCloseTo(-90);
  });

  it("la punta del vector cierra el círculo con angleFromPoint", () => {
    const { x, y } = tipFor(-30, 80);
    // tipFor da coordenadas relativas al centro; angleFromPoint(0,0,...) las
    // reinterpreta y devuelve el mismo ángulo.
    expect(angleFromPoint(0, 0, x, y)).toBeCloseTo(-30);
  });
});
