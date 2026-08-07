import { describe, expect, it } from "vitest";
import { advanceClock } from "./sweep-clock";

describe("advanceClock", () => {
  it("el primer tick no consume nada: no hay contra que medir", () => {
    expect(advanceClock(false, undefined, 100)).toEqual({
      elapsedS: 0,
      nextPreviousS: 100,
    });
  });

  it("en marcha devuelve el tiempo transcurrido desde el tick anterior", () => {
    const tick = advanceClock(false, 100, 100.016);
    // La resta de dos instantes de reloj no es exacta en coma flotante, y
    // tampoco necesita serlo: son segundos de reproduccion, no una medida.
    expect(tick.elapsedS).toBeCloseTo(0.016, 9);
    expect(tick.nextPreviousS).toBe(100.016);
  });

  it("congelado no consume nada", () => {
    expect(advanceClock(true, 100, 100.016).elapsedS).toBe(0);
  });

  it("congelado olvida el reloj, para que al reanudar no se coma el buffer", () => {
    // Sin esto, tras treinta segundos congelado el primer tick pediria treinta
    // segundos de señal y vaciaria el buffer entero sin llegar a dibujarlo.
    expect(advanceClock(true, 100, 130).nextPreviousS).toBeUndefined();
  });

  it("el primer tick tras reanudar consume cero", () => {
    const congelado = advanceClock(true, 100, 130);
    const reanudado = advanceClock(false, congelado.nextPreviousS, 130.016);
    expect(reanudado.elapsedS).toBe(0);
    expect(reanudado.nextPreviousS).toBe(130.016);
  });
});
