import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell, Header, Inspector, Sidebar, StatusBar } from "./index";

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
