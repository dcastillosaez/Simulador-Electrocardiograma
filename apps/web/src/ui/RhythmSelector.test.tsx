import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RhythmSelector } from "./RhythmSelector";
import type { CatalogClient } from "../simulation-runtime/catalog-client";
import type { RhythmDetail, RhythmSummary } from "../types/rhythms";

const summaries: RhythmSummary[] = [
  { rhythm_id: "sinus_normal", display_name: "Sinusal normal", category: "sinus", ventricular_rate_hz: 1.1667, pr_is_measurable: true },
  { rhythm_id: "atrial_fibrillation", display_name: "Fibrilación auricular", category: "supraventricular", ventricular_rate_hz: 1.5, pr_is_measurable: false },
];

const detail: RhythmDetail = {
  ...summaries[0],
  default_parameters: { heart_rate_hz: 1.1667 },
  editable_parameters: { heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 } },
  clinical_description: "...",
  references: [],
  allowed_overlays: [],
};

function makeCatalogClient(overrides: Partial<CatalogClient> = {}): CatalogClient {
  return {
    listRhythms: vi.fn().mockResolvedValue(summaries),
    getRhythm: vi.fn().mockResolvedValue(detail),
    ...overrides,
  } as unknown as CatalogClient;
}

describe("RhythmSelector", () => {
  it("carga el catalogo y muestra una opcion por ritmo", async () => {
    const catalogClient = makeCatalogClient();
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("Sinusal normal")).toBeInTheDocument();
      expect(screen.getByText("Fibrilación auricular")).toBeInTheDocument();
    });
  });

  it("al elegir un ritmo pide el detalle y llama a onSelect", async () => {
    const catalogClient = makeCatalogClient();
    const onSelect = vi.fn();
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={onSelect} />
    );
    await waitFor(() => screen.getByText("Sinusal normal"));

    await userEvent.selectOptions(
      screen.getByLabelText("Seleccionar ritmo"),
      "sinus_normal"
    );

    await waitFor(() => {
      expect(catalogClient.getRhythm).toHaveBeenCalledWith("sinus_normal");
      expect(onSelect).toHaveBeenCalledWith("sinus_normal", detail);
    });
  });

  it("muestra un error si el catalogo no carga", async () => {
    const catalogClient = makeCatalogClient({
      listRhythms: vi.fn().mockRejectedValue(new Error("500")),
    });
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("500");
    });
  });

  it("muestra un error (sin dejar la promesa sin capturar) si getRhythm falla al elegir un ritmo", async () => {
    const catalogClient = makeCatalogClient({
      getRhythm: vi.fn().mockRejectedValue(new Error("404")),
    });
    const onSelect = vi.fn();
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={onSelect} />
    );
    await waitFor(() => screen.getByText("Sinusal normal"));

    await userEvent.selectOptions(
      screen.getByLabelText("Seleccionar ritmo"),
      "sinus_normal"
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("404");
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
