import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton, Select, SegmentedControl, Slider, Stepper } from "./index";

describe("SegmentedControl", () => {
  const OPTIONS = [
    { value: "1", label: "1" },
    { value: "3", label: "3" },
    { value: "6", label: "6" },
    { value: "12", label: "12" },
  ];

  it("es un radiogroup con el nombre que se le pasa", () => {
    // El LayoutPicker actual usa role=radiogroup + aria-label="Derivaciones
    // visibles", y un test existente depende de ese nombre exacto.
    render(
      <SegmentedControl label="Derivaciones visibles" value="6" options={OPTIONS} onChange={vi.fn()} />
    );
    expect(
      screen.getByRole("radiogroup", { name: "Derivaciones visibles" })
    ).toBeInTheDocument();
  });

  it("marca la opcion activa y solo esa", () => {
    render(
      <SegmentedControl label="Derivaciones visibles" value="6" options={OPTIONS} onChange={vi.fn()} />
    );
    expect(screen.getByRole("radio", { name: "6" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "12" })).not.toBeChecked();
  });

  it("avisa del valor nuevo al pulsar otra opcion", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Derivaciones visibles" value="6" options={OPTIONS} onChange={onChange} />
    );

    await userEvent.click(screen.getByRole("radio", { name: "12" }));

    expect(onChange).toHaveBeenCalledWith("12");
  });
});

describe("Slider", () => {
  it("expone el nombre que se le pasa, no uno inventado", () => {
    // Los sliders de ruido dependen de estos nombres exactos: "EMG",
    // "Interferencia 50Hz", "Linea base", "Movimiento", "Saturacion".
    render(
      <Slider label="EMG" value={0} min={0} max={1} step={0.01} onChange={vi.fn()} />
    );
    expect(screen.getByRole("slider", { name: "EMG" })).toBeInTheDocument();
  });

  it("propaga el valor como numero, no como el texto del input", () => {
    // El valor de un input siempre llega como string. Sin el Number() del
    // componente, el motor recibiria "4" y los parametros de ruido viajarian
    // como texto al backend. `fireEvent` y no `userEvent`: arrastrar un
    // input[type=range] no es algo que userEvent sepa simular.
    const onChange = vi.fn();
    render(<Slider label="EMG" value={0} min={0} max={10} step={1} onChange={onChange} />);

    fireEvent.change(screen.getByRole("slider", { name: "EMG" }), {
      target: { value: "4" },
    });

    expect(onChange).toHaveBeenCalledWith(4);
  });
});

describe("Stepper", () => {
  it("cada boton tiene su propio nombre accesible", () => {
    render(
      <Stepper
        label="Frecuencia"
        value="72 lpm"
        decrementLabel="Bajar frecuencia"
        incrementLabel="Subir frecuencia"
        onDecrement={vi.fn()}
        onIncrement={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Bajar frecuencia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir frecuencia" })).toBeInTheDocument();
  });

  it("deshabilitado no llama a nadie", async () => {
    const onIncrement = vi.fn();
    render(
      <Stepper
        label="Frecuencia"
        value="150 lpm (fija)"
        disabled
        decrementLabel="Bajar frecuencia"
        incrementLabel="Subir frecuencia"
        onDecrement={vi.fn()}
        onIncrement={onIncrement}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Subir frecuencia" }));

    expect(onIncrement).not.toHaveBeenCalled();
  });

  it("el valor se anuncia en vivo", () => {
    render(
      <Stepper
        label="Frecuencia"
        value="72 lpm"
        decrementLabel="Bajar frecuencia"
        incrementLabel="Subir frecuencia"
        onDecrement={vi.fn()}
        onIncrement={vi.fn()}
      />
    );
    expect(screen.getByText("72 lpm").closest("[aria-live]")).not.toBeNull();
  });
});

describe("Select", () => {
  it("expone el nombre que se le pasa", () => {
    render(
      <Select
        label="Calidad de señal"
        value="perfecta"
        options={[{ value: "perfecta", label: "Perfecta" }]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Calidad de señal")).toBeInTheDocument();
  });

  it("con placeholder aparece una opcion inicial deshabilitada", () => {
    render(
      <Select
        label="Seleccionar ritmo"
        value=""
        placeholder="Selecciona un ritmo"
        options={[{ value: "sinus_normal", label: "Ritmo sinusal normal" }]}
        onChange={vi.fn()}
      />
    );
    const placeholder = screen.getByRole("option", { name: "Selecciona un ritmo" });
    expect(placeholder).toBeDisabled();
  });

  it("avisa del valor elegido", async () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Seleccionar ritmo"
        value=""
        placeholder="Selecciona un ritmo"
        options={[{ value: "sinus_normal", label: "Ritmo sinusal normal" }]}
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");

    expect(onChange).toHaveBeenCalledWith("sinus_normal");
  });
});

describe("IconButton", () => {
  it("su texto es su nombre accesible", () => {
    // Siempre lleva texto, nunca solo el icono: un icono suelto obliga a
    // adivinar, y en una consola clinica adivinar es lo que no debe pasar.
    render(<IconButton icon="pause" label="Congelar" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Congelar" })).toBeInTheDocument();
  });

  it("un boton sin estado sostenido no se anuncia como pulsable", () => {
    // aria-pressed en un boton de accion simple hace que el lector anuncie
    // "no pulsado" en algo que no tiene dos estados.
    render(<IconButton icon="download" label="Exportar" onClick={vi.fn()} />);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");
  });

  it("un boton activo lo declara, no solo lo colorea", () => {
    render(<IconButton icon="stop" label="Grabando" onClick={vi.fn()} active />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("deshabilitado no llama a nadie", async () => {
    const onClick = vi.fn();
    render(<IconButton icon="pause" label="Congelar" onClick={onClick} disabled />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
