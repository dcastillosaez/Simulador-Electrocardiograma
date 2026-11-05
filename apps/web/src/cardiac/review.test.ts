import { describe, expect, it } from "vitest";
import { ReviewController } from "./review-controller";
import { PlaybackClock } from "./playback-clock";
import { HeartStateTimeline, type HeartStateValues } from "./heart-state-timeline";
import { CardiacTimeline } from "./cardiac-timeline";
import { ValveTimeline } from "./valve-timeline";
import { ElectricalTimeline } from "./electrical-timeline";
import { phaseAt } from "./electrical-phase";
import { excursionFor } from "../ui/Cardiac3D/chamber-excursion";
import type { ElectricalImpulsePayload } from "../types/ws-messages";

function impulse(index: number, t0: number): ElectricalImpulsePayload {
  return {
    impulse: index,
    origin: "sinus",
    outcome: "conducted",
    segments: [
      { structure: "sa_node", t_start_s: t0, t_end_s: t0 },
      { structure: "right_atrium", t_start_s: t0, t_end_s: t0 + 0.1 },
      { structure: "left_atrium", t_start_s: t0 + 0.03, t_end_s: t0 + 0.1 },
      { structure: "av_node", t_start_s: t0 + 0.1, t_end_s: t0 + 0.13 },
      { structure: "his_bundle", t_start_s: t0 + 0.13, t_end_s: t0 + 0.15 },
      { structure: "bundle_branches", t_start_s: t0 + 0.15, t_end_s: t0 + 0.175 },
      { structure: "purkinje", t_start_s: t0 + 0.15, t_end_s: t0 + 0.175 },
      { structure: "ventricular_myocardium", t_start_s: t0 + 0.175, t_end_s: t0 + 0.265 },
      { structure: "ventricular_recovery", t_start_s: t0 + 0.4, t_end_s: t0 + 0.6 },
    ],
  };
}

const STATE: HeartStateValues = {
  rhythm_id: "sinus_normal",
  heart_rate_bpm: 72,
  atrial_mode: "synchronous",
  ventricular_mode: "synchronous",
  atrial_amplitude: 1,
  ventricular_amplitude: 1,
  flutter_hz: 5,
};

describe("ReviewController", () => {
  it("la velocidad convierte tiempo real en tiempo de simulación", () => {
    const review = new ReviewController({ startS: 0, endS: 10 }, 2);
    review.playing = true;
    review.speed = 0.25;
    for (let i = 0; i < 240; i += 1) review.tick(1 / 60);
    expect(review.timeS).toBeCloseTo(3, 6);
  });

  it("en el borde del historial se detiene sin dar la vuelta", () => {
    const review = new ReviewController({ startS: 0, endS: 10 }, 9.9);
    review.playing = true;
    review.speed = 2;
    review.tick(1);
    expect(review.timeS).toBe(10);
    expect(review.playing).toBe(false);
  });

  it("seek no sale del historial", () => {
    const review = new ReviewController({ startS: 4, endS: 10 });
    review.seek(-3);
    expect(review.timeS).toBe(4);
    review.seek(99);
    expect(review.timeS).toBe(10);
  });

  it("el paso salta al siguiente límite de tramo eléctrico", () => {
    const electrical = new ElectricalTimeline();
    electrical.push([impulse(0, 1)]);
    const review = new ReviewController({ startS: 0, endS: 10 }, 1.11);
    review.step(1, electrical);
    expect(review.timeS).toBeCloseTo(1.13);
    review.step(-1, electrical);
    expect(review.timeS).toBeCloseTo(1.1);
  });

  it("repetir fase recorre en bucle la fase en curso", () => {
    const electrical = new ElectricalTimeline();
    electrical.push([impulse(0, 1)]);
    const review = new ReviewController({ startS: 0, endS: 10 }, 1.2);
    const phase = phaseAt(electrical, review.timeS)!;
    expect(phase.phase).toBe("QRS");
    review.toggleLoop(phase);
    for (let i = 0; i < 100; i += 1) {
      review.tick(1 / 60);
      expect(review.timeS).toBeGreaterThanOrEqual(phase.startS - 1e-9);
      expect(review.timeS).toBeLessThanOrEqual(phase.endS + 1e-9);
    }
  });
});

describe("phaseAt", () => {
  it("nombra P, PR, QRS y T, y entre latidos no nombra nada", () => {
    const electrical = new ElectricalTimeline();
    electrical.push([impulse(0, 1)]);
    expect(phaseAt(electrical, 1.05)?.phase).toBe("P");
    expect(phaseAt(electrical, 1.14)?.phase).toBe("PR");
    expect(phaseAt(electrical, 1.2)?.phase).toBe("QRS");
    expect(phaseAt(electrical, 1.5)?.phase).toBe("T");
    expect(phaseAt(electrical, 1.8)).toBeNull();
  });
});

describe("PlaybackClock", () => {
  it("en directo es la cabeza; en repaso, el cursor; la poda siempre ve la cabeza", () => {
    const source = { playbackTimeS: 12 as number | null };
    const clock = new PlaybackClock(source);
    expect(clock.timeS).toBe(12);
    clock.reviewTimeS = 5;
    expect(clock.timeS).toBe(5);
    expect(clock.liveTimeS).toBe(12);
    clock.reviewTimeS = null;
    expect(clock.isReviewing).toBe(false);
  });
});

describe("HeartStateTimeline", () => {
  it("devuelve el estado vigente en cada instante", () => {
    const states = new HeartStateTimeline();
    states.push(STATE, 1);
    states.push(STATE, 1.25); // igual: no se guarda
    states.push({ ...STATE, atrial_mode: "fibrillating" }, 6);
    expect(states.size).toBe(2);
    expect(states.valuesAt(0)?.atrial_mode).toBe("synchronous");
    expect(states.valuesAt(5.9)?.atrial_mode).toBe("synchronous");
    expect(states.valuesAt(6.1)?.atrial_mode).toBe("fibrillating");
  });

  it("la poda conserva el estado vigente en el horizonte", () => {
    const states = new HeartStateTimeline();
    states.push(STATE, 1);
    states.push({ ...STATE, flutter_hz: 6 }, 2);
    states.push({ ...STATE, flutter_hz: 7 }, 9);
    states.prune(5);
    expect(states.size).toBe(2);
    expect(states.valuesAt(5)?.flutter_hz).toBe(6);
  });
});

describe("la pose es función pura del tiempo", () => {
  it("el temblor de una cámara que fibrila no depende de cómo se llega", () => {
    const states = new HeartStateTimeline();
    states.push({ ...STATE, atrial_mode: "fibrillating", atrial_amplitude: 0.06, flutter_hz: 7 }, 0);
    const timeline = new CardiacTimeline();
    const at = (t: number) => excursionFor("atria", t, timeline, states.valuesAt(t));
    const direct = at(3.21);
    for (let t = 9; t > 3.21; t -= 0.13) at(t);
    expect(at(3.21)).toBe(direct);
  });
});

describe("retención acotada", () => {
  it("ocho horas a 72 lpm, podando contra la cabeza del directo, no acumulan nada", () => {
    const retentionS = 10;
    const cardiac = new CardiacTimeline();
    const valves = new ValveTimeline();
    const electrical = new ElectricalTimeline();
    const states = new HeartStateTimeline();
    const rr = 60 / 72;
    let maxSizes = [0, 0, 0, 0];
    const hours = 8 * 3600;
    // Se simula a saltos de un latido; la poda corre cada dos segundos como
    // en `HeartModel` (cada 120 fotogramas).
    let nextPrune = 2;
    for (let i = 0, t = 0; t < hours; i += 1, t += rr) {
      electrical.push([impulse(i, t)], 0);
      cardiac.push(
        [{ chamber: "ventricles", t_start_s: t + 0.175, t_peak_s: t + 0.3, t_end_s: t + 0.5, amplitude: 1, index: i }],
        0
      );
      valves.push(
        [{ t_close_av_s: t + 0.175, t_open_semilunar_s: t + 0.22, t_close_semilunar_s: t + 0.5, t_open_av_s: t + 0.57, index: i }],
        0
      );
      states.push({ ...STATE, heart_rate_bpm: 72 + (i % 2) }, t);
      if (t >= nextPrune) {
        const horizon = t - retentionS - 1;
        cardiac.prune(horizon);
        valves.prune(horizon);
        electrical.prune(horizon);
        states.prune(horizon);
        nextPrune += 2;
      }
      maxSizes = [
        Math.max(maxSizes[0], cardiac.size),
        Math.max(maxSizes[1], valves.size),
        Math.max(maxSizes[2], electrical.size),
        Math.max(maxSizes[3], states.size),
      ];
    }
    // Once segundos de historia más los dos entre podas, a 1,2 latidos por
    // segundo: unos dieciséis. El tope deja margen y sigue siendo constante.
    for (const size of maxSizes) expect(size).toBeLessThanOrEqual(20);
  });
});
