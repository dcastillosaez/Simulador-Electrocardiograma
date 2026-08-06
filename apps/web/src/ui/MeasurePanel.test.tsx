import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSession, apply } from "../measure/session";
import { MeasurePanel } from "./MeasurePanel";
import type { MeasurePoint } from "../measure/tools";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

function point(sampleIndex: number, mv: number): MeasurePoint {
  return {
    ringPos: sampleIndex,
    sampleIndex,
    timestampS: sampleIndex / 500,
    voltageV: mv / 1000,
    lead: "II",
  };
}

function sessionWithCaliper() {
  let s = createSession("caliper");
  s = apply(s, { type: "place", point: point(1000, 0) }, CTX);
  return apply(s, { type: "place", point: point(1082, 1.21) }, CTX);
}

function renderPanel(session = createSession("caliper")) {
  const onTool = vi.fn();
  const onSnap = vi.fn();
  render(
    <MeasurePanel session={session} onToolChange={onTool} onSnapChange={onSnap} />
  );
  return { onTool, onSnap };
}

describe("MeasurePanel", () => {
  it("sin medida, invita a medir en vez de mostrar ceros", () => {
    renderPanel();
    expect(screen.getByText(/marca dos puntos/i)).toBeInTheDocument();
  });

  it("publica el resultado del calibrador en el DOM", () => {
    // Es la unica via por la que la medida llega a un lector de pantalla: lo
    // dibujado en canvas no existe para el.
    renderPanel(sessionWithCaliper());

    expect(screen.getByText("164 ms")).toBeInTheDocument();
    expect(screen.getByText("+1.21 mV")).toBeInTheDocument();
    expect(screen.getByText("366 lpm")).toBeInTheDocument();
    expect(screen.getByText("4.1")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
  });

  it("el resultado se anuncia como estado", () => {
    renderPanel(sessionWithCaliper());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("permite cambiar de herramienta", async () => {
    const user = userEvent.setup();
    const { onTool } = renderPanel();

    await user.click(screen.getByRole("radio", { name: "RR" }));

    expect(onTool).toHaveBeenCalledWith("rr");
  });

  it("permite cambiar el modo de enganche", async () => {
    const user = userEvent.setup();
    const { onSnap } = renderPanel();

    await user.click(screen.getByRole("radio", { name: /rejilla/i }));

    expect(onSnap).toHaveBeenCalledWith("grid");
  });
});
