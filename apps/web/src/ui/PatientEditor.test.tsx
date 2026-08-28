import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PatientEditor } from "./PatientEditor";
import type { CatalogClient } from "../simulation-runtime/catalog-client";
import {
  anticipatedVentricularRate,
  DEFAULT_PATIENT,
  type PatientPayload,
} from "../types/patients";
import type { ParameterRange } from "../types/rhythms";

const RANGES: Record<string, ParameterRange> = {
  atrial_rate_bpm: { minimum: 0, maximum: 400, default: 70 },
  escape_rate_bpm: { minimum: 0, maximum: 400, default: 40 },
  conduction_ratio: { minimum: 2, maximum: 6, default: 2 },
  wenckebach_cycle: { minimum: 2, maximum: 6, default: 4 },
  wenckebach_increment_ms: { minimum: 0, maximum: 200, default: 50 },
  pr_ms: { minimum: 80, maximum: 600, default: 160 },
  qrs_ms: { minimum: 60, maximum: 220, default: 90 },
  qt_ms: { minimum: 240, maximum: 700, default: 400 },
  st_shift_mv: { minimum: -1, maximum: 1, default: 0 },
  t_amplitude_scale: { minimum: -3, maximum: 3, default: 1 },
  p_amplitude_scale: { minimum: 0, maximum: 3, default: 1 },
  systolic_bp_mmhg: { minimum: 0, maximum: 260, default: 120 },
  diastolic_bp_mmhg: { minimum: 0, maximum: 200, default: 75 },
  respiratory_rate_bpm: { minimum: 0, maximum: 60, default: 14 },
  stroke_volume_ml: { minimum: 0, maximum: 200, default: 70 },
};

function makeClient(overrides: Partial<CatalogClient> = {}): CatalogClient {
  return {
    listPatients: vi.fn().mockResolvedValue([]),
    getPatient: vi.fn(),
    createPatient: vi.fn().mockResolvedValue({}),
    updatePatient: vi.fn().mockResolvedValue({}),
    deletePatient: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as CatalogClient;
}

function setup(
  patient: PatientPayload = DEFAULT_PATIENT,
  client: CatalogClient = makeClient()
) {
  const onChange = vi.fn();
  render(
    <PatientEditor
      patient={patient}
      ranges={RANGES}
      onChange={onChange}
      catalogClient={client}
    />
  );
  return { onChange, user: userEvent.setup() };
}

describe("el editor de paciente", () => {
  it("agrupa los controles por lo que describen", () => {
    setup();
    for (const grupo of [
      "Aurícula",
      "Conducción AV",
      "Intervalos",
      "Morfología",
      "Constantes",
    ]) {
      expect(screen.getByRole("group", { name: grupo })).toBeInTheDocument();
    }
  });

  it("cada campo numerico lleva su nombre a la vista", () => {
    // Tres cajas seguidas sin rotulo --PR, QRS, QT-- obligan a adivinar cual
    // es cual, y adivinar un intervalo es lo contrario de lo que se ensena.
    setup();
    for (const rotulo of ["PR", "QRS", "QT"]) {
      expect(screen.getByText(rotulo)).toBeInTheDocument();
    }
  });

  it("anticipa la frecuencia del ventriculo antes de generar un latido", () => {
    // El panel derecho tarda diez segundos en medir. Mientras se mueve un
    // bloqueo, el usuario necesita saber ya lo que va a salir.
    setup({ ...DEFAULT_PATIENT, atrial_rate_bpm: 90, av_conduction: "ratio", conduction_ratio: 3 });
    expect(screen.getByText(/Ventrículo:/)).toHaveTextContent("30 lpm");
  });

  it("cambiar la conduccion propaga el paciente entero", async () => {
    const { onChange, user } = setup();
    await user.selectOptions(
      screen.getByLabelText("Conducción auriculoventricular"),
      "complete_block"
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ av_conduction: "complete_block" })
    );
  });

  it("ensanchar el QRS empuja el QT en vez de bloquear el control", async () => {
    // El QT se mide DESDE el inicio del QRS, asi que no puede ser mas corto.
    // Un control que se niega a moverse sin decir por que se lee como averia.
    const { onChange, user } = setup({
      ...DEFAULT_PATIENT,
      qrs_ms: 200,
      qt_ms: 300,
    });
    await user.click(screen.getByLabelText("Ensanchar el QRS"));
    const [applied] = onChange.mock.calls.at(-1) as [PatientPayload];
    expect(applied.qrs_ms).toBe(210);
    expect(applied.qt_ms).toBeGreaterThan(applied.qrs_ms);
  });

  it("la diastolica nunca queda por encima de la sistolica", async () => {
    const { onChange, user } = setup({
      ...DEFAULT_PATIENT,
      systolic_bp_mmhg: 100,
      diastolic_bp_mmhg: 95,
    });
    await user.click(screen.getByLabelText("Bajar la sistólica"));
    const [applied] = onChange.mock.calls.at(-1) as [PatientPayload];
    expect(applied.diastolic_bp_mmhg).toBeLessThanOrEqual(applied.systolic_bp_mmhg);
  });

  it("sin aurícula ofrece el escape, que es quien manda entonces", () => {
    setup({ ...DEFAULT_PATIENT, atrial_rate_bpm: 0 });
    expect(
      screen.getByRole("spinbutton", { name: "Frecuencia de escape" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "PR" })).not.toBeInTheDocument();
  });

  it("un bloqueo completo no ofrece un PR que no existe", () => {
    setup({ ...DEFAULT_PATIENT, av_conduction: "complete_block" });
    expect(screen.queryByRole("spinbutton", { name: "PR" })).not.toBeInTheDocument();
  });
});

describe("la biblioteca de casos", () => {
  it("guarda con el nombre escrito", async () => {
    const createPatient = vi.fn().mockResolvedValue({});
    const client = makeClient({ createPatient });
    const { user } = setup(DEFAULT_PATIENT, client);

    await user.type(screen.getByLabelText("Nombre del caso"), "Caso de examen");
    await user.click(screen.getByRole("button", { name: "Guardar como nuevo" }));

    await waitFor(() =>
      expect(createPatient).toHaveBeenCalledWith("Caso de examen", DEFAULT_PATIENT)
    );
  });

  it("no deja guardar sin nombre", () => {
    setup();
    expect(screen.getByRole("button", { name: "Guardar como nuevo" })).toBeDisabled();
  });

  it("enseña el motivo que da el servidor, no un codigo", async () => {
    // «Ya existe un paciente llamado X» es lo que el usuario necesita leer.
    const client = makeClient({
      createPatient: vi
        .fn()
        .mockRejectedValue(new Error("ya existe un paciente llamado 'Repetido'")),
    });
    const { user } = setup(DEFAULT_PATIENT, client);

    await user.type(screen.getByLabelText("Nombre del caso"), "Repetido");
    await user.click(screen.getByRole("button", { name: "Guardar como nuevo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ya existe");
  });

  it("cargar un caso reemplaza el paciente en curso", async () => {
    const guardado = { ...DEFAULT_PATIENT, atrial_rate_bpm: 120 };
    const client = makeClient({
      listPatients: vi
        .fn()
        .mockResolvedValue([
          { id: "abc", name: "Taquicardia", created_at: "", updated_at: "" },
        ]),
      getPatient: vi
        .fn()
        .mockResolvedValue({ id: "abc", name: "Taquicardia", patient: guardado }),
    });
    const { onChange, user } = setup(DEFAULT_PATIENT, client);

    await screen.findByRole("option", { name: "Taquicardia" });
    await user.selectOptions(screen.getByLabelText("Cargar un caso"), "abc");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(guardado));
  });

  it("sin base de datos lo dice y no rompe el editor", async () => {
    // El paciente se puede configurar y usar igual: lo que se pierde es la
    // biblioteca, no la sesion.
    const client = makeClient({
      listPatients: vi.fn().mockRejectedValue(new Error("503")),
    });
    setup(DEFAULT_PATIENT, client);

    expect(await screen.findByText(/sin base de datos/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Intervalos" })).toBeInTheDocument();
  });
});

describe("la previsión de frecuencia ventricular", () => {
  it.each([
    [{ av_conduction: "conducted" as const }, 70],
    [{ av_conduction: "ratio" as const, conduction_ratio: 2 }, 35],
    [{ av_conduction: "wenckebach" as const, wenckebach_cycle: 4 }, 52.5],
    [{ av_conduction: "complete_block" as const, escape_rate_bpm: 38 }, 38],
    [{ atrial_rate_bpm: 0, escape_rate_bpm: 30 }, 30],
  ])("%o da %i lpm", (cambios, esperado) => {
    expect(
      anticipatedVentricularRate({ ...DEFAULT_PATIENT, ...cambios })
    ).toBeCloseTo(esperado, 1);
  });
});
