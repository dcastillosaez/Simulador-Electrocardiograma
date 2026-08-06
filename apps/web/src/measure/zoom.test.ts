import { describe, expect, it } from "vitest";
import { clampStart, nextPaperSpeed, PAPER_SPEEDS_MM_S } from "./zoom";

describe("nextPaperSpeed", () => {
  it("sube por los escalones de un electrocardiografo", () => {
    expect(nextPaperSpeed(25, 1)).toBe(50);
    expect(nextPaperSpeed(50, 1)).toBe(100);
  });

  it("no pasa del ultimo escalon", () => {
    expect(nextPaperSpeed(100, 1)).toBe(100);
  });

  it("baja y se detiene en la velocidad de referencia", () => {
    expect(nextPaperSpeed(50, -1)).toBe(25);
    expect(nextPaperSpeed(25, -1)).toBe(25);
  });

  it("los escalones son los del equipo real", () => {
    expect(PAPER_SPEEDS_MM_S).toEqual([25, 50, 100]);
  });
});

describe("clampStart", () => {
  it("con el anillo lleno se puede recorrer todo", () => {
    expect(clampStart(3000, 1250, 5000, 5000)).toBe(3000);
  });

  it("no deja pasar del final del anillo lleno", () => {
    expect(clampStart(4500, 1250, 5000, 5000)).toBe(3750);
  });

  it("no deja empezar antes del origen", () => {
    expect(clampStart(-100, 1250, 5000, 5000)).toBe(0);
  });

  it("con el anillo a medias, el limite es lo escrito", () => {
    // La zona nunca escrita no se puede medir: dejar entrar ahi mostraria una
    // linea plana que parece señal y no lo es.
    expect(clampStart(1500, 1250, 5000, 2000)).toBe(750);
  });

  it("si lo escrito no llena la ventana, se empieza en el origen", () => {
    expect(clampStart(500, 1250, 5000, 800)).toBe(0);
  });
});
