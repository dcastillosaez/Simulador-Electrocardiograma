import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getTheme } from "@ui-system/themes/index";
import { computeLayoutMetrics } from "../render/layout-engine";
import { PX_PER_MM } from "../render/grid-layer";
import { SampleIndexRing } from "../render/sample-index";
import { SweepBuffer } from "../render/sweep-buffer";
import { MeasureOverlay } from "./MeasureOverlay";
import type { LeadName } from "../render/layout";

const CAPACITY = 1000;
const SAMPLE_RATE_HZ = 500;

const METRICS = computeLayoutMetrics({
  availableWidthPx: 10 * 25 * PX_PER_MM,
  availableHeightPx: 600,
  rowCount: 1,
  columnCount: 1,
  gain: 10,
  paperSpeedMmS: 25,
});

function makeSource() {
  const sweep = new SweepBuffer(CAPACITY);
  const samples = new Float32Array(CAPACITY);
  samples[500] = 0.0012;
  sweep.push(samples);

  const indexRing = new SampleIndexRing(CAPACITY);
  const indices = new Float64Array(CAPACITY);
  for (let i = 0; i < CAPACITY; i++) indices[i] = i;
  indexRing.push(indices);

  return {
    sweeps: new Map<LeadName, SweepBuffer>([["II", sweep]]),
    indexRing,
    capacity: CAPACITY,
  };
}

function renderOverlay(active = true) {
  const onResult = vi.fn();
  render(
    <MeasureOverlay
      active={active}
      layout={{ leadColumns: [["II"]], metrics: METRICS }}
      sampleRateHz={SAMPLE_RATE_HZ}
      paperSpeedMmS={25}
      theme={getTheme("dark").ecg}
      getSource={makeSource}
      view={{ startRingPos: 0, visibleSamples: CAPACITY }}
      magnifier={false}
      onResultChange={onResult}
    />
  );
  return onResult;
}

describe("MeasureOverlay", () => {
  beforeEach(() => {
    // jsdom no implementa el contexto 2D de Canvas: sin el stub, cada tick
    // del bucle de dibujo escupe un error a stderr aunque el test pase.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          fillText: vi.fn(),
          setLineDash: vi.fn(),
        }) as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no es interactivo mientras el trazado corre", () => {
    renderOverlay(false);
    expect(screen.queryByRole("application")).toBeNull();
  });

  it("congelado expone una superficie enfocable con nombre", () => {
    renderOverlay();
    expect(
      screen.getByRole("application", { name: /medición sobre el trazado/i })
    ).toBeInTheDocument();
  });

  it("colocar dos marcas con el teclado produce un resultado", async () => {
    const user = userEvent.setup();
    const onResult = renderOverlay();
    const surface = screen.getByRole("application");

    surface.focus();
    // El primer Enter materializa el cursor (que aun no existe: no ha habido
    // movimiento de raton); el segundo ya coloca la primera marca.
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowRight>82/}");
    await user.keyboard("{Enter}");

    expect(onResult).toHaveBeenCalled();
    const last = onResult.mock.calls.at(-1)![0];
    expect(last.result.kind).toBe("caliper");
    expect(last.result.readout.deltaMs).toBeCloseTo(164, 6);
  });

  it("Escape limpia la medida", async () => {
    const user = userEvent.setup();
    const onResult = renderOverlay();
    const surface = screen.getByRole("application");

    surface.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect(onResult.mock.calls.at(-1)![0].result).toBeNull();
  });
});
