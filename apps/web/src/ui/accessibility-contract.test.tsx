import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ECGWorkspace } from "./ECGWorkspace";
import { LEAD_ORDER } from "../render/layout";

/** Nombres accesibles de los que dependen tests unitarios, el e2e de Playwright
 * o ambos. Convierte en verificable la regla del §12 del spec: el rediseño es
 * visual y el árbol de accesibilidad se conserva.
 *
 * Si una pieza nueva obliga a cambiar uno de estos nombres, se cambia aquí de
 * forma explícita y se justifica en el commit. Nunca por accidente. */
const REQUIRED_LABELS = [
  "Seleccionar ritmo", // lo usa tambien el e2e de Playwright
  "Derivaciones visibles",
];

const RHYTHM_SUMMARY = {
  rhythm_id: "sinus_normal",
  display_name: "Sinusal normal",
  category: "sinus",
  ventricular_rate_hz: 1.1667,
  pr_is_measurable: true,
};
const RHYTHM_DETAIL = {
  ...RHYTHM_SUMMARY,
  default_parameters: { heart_rate_hz: 1.1667 },
  editable_parameters: { heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 } },
  clinical_description: "...",
  references: [],
  allowed_overlays: [],
};

class SilentSocket {
  static OPEN = 1;
  readyState = 1;
  binaryType = "blob";
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

function renderWorkspace() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.endsWith("/api/rhythms") ? [RHYTHM_SUMMARY] : RHYTHM_DETAIL),
      })
    )
  );
  return render(
    <ECGWorkspace
      wsUrl="ws://test"
      apiBaseUrl="http://api.test"
      webSocketFactory={() => new SilentSocket() as unknown as WebSocket}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contrato de accesibilidad", () => {
  it("conserva todos los nombres accesibles vigentes", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    for (const label of REQUIRED_LABELS) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });

  it("conserva el data-testid de cada derivacion visible", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    // Layout por defecto: 6 derivaciones.
    for (const lead of ["I", "II", "III", "aVR", "aVL", "aVF"]) {
      expect(screen.getByTestId(`lead-canvas-${lead}`), lead).toBeInTheDocument();
    }
  });

  it("en layout de 12 aparecen las doce, con su testid", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    await userEvent.click(screen.getByRole("radio", { name: "12" }));

    for (const lead of LEAD_ORDER) {
      expect(screen.getByTestId(`lead-canvas-${lead}`), lead).toBeInTheDocument();
    }
  });

  it("conserva los nombres de los controles de frecuencia y ruido tras elegir ritmo", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByText("Sinusal normal"));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");

    expect(screen.getByRole("button", { name: "Bajar frecuencia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir frecuencia" })).toBeInTheDocument();
    expect(screen.getByLabelText("Calidad de señal")).toBeInTheDocument();
  });

  it("conserva los nombres de los sliders del panel avanzado", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByText("Sinusal normal"));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");
    await userEvent.selectOptions(screen.getByLabelText("Calidad de señal"), "personalizada");

    for (const label of ["EMG", "Interferencia 50Hz", "Línea base", "Movimiento", "Saturación"]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Volver a modo básico" })).toBeInTheDocument();
  });
});
