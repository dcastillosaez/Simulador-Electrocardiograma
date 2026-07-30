import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

describe("Icon", () => {
  it("es decorativo por defecto: oculto para lectores de pantalla", () => {
    // Un icono junto a un texto que ya dice lo mismo solo anade ruido al
    // lector de pantalla. Solo se nombra si es la unica informacion.
    const { container } = render(<Icon name="play" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("con label pasa a ser una imagen accesible", () => {
    render(<Icon name="warning" label="Advertencia" />);
    expect(screen.getByRole("img", { name: "Advertencia" })).toBeInTheDocument();
  });

  it("dibuja algo para todos los nombres declarados", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector("path"), name).toBeTruthy();
      unmount();
    }
  });
});

describe("Tooltip", () => {
  it("no muestra el contenido hasta que hay hover", async () => {
    render(
      <Tooltip content="Altura insuficiente">
        <button type="button">Estado</button>
      </Tooltip>
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole("button", { name: "Estado" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Altura insuficiente");
  });

  it("tambien aparece con el foco de teclado", async () => {
    // Un tooltip que solo responde al raton deja fuera a quien navega con
    // teclado, que es justo quien mas necesita la explicacion.
    render(
      <Tooltip content="Explicacion">
        <button type="button">Estado</button>
      </Tooltip>
    );

    await userEvent.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("describe al hijo mediante aria-describedby", async () => {
    render(
      <Tooltip content="Explicacion">
        <button type="button">Estado</button>
      </Tooltip>
    );

    await userEvent.hover(screen.getByRole("button"));
    const describedBy = screen.getByRole("button").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByRole("tooltip")).toHaveAttribute("id", describedBy!);
  });
});
