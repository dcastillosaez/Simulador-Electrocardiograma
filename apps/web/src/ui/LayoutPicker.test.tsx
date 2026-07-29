import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayoutPicker } from "./LayoutPicker";

describe("LayoutPicker", () => {
  it("muestra las cuatro opciones de layout", () => {
    render(<LayoutPicker value="6" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Derivaciones visibles" });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(4);
  });

  it("marca la opcion activa segun value", () => {
    render(<LayoutPicker value="3" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "3" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "12" })).not.toBeChecked();
  });

  it("llama a onChange con el layout elegido", async () => {
    const onChange = vi.fn();
    render(<LayoutPicker value="6" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "12" }));

    expect(onChange).toHaveBeenCalledWith("12");
  });
});
