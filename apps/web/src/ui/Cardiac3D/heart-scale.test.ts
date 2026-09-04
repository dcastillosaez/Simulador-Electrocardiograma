import { describe, expect, it } from "vitest";
import { MODEL_HALF_EXTENTS } from "./HeartCamera";
import {
  MM_PER_UNIT,
  chooseScaleBar,
  formatScaleLength,
  pixelsPerMm,
} from "./heart-scale";

describe("MM_PER_UNIT", () => {
  it("da un corazón de tamaño humano", () => {
    // El conjunto normalizado mide 1 de alto, pero eso incluye el arco aórtico
    // y la cava inferior: son 222 mm de bloque, no un corazón de 222 mm.
    const alturaConjunto = MODEL_HALF_EXTENTS.y * 2 * MM_PER_UNIT;
    expect(alturaConjunto).toBeGreaterThan(200);
    expect(alturaConjunto).toBeLessThan(250);

    // El ancho, que sí es aproximadamente el del corazón con sus vasos.
    const ancho = MODEL_HALF_EXTENTS.x * 2 * MM_PER_UNIT;
    expect(ancho).toBeGreaterThan(120);
    expect(ancho).toBeLessThan(160);
  });
});

describe("pixelsPerMm", () => {
  it("se reduce a la mitad al doblar la distancia", () => {
    const cerca = pixelsPerMm(1, 35, 600);
    const lejos = pixelsPerMm(2, 35, 600);
    expect(lejos).toBeCloseTo(cerca / 2, 8);
  });

  it("crece con la altura del lienzo", () => {
    expect(pixelsPerMm(2, 35, 1200)).toBeCloseTo(pixelsPerMm(2, 35, 600) * 2, 8);
  });

  it("no devuelve infinitos con una cámara en el origen", () => {
    expect(pixelsPerMm(0, 35, 600)).toBe(0);
  });
});

describe("chooseScaleBar", () => {
  it("coge la barra más larga que quepa", () => {
    // 2 px/mm y 120 px de hueco: caben 60 mm, así que toca la de 50.
    expect(chooseScaleBar(2, 120).mm).toBe(50);
    expect(chooseScaleBar(2, 120).px).toBe(100);
  });

  it("se queda con la más corta cuando no cabe ninguna", () => {
    // Antes que mentir sobre la longitud, la barra se sale del hueco.
    const barra = chooseScaleBar(500, 10);
    expect(barra.mm).toBe(1);
    expect(barra.px).toBe(500);
  });

  it("aguanta una escala degenerada sin romperse", () => {
    expect(chooseScaleBar(0, 120).px).toBe(0);
    expect(chooseScaleBar(Number.NaN, 120).px).toBe(0);
  });

  it("nunca devuelve una longitud rara", () => {
    const admisibles = new Set([1, 2, 5, 10, 20, 50, 100, 200]);
    for (let perMm = 0.05; perMm < 40; perMm *= 1.3) {
      expect(admisibles.has(chooseScaleBar(perMm, 120).mm)).toBe(true);
    }
  });
});

describe("formatScaleLength", () => {
  it("pasa a centímetros a partir de un centímetro", () => {
    expect(formatScaleLength(5)).toBe("5 mm");
    expect(formatScaleLength(10)).toBe("1 cm");
    expect(formatScaleLength(50)).toBe("5 cm");
  });
});
