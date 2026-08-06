import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  PharmacologyPanel,
  formatDose,
  formatRemaining,
} from "./PharmacologyPanel";
import type { ActiveDrug, DrugSummary } from "../types/drugs";

const ATROPINE: DrugSummary = {
  drug_id: "atropine",
  display_name: "Atropina",
  category: "parasympatholytic",
  routes: ["IV", "IO"],
  dose_unit: "mg",
  reference_dose: 1,
  max_cumulative_dose: 3,
  onset_s: 20,
  peak_s: 90,
  duration_s: 1800,
};

const AMIODARONE: DrugSummary = {
  drug_id: "amiodarone",
  display_name: "Amiodarona",
  category: "antiarrhythmic",
  routes: ["IV"],
  dose_unit: "mg",
  reference_dose: 300,
  max_cumulative_dose: 900,
  onset_s: 120,
  peak_s: 600,
  duration_s: 7200,
};

function catalogClient(drugs: DrugSummary[] = [ATROPINE, AMIODARONE]) {
  return {
    listDrugs: vi.fn().mockResolvedValue(drugs),
  } as never;
}

function renderPanel(overrides: Partial<Parameters<typeof PharmacologyPanel>[0]> = {}) {
  const onAdminister = vi.fn();
  render(
    <PharmacologyPanel
      catalogClient={catalogClient()}
      activeDrugs={[]}
      interactions={[]}
      disabled={false}
      onAdminister={onAdminister}
      {...overrides}
    />
  );
  return { onAdminister };
}

describe("formatRemaining", () => {
  it("usa segundos por debajo del minuto", () => {
    // La adenosina dura treinta segundos: «0:08» sería ilegible.
    expect(formatRemaining(8)).toBe("8 s");
  });

  it("usa minutos y segundos hasta la hora", () => {
    expect(formatRemaining(125)).toBe("2:05");
  });

  it("usa horas para las moléculas largas", () => {
    // La digoxina dura seis horas: «21600 s» no lo lee nadie.
    expect(formatRemaining(21600)).toBe("6 h 00 min");
  });

  it("no muestra tiempos negativos", () => {
    expect(formatRemaining(-3)).toBe("0 s");
  });
});

describe("formatDose", () => {
  it("no redondea a cero las dosis pequeñas", () => {
    // Noradrenalina: redondear a entero la convertiría en «0 mg».
    expect(formatDose(0.1, "mg")).toBe("0.1 mg");
  });

  it("redondea las dosis grandes", () => {
    expect(formatDose(300, "mg")).toBe("300 mg");
  });
});

describe("PharmacologyPanel", () => {
  it("carga el catálogo y lo ofrece por nombre clínico", async () => {
    renderPanel();
    await screen.findByRole("option", { name: "Atropina" });
    expect(screen.getByRole("option", { name: "Amiodarona" })).toBeInTheDocument();
  });

  it("filtra por categoría", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("option", { name: "Atropina" });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Categoría" }),
      "antiarrhythmic"
    );

    expect(screen.queryByRole("option", { name: "Atropina" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Amiodarona" })).toBeInTheDocument();
  });

  it("propone la dosis y la vía de referencia al elegir molécula", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("option", { name: "Amiodarona" });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Medicamento" }),
      "amiodarone"
    );

    expect(screen.getByRole("spinbutton", { name: "Dosis" })).toHaveValue(300);
    expect(screen.getByRole("combobox", { name: "Vía" })).toHaveValue("IV");
  });

  it("reinicia la dosis al cambiar de molécula", async () => {
    // Conservar «300» al pasar a atropina dejaría el campo con trescientas
    // veces la dosis máxima, a un clic de administrarse.
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("option", { name: "Amiodarona" });
    const drugSelect = screen.getByRole("combobox", { name: "Medicamento" });

    await user.selectOptions(drugSelect, "amiodarone");
    await user.selectOptions(drugSelect, "atropine");

    expect(screen.getByRole("spinbutton", { name: "Dosis" })).toHaveValue(1);
  });

  it("administra la molécula, la dosis y la vía elegidas", async () => {
    const user = userEvent.setup();
    const { onAdminister } = renderPanel();
    await screen.findByRole("option", { name: "Atropina" });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Medicamento" }),
      "atropine"
    );
    await user.click(screen.getByRole("button", { name: "Administrar" }));

    expect(onAdminister).toHaveBeenCalledWith("atropine", 1, "IV");
  });

  it("no deja administrar sin sesión", async () => {
    renderPanel({ disabled: true });
    await screen.findByRole("option", { name: "Atropina" });
    expect(screen.getByRole("button", { name: "Administrar" })).toBeDisabled();
    expect(screen.getByText(/Elige un ritmo/)).toBeInTheDocument();
  });

  it("no deja administrar sin haber elegido molécula", async () => {
    renderPanel();
    await screen.findByRole("option", { name: "Atropina" });
    expect(screen.getByRole("button", { name: "Administrar" })).toBeDisabled();
  });

  it("dice explícitamente que no hay nada activo", async () => {
    renderPanel();
    await screen.findByRole("option", { name: "Atropina" });
    expect(screen.getByText("Ninguno.")).toBeInTheDocument();
  });

  it("muestra concentración, dosis acumulada y tiempo restante", async () => {
    const active: ActiveDrug[] = [
      {
        drug_id: "amiodarone",
        display_name: "Amiodarona",
        category: "antiarrhythmic",
        concentration: 0.42,
        intensity: 0.42,
        cumulative_dose: 600,
        dose_unit: "mg",
        elapsed_s: 900,
        remaining_s: 6300,
      },
    ];
    renderPanel({ activeDrugs: active });
    await screen.findByRole("option", { name: "Atropina" });

    const bar = screen.getByRole("progressbar", {
      name: "Concentración de Amiodarona",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("600 mg")).toBeInTheDocument();
    expect(screen.getByText("1 h 45 min")).toBeInTheDocument();
  });

  it("avisa de las interacciones que se están disparando", async () => {
    renderPanel({
      interactions: [
        {
          rule_id: "ccb_beta_blocker_av",
          description: "Calcioantagonista + betabloqueante: bloqueo AV sumado",
          intensity: 1,
          drug_ids: ["verapamil", "metoprolol"],
        },
      ],
    });
    await screen.findByRole("option", { name: "Atropina" });
    expect(screen.getByText(/bloqueo AV sumado/)).toBeInTheDocument();
  });

  it("informa si el catálogo no carga", async () => {
    render(
      <PharmacologyPanel
        catalogClient={
          { listDrugs: vi.fn().mockRejectedValue(new Error("boom")) } as never
        }
        activeDrugs={[]}
        interactions={[]}
        disabled={false}
        onAdminister={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
  });
});
