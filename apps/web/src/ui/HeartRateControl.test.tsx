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
    expect(screen.getByRole("spinbutton", { name: "Frecuencia" })).toHaveValue(70);
  });

  it("se puede teclear la frecuencia en vez de subirla de cinco en cinco", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 1.6667 }} valueHz={70 / 60} onChange={onChange} />
    );

    const field = screen.getByRole("spinbutton", { name: "Frecuencia" });
    await userEvent.clear(field);
    await userEvent.type(field, "83{Enter}");

    // 83 no es multiplo de 5: el campo acepta cualquier entero del rango,
    // que es justo lo que los botones solos no permitian.
    expect(onChange).toHaveBeenCalledWith(83 / 60);
  });

  it("+5 sube la frecuencia en 5 lpm", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 1.6667 }} valueHz={70 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Subir frecuencia"));

    expect(onChange).toHaveBeenCalledWith(75 / 60);
  });

  it("el boton se deshabilita al alcanzar el maximo, en vez de no hacer nada", async () => {
    // Antes el boton seguia pulsable y reemitia el mismo valor. Deshabilitarlo
    // dice la verdad: ahi ya no se puede subir mas.
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 100 / 60 }} valueHz={100 / 60} onChange={onChange} />
    );

    const up = screen.getByLabelText("Subir frecuencia");
    expect(up).toBeDisabled();
    await userEvent.click(up);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("el boton se deshabilita al alcanzar el minimo", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 60 / 60, maximum: 1.6667 }} valueHz={60 / 60} onChange={onChange} />
    );

    const down = screen.getByLabelText("Bajar frecuencia");
    expect(down).toBeDisabled();
    await userEvent.click(down);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("acota al rango una frecuencia tecleada fuera de el", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 100 / 60 }} valueHz={70 / 60} onChange={onChange} />
    );

    const field = screen.getByRole("spinbutton", { name: "Frecuencia" });
    await userEvent.clear(field);
    await userEvent.type(field, "300{Enter}");

    expect(onChange).toHaveBeenCalledWith(100 / 60);
  });

  it("un ritmo de frecuencia fija no ofrece control alguno", () => {
    // p.ej. flutter auricular, taquicardia/fibrilacion ventricular: el
    // motor documenta que un control que no hace nada no debe ser
    // pulsable, para no confundir al usuario haciendole creer que ajusto
    // algo cuando el motor ignora el cambio.
    render(
      <HeartRateControl range={{ minimum: 3.0, maximum: 3.0 }} valueHz={3.0} onChange={vi.fn()} />
    );

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("180 lpm (fija)")).toBeInTheDocument();
  });
});
