import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AxisControl } from "./AxisControl";

function setup(valueDeg = 50) {
  const onChange = vi.fn();
  render(
    <AxisControl valueDeg={valueDeg} min={-180} max={180} referenceDeg={50} onChange={onChange} />
  );
  return { onChange, slider: screen.getByRole("slider") };
}

describe("AxisControl", () => {
  it("expone los valores ARIA del eje, con ángulo y zona en el valuetext", () => {
    const { slider } = setup(50);
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuemin", "-180");
    expect(slider).toHaveAttribute("aria-valuemax", "180");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/50°/);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/normal/i);
  });

  it("las flechas mueven 5° en cada sentido", () => {
    const { onChange, slider } = setup(50);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(45);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it("Home vuelve a la orientación de referencia", () => {
    const { onChange, slider } = setup(-40);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it("no rebasa los límites", () => {
    const { onChange, slider } = setup(180);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(180);
  });

  it("el stepper +5 / −5 llama a onChange", () => {
    const { onChange } = setup(50);
    fireEvent.click(screen.getByRole("button", { name: /aumentar/i }));
    expect(onChange).toHaveBeenLastCalledWith(55);
    fireEvent.click(screen.getByRole("button", { name: /disminuir/i }));
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it("anuncia la zona clínica bajo el disco", () => {
    setup(-60);
    expect(screen.getByText(/desviación izquierda/i)).toBeInTheDocument();
  });
});
