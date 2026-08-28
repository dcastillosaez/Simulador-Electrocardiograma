import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BasicControlPanel } from "./BasicControlPanel";
import { NOISE_PRESETS } from "./noise-presets";

describe("BasicControlPanel", () => {
  it("muestra el preset actual segun el ruido vigente", () => {
    render(
      <BasicControlPanel
        heartRateHz={70 / 60}
        heartRateRange={{ minimum: 1.0, maximum: 1.6667 }}
        rhythmParameters={{}}
        rhythmValues={{}}
        onRhythmParameterChange={vi.fn()}
        noise={NOISE_PRESETS.buena}
        onHeartRateChange={vi.fn()}
        onNoiseChange={vi.fn()}
        onSwitchToAdvanced={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Calidad de señal")).toHaveValue("buena");
  });

  it("cambiar de preset llama a onNoiseChange con los valores del preset", async () => {
    const onNoiseChange = vi.fn();
    render(
      <BasicControlPanel
        heartRateHz={70 / 60}
        heartRateRange={{ minimum: 1.0, maximum: 1.6667 }}
        rhythmParameters={{}}
        rhythmValues={{}}
        onRhythmParameterChange={vi.fn()}
        noise={NOISE_PRESETS.perfecta}
        onHeartRateChange={vi.fn()}
        onNoiseChange={onNoiseChange}
        onSwitchToAdvanced={vi.fn()}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Calidad de señal"), "urgencias");

    expect(onNoiseChange).toHaveBeenCalledWith(NOISE_PRESETS.urgencias);
  });

  it("elegir 'Personalizada' cambia a modo avanzado en vez de aplicar un preset", async () => {
    const onSwitchToAdvanced = vi.fn();
    const onNoiseChange = vi.fn();
    render(
      <BasicControlPanel
        heartRateHz={70 / 60}
        heartRateRange={{ minimum: 1.0, maximum: 1.6667 }}
        rhythmParameters={{}}
        rhythmValues={{}}
        onRhythmParameterChange={vi.fn()}
        noise={NOISE_PRESETS.perfecta}
        onHeartRateChange={vi.fn()}
        onNoiseChange={onNoiseChange}
        onSwitchToAdvanced={onSwitchToAdvanced}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Calidad de señal"), "personalizada");

    expect(onSwitchToAdvanced).toHaveBeenCalled();
    expect(onNoiseChange).not.toHaveBeenCalled();
  });
});
