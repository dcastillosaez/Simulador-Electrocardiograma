import { describe, expect, it } from "vitest";
import { CardiacTimeline } from "./cardiac-timeline";
import { contractionExcursion } from "./contraction-curve";
import { tremorExcursion } from "./tremor";
import type { MechanicalEventPayload } from "../types/ws-messages";

function beat(overrides: Partial<MechanicalEventPayload> = {}): MechanicalEventPayload {
  return {
    chamber: "ventricles",
    t_start_s: 1.0,
    t_peak_s: 1.15,
    t_end_s: 1.4,
    amplitude: 1,
    index: 0,
    ...overrides,
  };
}

describe("contractionExcursion", () => {
  it("es cero al empezar la contracción", () => {
    expect(contractionExcursion(beat(), 1.0)).toBeCloseTo(0, 5);
  });

  it("es la amplitud completa en el pico", () => {
    expect(contractionExcursion(beat(), 1.15)).toBeCloseTo(1, 5);
  });

  it("vuelve a cero al acabar la relajación", () => {
    expect(contractionExcursion(beat(), 1.4)).toBeCloseTo(0, 5);
  });

  it("escala con la amplitud del evento", () => {
    expect(contractionExcursion(beat({ amplitude: 0.5 }), 1.15)).toBeCloseTo(0.5, 5);
  });

  it("es cero fuera de la ventana", () => {
    expect(contractionExcursion(beat(), 0.5)).toBe(0);
    expect(contractionExcursion(beat(), 2.0)).toBe(0);
  });

  it("es continua: no da saltos entre muestras contiguas", () => {
    let previous = contractionExcursion(beat(), 1.0);
    for (let t = 1.0; t <= 1.4; t += 0.005) {
      const current = contractionExcursion(beat(), t);
      expect(Math.abs(current - previous)).toBeLessThan(0.1);
      previous = current;
    }
  });
});

describe("tremorExcursion", () => {
  it("es determinista: el mismo instante da el mismo valor", () => {
    expect(tremorExcursion(3.21, 7, 0.06)).toBe(tremorExcursion(3.21, 7, 0.06));
  });

  it("nunca supera la amplitud pedida", () => {
    for (let t = 0; t < 5; t += 0.01) {
      expect(Math.abs(tremorExcursion(t, 7, 0.06))).toBeLessThanOrEqual(0.06);
    }
  });

  it("no es constante: efectivamente tiembla", () => {
    const muestras = new Set<number>();
    for (let t = 0; t < 1; t += 0.02) {
      muestras.add(Math.round(tremorExcursion(t, 7, 0.06) * 1000));
    }
    expect(muestras.size).toBeGreaterThan(10);
  });
});

describe("CardiacTimeline", () => {
  it("sin eventos, la excursión es cero", () => {
    const timeline = new CardiacTimeline();

    expect(timeline.excursionAt("ventricles", 1.2)).toBe(0);
  });

  it("devuelve la excursión del evento vigente", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    expect(timeline.excursionAt("ventricles", 1.15)).toBeCloseTo(1, 5);
  });

  it("aísla las cámaras entre sí", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat({ chamber: "atria" })]);

    expect(timeline.excursionAt("ventricles", 1.15)).toBe(0);
    expect(timeline.excursionAt("atria", 1.15)).toBeCloseTo(1, 5);
  });

  it("deduplica por cámara e índice", () => {
    // Reenvío del mismo evento: puede pasar si un mensaje se repite.
    const timeline = new CardiacTimeline();
    timeline.push([beat({ index: 7 })]);
    timeline.push([beat({ index: 7 })]);

    expect(timeline.size).toBe(1);
  });

  it("no confunde el mismo índice en cámaras distintas", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat({ index: 7, chamber: "atria" })]);
    timeline.push([beat({ index: 7, chamber: "ventricles" })]);

    expect(timeline.size).toBe(2);
  });

  it("suma solapes en vez de quedarse con uno solo", () => {
    // Dos contracciones ventriculares solapadas no ocurren fisiológicamente,
    // pero si llegan, el resultado debe seguir acotado y sin discontinuidad.
    const timeline = new CardiacTimeline();
    timeline.push([
      beat({ index: 0 }),
      beat({ index: 1, t_start_s: 1.3, t_peak_s: 1.45, t_end_s: 1.7 }),
    ]);

    const valor = timeline.excursionAt("ventricles", 1.35);
    expect(valor).toBeGreaterThan(0);
    expect(valor).toBeLessThanOrEqual(1);
  });

  it("prune descarta lo ya pasado", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    timeline.prune(5.0);

    expect(timeline.size).toBe(0);
  });

  it("prune conserva lo que aún no ha terminado", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    timeline.prune(1.2);

    expect(timeline.size).toBe(1);
  });

  it("clear vacía la cola", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat()]);

    timeline.clear();

    expect(timeline.size).toBe(0);
  });

  it("un evento futuro todavía no contrae nada", () => {
    const timeline = new CardiacTimeline();
    timeline.push([beat({ t_start_s: 10, t_peak_s: 10.15, t_end_s: 10.4 })]);

    expect(timeline.excursionAt("ventricles", 1.0)).toBe(0);
  });
});
