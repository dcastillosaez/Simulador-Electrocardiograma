import { describe, expect, it } from "vitest";
import { VALVE_TRANSITION_S, valvePulse } from "./valve-curve";

const RISE = 1.0;
const FALL = 1.4;

describe("valvePulse", () => {
  it("vale cero antes y después de la ventana", () => {
    expect(valvePulse(0.5, RISE, FALL)).toBe(0);
    expect(valvePulse(FALL + VALVE_TRANSITION_S + 0.1, RISE, FALL)).toBe(0);
  });

  it("vale uno en el centro de la ventana", () => {
    expect(valvePulse(1.2, RISE, FALL)).toBe(1);
  });

  it("sube y baja sin tirón", () => {
    // Derivada nula en los extremos de cada flanco: la valva arranca y se para
    // sola. Con una rampa lineal la velocidad sería la misma de principio a
    // fin y el movimiento acabaría en un golpe seco.
    const step = 0.0005;
    const velocidad = (tS: number) =>
      Math.abs(valvePulse(tS + step, RISE, FALL) - valvePulse(tS, RISE, FALL)) / step;

    let maxima = 0;
    for (let tS = RISE; tS < FALL + VALVE_TRANSITION_S; tS += step) {
      maxima = Math.max(maxima, velocidad(tS));
    }

    expect(velocidad(RISE)).toBeLessThan(maxima * 0.1);
    expect(velocidad(RISE + VALVE_TRANSITION_S - step)).toBeLessThan(maxima * 0.1);
    expect(velocidad(FALL)).toBeLessThan(maxima * 0.1);
    expect(velocidad(FALL + VALVE_TRANSITION_S - step)).toBeLessThan(maxima * 0.1);
  });

  it("tarda la transición en abrir del todo", () => {
    expect(valvePulse(RISE + VALVE_TRANSITION_S / 2, RISE, FALL)).toBeCloseTo(0.5, 3);
    expect(valvePulse(RISE + VALVE_TRANSITION_S, RISE, FALL)).toBe(1);
  });

  it("cabe dentro de la contracción isovolumétrica", () => {
    // Los 50 ms de la fase isovolumétrica son el presupuesto: si el
    // movimiento durara más, la mitral seguiría cerrándose cuando la aórtica
    // ya se ha abierto y las dos ventanas con las cuatro cerradas dejarían de
    // verse.
    expect(VALVE_TRANSITION_S).toBeLessThan(0.05);
  });

  it("con una ventana más corta que la transición abre menos, no abre mal", () => {
    // Una taquicardia ventricular a 250 por minuto deja la eyección en unos
    // 46 ms. La válvula no llega a abrirse del todo, que es lo que de verdad
    // pasa, pero el valor sigue acotado y la curva sigue siendo continua.
    const corta = valvePulse(1.01, 1.0, 1.02);

    expect(corta).toBeGreaterThan(0);
    expect(corta).toBeLessThan(1);
  });

  it("nunca sale de [0, 1]", () => {
    for (let tS = 0.5; tS < 2.0; tS += 0.001) {
      const value = valvePulse(tS, RISE, FALL);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
