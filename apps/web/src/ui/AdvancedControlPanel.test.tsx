import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import type { NoiseParamsPayload } from "../types/engine-params";

const noise: NoiseParamsPayload = {
  emg_v: 0.02, mains_v: 0.01, baseline_v: 0.05, motion_v: 0.0, clip_v: null,
};

describe("AdvancedControlPanel", () => {
  it("renderiza los cinco sliders con sus valores iniciales", () => {
    render(<AdvancedControlPanel noise={noise} onChange={vi.fn()} onSwitchToBasic={vi.fn()} />);

    expect(screen.getByLabelText("EMG")).toHaveValue("0.02");
    expect(screen.getByLabelText("Interferencia 50Hz")).toHaveValue("0.01");
    expect(screen.getByLabelText("Línea base")).toHaveValue("0.05");
    expect(screen.getByLabelText("Movimiento")).toHaveValue("0");
    expect(screen.getByLabelText("Saturación")).toHaveValue("0");
  });

  it("mover un slider llama a onChange conservando el resto de campos", () => {
    const onChange = vi.fn();
    render(<AdvancedControlPanel noise={noise} onChange={onChange} onSwitchToBasic={vi.fn()} />);

    fireEventChange(screen.getByLabelText("EMG"), "0.08");

    expect(onChange).toHaveBeenCalledWith({ ...noise, emg_v: 0.08 });
  });

  it("el slider de Saturacion al minimo llama a onChange con clip_v: null, no 0", () => {
    // clip_v recorta la senal a [-clip_v, clip_v] (noise.py): clip_v=0
    // aplana el trazo entero a una linea recta. El extremo izquierdo del
    // slider debe significar "sin saturacion" (null), no "recortar a
    // amplitud cero".
    const onChange = vi.fn();
    const noiseWithClip: NoiseParamsPayload = { ...noise, clip_v: 0.002 };
    render(
      <AdvancedControlPanel noise={noiseWithClip} onChange={onChange} onSwitchToBasic={vi.fn()} />
    );

    fireEventChange(screen.getByLabelText("Saturación"), "0");

    expect(onChange).toHaveBeenCalledWith({ ...noiseWithClip, clip_v: null });
  });

  it("mover el slider de Saturacion a un valor positivo lo aplica tal cual", () => {
    const onChange = vi.fn();
    render(<AdvancedControlPanel noise={noise} onChange={onChange} onSwitchToBasic={vi.fn()} />);

    fireEventChange(screen.getByLabelText("Saturación"), "0.002");

    expect(onChange).toHaveBeenCalledWith({ ...noise, clip_v: 0.002 });
  });

  it("volver a modo basico llama a onSwitchToBasic", async () => {
    const onSwitchToBasic = vi.fn();
    render(<AdvancedControlPanel noise={noise} onChange={vi.fn()} onSwitchToBasic={onSwitchToBasic} />);

    await userEvent.click(screen.getByRole("button", { name: "Volver a modo básico" }));

    expect(onSwitchToBasic).toHaveBeenCalled();
  });
});

// `userEvent` no simula bien los sliders de rango en jsdom; se dispara el
// evento `change` directamente, que es lo que React escucha en un
// `<input type="range">`.
function fireEventChange(element: HTMLElement, value: string): void {
  const input = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
