import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConductionCard } from "./ConductionCard";
import { structureCentroid } from "./FollowStructure";
import { CONDUCTION_DATA, CONDUCTION_STRUCTURES } from "./conduction-structures";
import { reviewSnapshotLines } from "../../review/useReview";
import { PlaybackClock } from "../../../cardiac/playback-clock";
import { ElectricalTimeline } from "../../../cardiac/electrical-timeline";

describe("ConductionCard", () => {
  it("declara el esquema didáctico donde lo es", () => {
    render(<ConductionCard structure="purkinje" />);
    expect(screen.getByRole("note")).toHaveTextContent(/Esquema didáctico/);
  });

  it("no lo declara en una estructura situada por la geometría", () => {
    render(<ConductionCard structure="his_bundle" />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("ofrece seguir la estructura con la cámara", () => {
    const toggle = vi.fn();
    render(<ConductionCard structure="av_node" following={false} onToggleFollow={toggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Seguir con la cámara" }));
    expect(toggle).toHaveBeenCalled();
  });
});

describe("structureCentroid", () => {
  it("cae dentro del recorrido de cada estructura", () => {
    for (const structure of CONDUCTION_STRUCTURES) {
      const centre = structureCentroid(structure);
      const points = CONDUCTION_DATA.structures[structure].paths.flatMap((p) => p.points);
      for (let axis = 0; axis < 3; axis += 1) {
        const values = points.map((p) => p[axis]);
        expect(centre[axis]).toBeGreaterThanOrEqual(Math.min(...values));
        expect(centre[axis]).toBeLessThanOrEqual(Math.max(...values));
      }
    }
  });
});

describe("reviewSnapshotLines", () => {
  it("en directo no añade nada; en repaso, el instante y la fase", () => {
    const clock = new PlaybackClock({ playbackTimeS: 5 });
    const electrical = new ElectricalTimeline();
    electrical.push([
      {
        impulse: 0,
        origin: "sinus",
        outcome: "conducted",
        segments: [{ structure: "ventricular_myocardium", t_start_s: 1, t_end_s: 1.09 }],
      },
    ]);
    expect(reviewSnapshotLines(clock, electrical)).toEqual([]);
    clock.reviewTimeS = 1.05;
    expect(reviewSnapshotLines(clock, electrical)).toEqual([
      "Corazón en t = 1,050 s",
      "QRS: activación de los ventrículos",
    ]);
  });
});
