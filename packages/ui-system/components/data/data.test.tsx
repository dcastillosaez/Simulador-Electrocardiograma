import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Metric, MetricGrid } from "./index";

describe("Metric", () => {
  it("muestra etiqueta, valor y unidad", () => {
    render(<Metric label="FC" value="72" unit="lpm" />);
    expect(screen.getByText("FC")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("lpm")).toBeInTheDocument();
  });

  it("una metrica no disponible lo dice, no finge un valor", () => {
    // Es el caso de PR/QRS/QT hasta la Entrega 2: el motor los calcula pero la
    // API no los expone. Mostrar un guion sin explicacion haria pensar en un
    // fallo de medida en vez de en una funcion que aun no existe.
    render(<Metric label="PR" value="" unavailable />);
    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("—")).toHaveAttribute("aria-label", "no disponible");
  });

  it("el valor se anuncia en vivo para que un cambio se oiga", () => {
    render(<Metric label="FC" value="72" unit="lpm" />);
    expect(screen.getByText("72").closest("[aria-live]")).not.toBeNull();
  });
});

describe("MetricGrid", () => {
  it("expone las metricas como una lista", () => {
    render(
      <MetricGrid>
        <Metric label="FC" value="72" unit="lpm" />
        <Metric label="RR" value="820" unit="ms" />
      </MetricGrid>
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Badge", () => {
  it("muestra su contenido", () => {
    render(<Badge tone="ok">Normal</Badge>);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("el tono no es la unica senal: hay texto", () => {
    // Un indicador que solo cambia de color deja fuera a quien no distingue
    // esos colores. El texto siempre acompana.
    const { container } = render(<Badge tone="critical">Muy compacta</Badge>);
    expect(container.textContent).toBe("Muy compacta");
  });
});
