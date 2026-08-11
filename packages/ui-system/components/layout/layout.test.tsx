import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell, Header, Inspector, Sidebar, SplitPane, StatusBar } from "./index";

describe("AppShell", () => {
  it("coloca las cinco zonas y las anuncia con landmarks distintos", () => {
    render(
      <AppShell
        header={<Header title="Simulador ECG" />}
        sidebar={<Sidebar>escenario</Sidebar>}
        ecg={<div>trazado</div>}
        inspector={<Inspector>medidas</Inspector>}
        status={<StatusBar>estado</StatusBar>}
      />
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    // El panel de escenario y el inspector son ambos `complementary`, asi que
    // se distinguen por nombre: sin eso, un lector de pantalla lee "region"
    // dos veces y no hay forma de saber en cual estas.
    expect(screen.getByRole("complementary", { name: "Escenario" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("trazado");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("estado");
  });

  it("el area de ECG es el main: es el contenido, no un adorno", () => {
    render(
      <AppShell
        header={<Header title="x" />}
        sidebar={<Sidebar>a</Sidebar>}
        ecg={<div data-testid="trazado" />}
        inspector={<Inspector>b</Inspector>}
        status={<StatusBar>c</StatusBar>}
      />
    );
    expect(screen.getByRole("main")).toContainElement(screen.getByTestId("trazado"));
  });
});

describe("Header", () => {
  it("muestra el titulo y lo que se le cuelgue", () => {
    render(<Header title="Simulador ECG">
      <span>extra</span>
    </Header>);
    expect(screen.getByText("Simulador ECG")).toBeInTheDocument();
    expect(screen.getByText("extra")).toBeInTheDocument();
  });
});

describe("SplitPane", () => {
  it("pinta las dos zonas", () => {
    render(<SplitPane top={<p>arriba</p>} bottom={<p>abajo</p>} label="ECG y corazón" />);

    expect(screen.getByText("arriba")).toBeInTheDocument();
    expect(screen.getByText("abajo")).toBeInTheDocument();
  });

  it("el divisor se anuncia como separador con nombre", () => {
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);

    const separator = screen.getByRole("separator", { name: "ECG y corazón" });
    expect(separator).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("el divisor es alcanzable con el teclado", () => {
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);

    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");
  });

  it("la flecha abajo da más espacio al ECG", async () => {
    const user = userEvent.setup();
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);
    const separator = screen.getByRole("separator");
    const antes = Number(separator.getAttribute("aria-valuenow"));

    separator.focus();
    await user.keyboard("{ArrowDown}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(antes);
  });

  it("la flecha arriba da más espacio al corazón", async () => {
    const user = userEvent.setup();
    render(<SplitPane top={<p>a</p>} bottom={<p>b</p>} label="ECG y corazón" />);
    const separator = screen.getByRole("separator");
    const antes = Number(separator.getAttribute("aria-valuenow"));

    separator.focus();
    await user.keyboard("{ArrowUp}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeLessThan(antes);
  });

  it("no baja del mínimo por mucho que se insista", async () => {
    const user = userEvent.setup();
    render(
      <SplitPane
        top={<p>a</p>}
        bottom={<p>b</p>}
        label="ECG y corazón"
        minTopFraction={0.3}
      />
    );
    const separator = screen.getByRole("separator");

    separator.focus();
    await user.keyboard("{ArrowUp>20/}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(30);
  });

  it("no sube del máximo", async () => {
    const user = userEvent.setup();
    render(
      <SplitPane
        top={<p>a</p>}
        bottom={<p>b</p>}
        label="ECG y corazón"
        maxTopFraction={0.85}
      />
    );
    const separator = screen.getByRole("separator");

    separator.focus();
    await user.keyboard("{ArrowDown>20/}");

    expect(Number(separator.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(85);
  });

  it("arranca en la fracción pedida", () => {
    render(
      <SplitPane
        top={<p>a</p>}
        bottom={<p>b</p>}
        label="ECG y corazón"
        defaultTopFraction={0.7}
      />
    );

    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "70");
  });
});
