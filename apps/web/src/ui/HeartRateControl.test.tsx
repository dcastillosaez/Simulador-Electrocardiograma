import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeartRateControl } from "./HeartRateControl";

describe("HeartRateControl", () => {
  it("muestra la frecuencia en lpm", () => {
    render(
      <HeartRateControl
        range={{ minimum: 1.0, maximum: 1.6667 }}
        valueHz={70 / 60}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("70 lpm")).toBeInTheDocument();
  });

  it("+5 sube la frecuencia en 5 lpm", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 1.6667 }} valueHz={70 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Subir frecuencia"));

    expect(onChange).toHaveBeenCalledWith(75 / 60);
  });

  it("no supera el maximo del rango", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 100 / 60 }} valueHz={100 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Subir frecuencia"));

    expect(onChange).toHaveBeenCalledWith(100 / 60);
  });

  it("no baja del minimo del rango", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 60 / 60, maximum: 1.6667 }} valueHz={60 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Bajar frecuencia"));

    expect(onChange).toHaveBeenCalledWith(60 / 60);
  });

  it("deshabilita los botones cuando el ritmo tiene frecuencia fija (minimum===maximum)", async () => {
    // p.ej. flutter auricular, taquicardia/fibrilacion ventricular: el
    // motor documenta que un control que no hace nada no debe ser
    // pulsable, para no confundir al usuario haciendole creer que ajusto
    // algo cuando el motor ignora el cambio.
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 3.0, maximum: 3.0 }} valueHz={3.0} onChange={onChange} />
    );

    expect(screen.getByLabelText("Bajar frecuencia")).toBeDisabled();
    expect(screen.getByLabelText("Subir frecuencia")).toBeDisabled();

    await userEvent.click(screen.getByLabelText("Subir frecuencia"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
