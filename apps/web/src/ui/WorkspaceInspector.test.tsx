import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceInspector } from "./WorkspaceInspector";
import type { AtrialActivityName } from "../types/ws-messages";

/** El inspector con una sesión corriendo y sin nada que avisar: lo que se
 * quiere probar aquí son las dos frecuencias, no los estados de error. */
function renderInspector(
  overrides: {
    measurements?: Record<string, number | null> | null;
    atrialActivity?: AtrialActivityName | null;
    avRelationship?: string | null;
  } = {}
) {
  return render(
    <WorkspaceInspector
      lastError={null}
      disconnectReason={null}
      connectionState="running"
      hasConnectedOnce
      isAwaitingSignal={false}
      isFrozen={false}
      gainFits
      exportError={null}
      rhythmName="Ritmo sinusal normal"
      axisDeg={50}
      atrialActivity={overrides.atrialActivity ?? "organized"}
      avRelationship={
        overrides.avRelationship === undefined ? "1:1" : overrides.avRelationship
      }
      measurements={
        overrides.measurements === undefined
          ? { atrial_rate_bpm: 72, ventricular_rate_bpm: 72 }
          : overrides.measurements
      }
      physiology={null}
      measureSession={null}
      onToolChange={vi.fn()}
      onSnapChange={vi.fn()}
    />
  );
}

/** El valor que acompaña a un rótulo, sin depender de la maquetación. */
function readout(label: string): string {
  const cell = screen.getByText(label).parentElement;
  return (cell?.textContent ?? "").replace(label, "").trim();
}

describe("las dos frecuencias", () => {
  it("muestra la auricular y la ventricular por separado", () => {
    renderInspector();
    expect(readout("FC auricular")).toContain("72");
    expect(readout("FC ventricular")).toContain("72");
  });

  it("las muestra las dos aunque coincidan", () => {
    // Ensenar a buscar las dos es parte del objetivo docente: una sola "FC"
    // que a veces se desdobla ensena a mirar una y olvidarse de la otra.
    renderInspector();
    expect(screen.getByText("FC auricular")).toBeInTheDocument();
    expect(screen.getByText("FC ventricular")).toBeInTheDocument();
    expect(screen.queryByText("FC")).not.toBeInTheDocument();
  });

  it("un bloqueo completo ensena dos numeros distintos y la disociacion", () => {
    // El caso que motiva la separacion: publicar 75 lpm aqui seria anunciar
    // la frecuencia auricular de un paciente cuyo pulso es 40.
    renderInspector({
      measurements: { atrial_rate_bpm: 75, ventricular_rate_bpm: 40 },
      avRelationship: "dissociated",
    });
    expect(readout("FC auricular")).toContain("75");
    expect(readout("FC ventricular")).toContain("40");
    expect(readout("Cond. AV")).toBe("Disociada");
  });

  it("un flutter ensena su conduccion 2:1", () => {
    renderInspector({
      measurements: { atrial_rate_bpm: 300, ventricular_rate_bpm: 150 },
      avRelationship: "2:1",
    });
    expect(readout("Cond. AV")).toBe("2:1");
  });

  it("en una fibrilacion escribe por que no hay frecuencia auricular", () => {
    // Un guion a secas se lee como un fallo del simulador. Aqui el hueco es
    // el hallazgo, y tiene nombre.
    renderInspector({
      measurements: { atrial_rate_bpm: null, ventricular_rate_bpm: 86 },
      atrialActivity: "fibrillatory",
      avRelationship: null,
    });
    expect(readout("FC auricular")).toBe("Fibrilatoria");
    expect(readout("FC ventricular")).toContain("86");
  });

  it("en una fibrilacion ventricular no hay ninguna de las dos", () => {
    renderInspector({
      measurements: { atrial_rate_bpm: null, ventricular_rate_bpm: null },
      atrialActivity: "absent",
      avRelationship: null,
    });
    expect(readout("FC auricular")).toBe("Ausente");
    expect(readout("FC ventricular")).toBe("—");
  });

  it("antes de la primera medida las dos estan vacias, no a cero", () => {
    // Cero es un dato clinico —una asistolia— y no puede ser lo que se pinta
    // mientras se espera al servidor.
    renderInspector({ measurements: null, atrialActivity: null, avRelationship: null });
    expect(readout("FC auricular")).toBe("—");
    expect(readout("FC ventricular")).toBe("—");
    expect(readout("Cond. AV")).toBe("—");
  });
});
