import { describe, expect, it } from "vitest";
import { SampleIndexRing } from "./sample-index";

describe("SampleIndexRing", () => {
  it("empieza vacio, con el cursor en 0", () => {
    const ring = new SampleIndexRing(8);
    expect(ring.capacity).toBe(8);
    expect(ring.writeCursor).toBe(0);
    expect(ring.writtenCount).toBe(0);
  });

  it("guarda el indice absoluto de cada posicion y avanza el cursor", () => {
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([100, 101, 102]));

    expect(ring.writeCursor).toBe(3);
    expect(ring.writtenCount).toBe(3);
    expect(ring.at(0)).toBe(100);
    expect(ring.at(2)).toBe(102);
  });

  it("el cursor envuelve y sobrescribe lo mas antiguo", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([0, 1, 2, 3]));
    ring.push(new Float64Array([4, 5]));

    expect(ring.writeCursor).toBe(2);
    expect(ring.at(0)).toBe(4);
    expect(ring.at(2)).toBe(2);
  });

  it("at() envuelve indices fuera de rango, tambien negativos", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([10, 11, 12, 13]));

    expect(ring.at(4)).toBe(10);
    expect(ring.at(-1)).toBe(13);
  });

  it("findRingPos localiza el mas viejo, el mas nuevo y uno intermedio", () => {
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([50, 51, 52, 53, 54]));

    expect(ring.findRingPos(50)).toBe(0);
    expect(ring.findRingPos(52)).toBe(2);
    expect(ring.findRingPos(54)).toBe(4);
  });

  it("findRingPos funciona con el anillo envuelto", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([0, 1, 2, 3]));
    ring.push(new Float64Array([4, 5]));
    // Contenido fisico: [4, 5, 2, 3]; el mas viejo es el 2, en la posicion 2.
    expect(ring.findRingPos(2)).toBe(2);
    expect(ring.findRingPos(5)).toBe(1);
    expect(ring.findRingPos(0)).toBeNull(); // sobrescrito
  });

  it("findRingPos devuelve null para un indice perdido en un hueco", () => {
    // Los huecos de red hacen que los indices salten: las posiciones del anillo
    // siguen siendo contiguas, los indices absolutos no.
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([10, 11, 12]));
    ring.push(new Float64Array([40, 41]));

    expect(ring.findRingPos(12)).toBe(2);
    expect(ring.findRingPos(40)).toBe(3);
    expect(ring.findRingPos(25)).toBeNull();
  });

  it("findRingPos devuelve null con el anillo vacio", () => {
    expect(new SampleIndexRing(4).findRingPos(0)).toBeNull();
  });

  it("reset vacia el anillo", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([1, 2]));
    ring.reset();

    expect(ring.writeCursor).toBe(0);
    expect(ring.writtenCount).toBe(0);
    expect(ring.findRingPos(1)).toBeNull();
  });
});

describe("SampleIndexRing.findNearestRingPos", () => {
  it("devuelve null con el anillo vacío", () => {
    expect(new SampleIndexRing(4).findNearestRingPos(3)).toBeNull();
  });

  it("encuentra la coincidencia exacta como findRingPos", () => {
    const ring = new SampleIndexRing(8);
    ring.push(new Float64Array([10, 11, 12, 13]));
    expect(ring.findNearestRingPos(12)).toBe(ring.findRingPos(12));
  });

  it("atraviesa un hueco de red quedándose con la muestra más próxima", () => {
    const ring = new SampleIndexRing(8);
    // Se perdieron las muestras 13 a 19.
    ring.push(new Float64Array([10, 11, 12, 20, 21]));
    expect(ring.findRingPos(14)).toBeNull();
    expect(ring.at(ring.findNearestRingPos(14)!)).toBe(12);
    expect(ring.at(ring.findNearestRingPos(18)!)).toBe(20);
  });

  it("fuera del historial devuelve el extremo, también tras dar la vuelta", () => {
    const ring = new SampleIndexRing(4);
    ring.push(new Float64Array([0, 1, 2, 3, 4, 5]));
    expect(ring.oldestSampleIndex).toBe(2);
    expect(ring.newestSampleIndex).toBe(5);
    expect(ring.at(ring.findNearestRingPos(-50)!)).toBe(2);
    expect(ring.at(ring.findNearestRingPos(99)!)).toBe(5);
    expect(ring.at(ring.findNearestRingPos(4.4)!)).toBe(4);
  });
});
