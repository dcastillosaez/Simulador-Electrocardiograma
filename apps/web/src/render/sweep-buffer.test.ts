import { describe, expect, it } from "vitest";
import { SweepBuffer, sweepCapacitySamples } from "./sweep-buffer";
import { PX_PER_MM } from "./grid-layer";

describe("sweepCapacitySamples", () => {
  it("dimensiona el anillo al ancho del canvas con los valores por defecto del proyecto", () => {
    // 800px a 25mm/s y 500Hz: 0,188976px por muestra -> 4233 muestras.
    expect(sweepCapacitySamples(800, 25 * PX_PER_MM, 500)).toBe(4233);
  });

  it("los valores por defecto cubren ~8,5s de papel, no los 0,7s del buffer de jitter", () => {
    // Esta es la razón de ser del anillo: la ventana visible en pantalla y el
    // amortiguador de red son dos cosas de tamaño muy distinto.
    const seconds = sweepCapacitySamples(800, 25 * PX_PER_MM, 500) / 500;
    expect(seconds).toBeGreaterThan(8.4);
    expect(seconds).toBeLessThan(8.6);
  });

  it("al doblar la velocidad de papel cabe la mitad de señal", () => {
    expect(sweepCapacitySamples(800, 50 * PX_PER_MM, 500)).toBe(2117);
  });

  it("al doblar la cadencia de muestreo caben el doble de muestras", () => {
    expect(sweepCapacitySamples(800, 25 * PX_PER_MM, 1000)).toBe(8467);
  });

  it("nunca devuelve una capacidad inservible (< 1 muestra)", () => {
    expect(sweepCapacitySamples(1, 25 * PX_PER_MM, 1)).toBeGreaterThanOrEqual(1);
  });
});

describe("SweepBuffer", () => {
  it("empieza vacio, con el cursor de escritura en 0", () => {
    const sweep = new SweepBuffer(8);
    expect(sweep.capacity).toBe(8);
    expect(sweep.writeCursor).toBe(0);
    expect(sweep.hasSamples).toBe(false);
  });

  it("escribe en orden y avanza el cursor", () => {
    const sweep = new SweepBuffer(8);
    sweep.push(new Float32Array([1, 2, 3]));

    expect(sweep.writeCursor).toBe(3);
    expect(sweep.hasSamples).toBe(true);
    expect(sweep.at(0)).toBe(1);
    expect(sweep.at(1)).toBe(2);
    expect(sweep.at(2)).toBe(3);
  });

  it("el cursor envuelve al llegar al final y sobrescribe lo mas antiguo", () => {
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1, 2, 3, 4]));
    expect(sweep.writeCursor).toBe(0); // dio la vuelta exacta

    sweep.push(new Float32Array([5, 6]));

    expect(sweep.writeCursor).toBe(2);
    expect(sweep.at(0)).toBe(5); // sobrescrito
    expect(sweep.at(1)).toBe(6); // sobrescrito
    expect(sweep.at(2)).toBe(3); // sigue siendo de la vuelta anterior
    expect(sweep.at(3)).toBe(4);
  });

  it("empujar mas muestras que la capacidad no lanza ni hace crecer el anillo", () => {
    const sweep = new SweepBuffer(4);
    const many = new Float32Array(4 * 3 + 1); // tres vueltas y una muestra
    for (let i = 0; i < many.length; i++) many[i] = i;

    expect(() => sweep.push(many)).not.toThrow();

    expect(sweep.capacity).toBe(4);
    expect(sweep.writeCursor).toBe(1);
    // Solo sobreviven las últimas `capacity` muestras: la 12 acaba de
    // escribirse en la posición 0, y 9, 10 y 11 son las de la vuelta anterior.
    expect(sweep.at(0)).toBe(12);
    expect(sweep.at(1)).toBe(9);
    expect(sweep.at(2)).toBe(10);
    expect(sweep.at(3)).toBe(11);
  });

  it("at() acepta indices fuera de rango y los envuelve por modulo, tambien negativos", () => {
    // El dibujo incremental necesita leer la muestra anterior al cursor para
    // enlazar el segmento de este tick con el del anterior; en el cursor 0 eso
    // es el índice -1.
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1, 2, 3, 4]));

    expect(sweep.at(4)).toBe(1);
    expect(sweep.at(9)).toBe(2);
    expect(sweep.at(-1)).toBe(4);
  });

  it("push de un array vacio no mueve el cursor ni marca contenido", () => {
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([]));

    expect(sweep.writeCursor).toBe(0);
    expect(sweep.hasSamples).toBe(false);
  });

  it("reset() limpia el contenido y devuelve el cursor al origen", () => {
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1, 2, 3]));

    sweep.reset();

    expect(sweep.writeCursor).toBe(0);
    expect(sweep.hasSamples).toBe(false);
    expect(sweep.at(0)).toBe(0);
    expect(sweep.at(1)).toBe(0);
    expect(sweep.at(2)).toBe(0);
  });

  it("marca la discontinuidad en la posicion de la primera muestra del push", () => {
    const sweep = new SweepBuffer(16);
    sweep.push(new Float32Array([1, 2, 3]));
    sweep.push(new Float32Array([4, 5]), { gapBefore: true });

    expect(sweep.isDiscontinuityAt(0)).toBe(false);
    expect(sweep.isDiscontinuityAt(3)).toBe(true);
    expect(sweep.isDiscontinuityAt(4)).toBe(false);
  });

  it("un push sin hueco limpia una marca anterior en esa misma posicion", () => {
    // El anillo se reescribe cada vuelta. Sin limpiar, la marca de una vuelta
    // pasada reaparecería como un corte fantasma en la vuelta siguiente.
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1]), { gapBefore: true });
    expect(sweep.isDiscontinuityAt(0)).toBe(true);

    sweep.push(new Float32Array([2, 3, 4]));
    sweep.push(new Float32Array([5]));

    expect(sweep.isDiscontinuityAt(0)).toBe(false);
  });

  it("isDiscontinuityAt envuelve los indices como at()", () => {
    const sweep = new SweepBuffer(8);
    sweep.push(new Float32Array([1, 2]));
    sweep.push(new Float32Array([3]), { gapBefore: true });

    expect(sweep.isDiscontinuityAt(2)).toBe(true);
    expect(sweep.isDiscontinuityAt(10)).toBe(true);
    expect(sweep.isDiscontinuityAt(-6)).toBe(true);
  });

  it("writtenCount cuenta las muestras escritas y se satura en la capacidad", () => {
    // Lo necesita el repintado completo: sin saberlo, pintaría los ceros de
    // relleno del array como una linea plana en la parte del anillo que
    // todavia no se ha escrito nunca.
    const sweep = new SweepBuffer(4);
    expect(sweep.writtenCount).toBe(0);

    sweep.push(new Float32Array([1, 2]));
    expect(sweep.writtenCount).toBe(2);

    sweep.push(new Float32Array([3, 4, 5, 6, 7]));
    expect(sweep.writtenCount).toBe(4);
  });

  it("reset borra las marcas y el contador", () => {
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1]), { gapBefore: true });
    sweep.reset();

    expect(sweep.isDiscontinuityAt(0)).toBe(false);
    expect(sweep.writtenCount).toBe(0);
    expect(sweep.hasSamples).toBe(false);
  });

  it("un hueco marcado justo al envolver el anillo aterriza en el indice fisico correcto", () => {
    // Distinto del test de "limpia una marca anterior": aqui la vuelta la da
    // un push CON hueco, para probar que la marca nueva llega al indice
    // envuelto (0), no que una marca vieja se borra ahi.
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1, 2, 3, 4])); // llena el anillo exacto, el cursor vuelve a 0
    sweep.push(new Float32Array([5]), { gapBefore: true }); // primera muestra tras la vuelta

    expect(sweep.at(0)).toBe(5);
    expect(sweep.isDiscontinuityAt(0)).toBe(true);
    expect(sweep.isDiscontinuityAt(3)).toBe(false); // la vuelta anterior no dejo marca ahi
  });
});
