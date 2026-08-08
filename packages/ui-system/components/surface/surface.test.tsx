import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlGroup, Divider, Panel, Section, SectionTitle } from "./index";

describe("Panel", () => {
  it("acepta una clase extra sin perder la propia", () => {
    // El layout necesita colocar el panel en su area de grid sin que el panel
    // sepa nada del layout.
    const { container } = render(<Panel className="externa">contenido</Panel>);
    const panel = container.firstElementChild!;
    expect(panel.className).toContain("externa");
    expect(panel.className.split(" ").length).toBeGreaterThan(1);
  });
});

describe("SectionTitle", () => {
  it("es una cabecera real, no un div con estilo", () => {
    render(<SectionTitle>Paciente</SectionTitle>);
    expect(screen.getByRole("heading", { name: "Paciente" })).toBeInTheDocument();
  });
});

describe("Section", () => {
  it("es una region con nombre, no un div con fondo", () => {
    // Lo que separa a la vista tiene que separar tambien para quien navega por
    // regiones: si no, el panel sigue siendo una lista larga de numeros para la
    // mitad de sus usuarios.
    render(
      <Section title="Constantes">
        <p>contenido</p>
      </Section>
    );
    expect(screen.getByRole("region", { name: "Constantes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Constantes" })).toBeInTheDocument();
  });
});

describe("Divider", () => {
  it("se anuncia como separador", () => {
    render(<Divider />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});

describe("ControlGroup", () => {
  it("agrupa los controles con un nombre accesible", () => {
    // fieldset + legend en vez de div + span: asi el lector de pantalla anuncia
    // "Calidad de senal" al entrar en el grupo.
    render(
      <ControlGroup label="Calidad de señal">
        <button type="button">Perfecta</button>
      </ControlGroup>
    );
    expect(screen.getByRole("group", { name: "Calidad de señal" })).toBeInTheDocument();
  });
});
