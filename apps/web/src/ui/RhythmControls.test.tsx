import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RhythmControls } from "./RhythmControls";
import type { ParameterRange } from "../types/rhythms";

const FLUTTER: Record<string, ParameterRange> = {
  atrial_rate_hz: { minimum: 250 / 60, maximum: 350 / 60, default: 5 },
  conduction_ratio: { minimum: 2, maximum: 4, default: 2 },
};

function setup(
  ranges = FLUTTER,
  values: Record<string, number> = { atrial_rate_hz: 5, conduction_ratio: 2 },
  pulseBpm: number | null = 150
) {
  const onChange = vi.fn();
  render(
    <RhythmControls
      ranges={ranges}
      values={values}
      onChange={onChange}
      pulseBpm={pulseBpm}
    />
  );
  return { onChange, user: userEvent.setup() };
}

describe("los mandos propios de un ritmo", () => {
  it("enseña la aurícula en latidos por minuto, no en hercios", () => {
    // El motor trabaja en SI y una frecuencia se piensa en lpm. Si la
    // conversion no ocurriera aqui, el flutter se ofreceria como «5».
    setup();
    expect(screen.getByRole("spinbutton", { name: "Frecuencia auricular" })).toHaveValue(
      300
    );
  });

  it("escribe el grado de bloqueo como se escribe en un informe", () => {
    setup();
    const select = screen.getByLabelText("Conducción AV");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "2:1",
      "3:1",
      "4:1",
    ]);
  });

  it("devuelve la frecuencia al motor en hercios", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByLabelText("Subir frecuencia auricular"));
    const [name, value] = onChange.mock.calls.at(-1) as [string, number];
    expect(name).toBe("atrial_rate_hz");
    expect(value * 60).toBeCloseTo(305, 0);
  });

  it("el grado de bloqueo viaja como número, no como texto", async () => {
    const { onChange, user } = setup();
    await user.selectOptions(screen.getByLabelText("Conducción AV"), "3");
    expect(onChange).toHaveBeenCalledWith("conduction_ratio", 3);
  });

  it("enseña el pulso como consecuencia, no como control", () => {
    // Un flutter a 300 con 2:1 son 150 lpm, y ese numero no se escribe: sale
    // de dividir. Ofrecerlo como campo editable seria la mentira que este
    // panel viene a corregir.
    setup();
    expect(screen.getByText(/Pulso:/)).toHaveTextContent("150 lpm");
    expect(screen.queryByRole("spinbutton", { name: /Pulso/ })).not.toBeInTheDocument();
  });

  it("respeta los limites que publica el catalogo", () => {
    setup();
    const atrial = screen.getByRole("spinbutton", { name: "Frecuencia auricular" });
    expect(atrial).toHaveAttribute("min", "250");
    expect(atrial).toHaveAttribute("max", "350");
  });

  it("ignora un mando que esta version no sabe pintar", () => {
    // Mejor un control de menos que una caja sin nombre ni unidades.
    setup(
      { ...FLUTTER, algo_futuro: { minimum: 0, maximum: 1, default: 0 } },
      { atrial_rate_hz: 5, conduction_ratio: 2, algo_futuro: 0 }
    );
    expect(screen.queryByText("algo_futuro")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Conducción AV")).toBeInTheDocument();
  });

  it("distingue un escape de la union de uno ventricular", () => {
    setup(
      { escape_rate_hz: { minimum: 20 / 60, maximum: 45 / 60, default: 40 / 60 } },
      { escape_rate_hz: 25 / 60 },
      25
    );
    expect(screen.getByText(/ventricular: lento e inestable/i)).toBeInTheDocument();
  });
});
