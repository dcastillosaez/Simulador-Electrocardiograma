import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ladderOf } from "./ladder";
import { ElectricalTimeline } from "./electrical-timeline";
import { PlaybackClock } from "./playback-clock";
import { LadderPanel } from "../ui/ladder/LadderPanel";
import type { ElectricalImpulsePayload } from "../types/ws-messages";

const conducted: ElectricalImpulsePayload = {
  impulse: 0,
  origin: "sinus",
  outcome: "conducted",
  segments: [
    { structure: "sa_node", t_start_s: 1, t_end_s: 1 },
    { structure: "right_atrium", t_start_s: 1, t_end_s: 1.1 },
    { structure: "av_node", t_start_s: 1.1, t_end_s: 1.13 },
    { structure: "his_bundle", t_start_s: 1.13, t_end_s: 1.15 },
    { structure: "ventricular_myocardium", t_start_s: 1.175, t_end_s: 1.265 },
  ],
};
const blocked: ElectricalImpulsePayload = {
  impulse: 1,
  origin: "sinus",
  outcome: "blocked",
  segments: [
    { structure: "right_atrium", t_start_s: 2, t_end_s: 2.1 },
    { structure: "av_node", t_start_s: 2.1, t_end_s: 2.1 },
  ],
};

describe("ladderOf", () => {
  it("un impulso conducido baja por las tres filas; uno bloqueado se queda en la unión", () => {
    const diagram = ladderOf([conducted, blocked], 0.5, 3);
    const rows = (i: number) =>
      diagram.bars.filter((b) => b.startS >= i - 0.5 && b.startS < i + 0.5).map((b) => b.row);
    expect(rows(0.5 + 0.1)).toEqual(["A", "AV", "V"]);
    const last = diagram.bars.filter((b) => b.blocked);
    expect(last.map((b) => b.row)).toEqual(["A", "AV"]);
    const av = diagram.bars.find((b) => b.row === "AV" && !b.blocked)!;
    expect(av.startS).toBeCloseTo(0.6);
    expect(av.endS).toBeCloseTo(0.65);
  });

  it("recorta a la ventana y no inventa nada fuera", () => {
    expect(ladderOf([conducted], 5, 9).bars).toEqual([]);
  });
});

describe("LadderPanel", () => {
  it("fija un diagrama para compararlo con el siguiente", () => {
    vi.useFakeTimers();
    const timeline = new ElectricalTimeline();
    timeline.push([conducted, blocked]);
    const clock = new PlaybackClock({ playbackTimeS: 3 });
    const { rerender } = render(
      <LadderPanel electrical={{ current: timeline }} clock={clock} label="Mobitz I" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Fijar para comparar" }));
    rerender(<LadderPanel electrical={{ current: timeline }} clock={clock} label="Sinusal" />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("img", { name: /Fijado: Mobitz I/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Ahora: Sinusal/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar la comparación" }));
    expect(screen.queryByRole("img", { name: /Fijado/ })).toBeNull();
    vi.useRealTimers();
  });
});
