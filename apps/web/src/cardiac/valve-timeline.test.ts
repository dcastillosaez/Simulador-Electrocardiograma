import { describe, expect, it } from "vitest";
import { RESTING_APERTURE, ValveTimeline } from "./valve-timeline";
import { VALVE_TRANSITION_S } from "./valve-curve";
import type { ValveEventPayload } from "../types/ws-messages";

/** Un ciclo a 72 lpm: sístole de 333 ms, contracción isovolumétrica de 50 y
 * relajación isovolumétrica de 70, que es lo que produce el servidor. */
function cycle(closeAvS: number, index = 0): ValveEventPayload {
  return {
    t_close_av_s: closeAvS,
    t_open_semilunar_s: closeAvS + 0.05,
    t_close_semilunar_s: closeAvS + 0.333,
    t_open_av_s: closeAvS + 0.403,
    index,
  };
}

const CYCLE = cycle(1.0);
/** A mitad de la eyección: lejos de cualquier flanco. */
const EJECTING = 1.2;
/** A mitad del llenado del latido siguiente. */
const FILLING = 1.7;

describe("ValveTimeline", () => {
  it("en reposo deja las auriculoventriculares abiertas y las sigmoideas cerradas", () => {
    // No es un valor por defecto elegido: es la posición en la que las deja la
    // presión cuando no hay sístole. Por eso una fibrilación ventricular
    // —que no manda ningún ciclo— enseña lo correcto sin un caso especial.
    const timeline = new ValveTimeline();

    expect(timeline.apertureAt("atrioventricular", 5)).toBe(1);
    expect(timeline.apertureAt("semilunar", 5)).toBe(0);
  });

  it("el reposo que publica la tabla es el que devuelve la cola vacía", () => {
    // El panel de estado se pinta con `RESTING_APERTURE` antes de que llegue
    // el primer latido. Si las dos definiciones se separaran, el panel
    // arrancaría diciendo lo contrario de lo que el modelo enseña.
    const timeline = new ValveTimeline();

    expect(timeline.apertureAt("atrioventricular", 5)).toBe(
      RESTING_APERTURE.atrioventricular
    );
    expect(timeline.apertureAt("semilunar", 5)).toBe(RESTING_APERTURE.semilunar);
  });

  it("cierra las auriculoventriculares durante la sístole", () => {
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);

    expect(timeline.apertureAt("atrioventricular", EJECTING)).toBe(0);
  });

  it("abre las sigmoideas durante la eyección", () => {
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);

    expect(timeline.apertureAt("semilunar", EJECTING)).toBe(1);
  });

  it("vuelve a abrir las auriculoventriculares en el llenado", () => {
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);

    expect(timeline.apertureAt("atrioventricular", FILLING)).toBe(1);
    expect(timeline.apertureAt("semilunar", FILLING)).toBe(0);
  });

  it("deja las cuatro cerradas en la contracción isovolumétrica", () => {
    // El detalle que separa una animación fisiológica de una que alterna dos
    // estados: hay un instante en que ni entra ni sale sangre del ventrículo.
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);
    const tS = CYCLE.t_open_semilunar_s - 0.005;

    expect(timeline.apertureAt("atrioventricular", tS)).toBe(0);
    expect(timeline.apertureAt("semilunar", tS)).toBe(0);
  });

  it("deja las cuatro cerradas en la relajación isovolumétrica", () => {
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);
    const tS = CYCLE.t_open_av_s - 0.005;

    expect(timeline.apertureAt("atrioventricular", tS)).toBe(0);
    expect(timeline.apertureAt("semilunar", tS)).toBe(0);
  });

  it("nunca abre las dos parejas a la vez", () => {
    // Con las cuatro abiertas la sangre volvería a la aurícula desde la aorta.
    // No hay ningún instante del ciclo en que eso ocurra.
    const timeline = new ValveTimeline();
    timeline.push([CYCLE, cycle(1.833, 1)]);

    for (let tS = 0.8; tS < 2.6; tS += 0.002) {
      const av = timeline.apertureAt("atrioventricular", tS);
      const semilunar = timeline.apertureAt("semilunar", tS);
      expect(Math.min(av, semilunar)).toBeLessThan(0.5);
    }
  });

  it("mueve las valvas sin saltos", () => {
    // El paso de un fotograma a 60 Hz no puede cambiar la apertura de golpe:
    // eso es lo que se ve como un tirón.
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);
    const step = 1 / 60;

    let previous = timeline.apertureAt("atrioventricular", 0.9);
    for (let tS = 0.9; tS < 2.0; tS += step) {
      const value = timeline.apertureAt("atrioventricular", tS);
      expect(Math.abs(value - previous)).toBeLessThan(0.7);
      previous = value;
    }
  });

  it("deduplica por índice de latido", () => {
    // Los mensajes se solapan en el tiempo: el mismo latido llega más de una
    // vez y no puede contarse dos.
    const timeline = new ValveTimeline();

    timeline.push([CYCLE]);
    timeline.push([CYCLE, cycle(1.833, 1)]);

    expect(timeline.size).toBe(2);
  });

  it("no deja que dos ciclos solapados abran de más", () => {
    // A frecuencias extremas la relajación isovolumétrica de un latido cae
    // dentro de la sístole del siguiente. Sumando saldrían valores fuera de
    // [0, 1]; con el máximo, las dos ventanas se funden en una.
    const timeline = new ValveTimeline();
    timeline.push([cycle(1.0), cycle(1.2, 1)]);

    for (let tS = 0.9; tS < 2.0; tS += 0.005) {
      expect(timeline.apertureAt("atrioventricular", tS)).toBeGreaterThanOrEqual(0);
      expect(timeline.apertureAt("atrioventricular", tS)).toBeLessThanOrEqual(1);
      expect(timeline.apertureAt("semilunar", tS)).toBeGreaterThanOrEqual(0);
      expect(timeline.apertureAt("semilunar", tS)).toBeLessThanOrEqual(1);
    }
  });

  describe("phaseAt", () => {
    it("nombra las cuatro fases del ciclo", () => {
      const timeline = new ValveTimeline();
      timeline.push([CYCLE]);

      expect(timeline.phaseAt(CYCLE.t_close_av_s + 0.01)).toBe(
        "isovolumetric-contraction"
      );
      expect(timeline.phaseAt(EJECTING)).toBe("ejection");
      expect(timeline.phaseAt(CYCLE.t_close_semilunar_s + 0.01)).toBe(
        "isovolumetric-relaxation"
      );
      expect(timeline.phaseAt(FILLING)).toBe("filling");
    });

    it("distingue las dos fases isovolumétricas, que se ven igual", () => {
      // Con dos válvulas cerradas la imagen es la misma; solo los instantes
      // dicen si el ventrículo se está contrayendo o relajándose.
      const timeline = new ValveTimeline();
      timeline.push([CYCLE]);
      const contrayendo = CYCLE.t_close_av_s + 0.04;
      const relajando = CYCLE.t_close_semilunar_s + 0.04;

      expect(timeline.apertureAt("atrioventricular", contrayendo)).toBe(
        timeline.apertureAt("atrioventricular", relajando)
      );
      expect(timeline.phaseAt(contrayendo)).not.toBe(timeline.phaseAt(relajando));
    });

    it("sin ciclos no hay fase que contar", () => {
      // Una fibrilación ventricular no está en llenado: no tiene sístole.
      expect(new ValveTimeline().phaseAt(5)).toBeNull();
    });
  });

  describe("prune", () => {
    it("descarta lo que ya no puede influir", () => {
      const timeline = new ValveTimeline();
      timeline.push([CYCLE, cycle(1.833, 1)]);

      timeline.prune(1.8);

      expect(timeline.size).toBe(1);
    });

    it("conserva el ciclo mientras la válvula sigue abriéndose", () => {
      // El instante en que la auriculoventricular empieza a abrirse es el
      // último del ciclo, pero el movimiento dura una transición más: podar
      // ahí la abriría de golpe.
      const timeline = new ValveTimeline();
      timeline.push([CYCLE]);

      timeline.prune(CYCLE.t_open_av_s + VALVE_TRANSITION_S / 2);

      expect(timeline.size).toBe(1);
    });
  });

  it("se vacía del todo al reiniciar", () => {
    // Un ritmo nuevo arranca en t=0 y recorrería otra vez instantes ya usados.
    const timeline = new ValveTimeline();
    timeline.push([CYCLE]);

    timeline.clear();
    timeline.push([CYCLE]);

    expect(timeline.size).toBe(1);
  });
});
