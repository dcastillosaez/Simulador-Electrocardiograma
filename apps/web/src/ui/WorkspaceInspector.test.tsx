import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceInspector } from "./WorkspaceInspector";
import type { AtrialActivityName } from "../types/ws-messages";

/** El inspector con una sesión corriendo y sin nada que avisar: lo que se
 * quiere probar aquí son las dos frecuencias, no los estados de error.
 *
 * El ritmo por defecto es un bloqueo completo y no un sinusal: es el caso que
 * justifica el desglose, y así cada prueba dice a qué ritmo se refiere. */
function renderInspector(
  overrides: {
    measurements?: Record<string, number | null> | null;
    atrialActivity?: AtrialActivityName | null;
    avRelationship?: string | null;
    rhythmId?: string;
    rhythmName?: string;
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
      rhythmName={overrides.rhythmName ?? "Bloqueo AV completo"}
      rhythmId={overrides.rhythmId ?? "av_block_third"}
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

/** Un ritmo sinusal, donde las dos frecuencias son el mismo latido. */
const SINUSAL = { rhythmId: "sinus_normal", rhythmName: "Ritmo sinusal normal" };

describe("las dos frecuencias", () => {
  it("muestra la auricular y la ventricular por separado", () => {
    renderInspector({ measurements: { atrial_rate_bpm: 72, ventricular_rate_bpm: 72 } });
    expect(readout("FC ondas P")).toContain("72");
    expect(readout("FC complejos QRS")).toContain("72");
  });

  it("las muestra las dos aunque coincidan, si el ritmo puede disociarse", () => {
    // Un bloqueo completo a 75/75 seria casualidad, no conduccion 1:1: donde
    // las dos pueden separarse se ensena a buscar las dos.
    renderInspector();
    expect(screen.getByText("FC ondas P")).toBeInTheDocument();
    expect(screen.getByText("FC complejos QRS")).toBeInTheDocument();
    expect(screen.queryByText("FC")).not.toBeInTheDocument();
  });

  it("en un ritmo sinusal hay una sola FC", () => {
    // El nodo sinusal manda y el ventriculo obedece: desglosarlo es escribir
    // el mismo numero dos veces y sugerir una discrepancia imposible.
    renderInspector(SINUSAL);
    expect(readout("FC")).toContain("72");
    expect(screen.queryByText("FC ondas P")).not.toBeInTheDocument();
    expect(screen.queryByText("FC complejos QRS")).not.toBeInTheDocument();
  });

  it.each([
    ["sinus_normal", "Ritmo sinusal normal"],
    ["sinus_tachycardia", "Taquicardia sinusal"],
    ["sinus_bradycardia", "Bradicardia sinusal"],
  ])("%s colapsa las dos frecuencias en una", (rhythmId, rhythmName) => {
    renderInspector({ rhythmId, rhythmName });
    expect(screen.getByText("FC")).toBeInTheDocument();
  });

  it.each([
    ["atrial_fibrillation", "FC ondas P"],
    ["atrial_flutter", "FC ondas F"],
    ["av_block_second_mobitz_i", "FC ondas P"],
    ["ventricular_tachycardia", "FC ondas P"],
    ["custom_patient", "FC ondas P"],
  ])("%s conserva el desglose", (rhythmId, atrialLabel) => {
    renderInspector({ rhythmId });
    expect(screen.getByText(atrialLabel)).toBeInTheDocument();
    expect(screen.getByText("FC complejos QRS")).toBeInTheDocument();
  });

  it("un bloqueo completo ensena dos numeros distintos y la disociacion", () => {
    // El caso que motiva la separacion: publicar 75 lpm aqui seria anunciar
    // la frecuencia auricular de un paciente cuyo pulso es 40.
    renderInspector({
      measurements: { atrial_rate_bpm: 75, ventricular_rate_bpm: 40 },
      avRelationship: "dissociated",
    });
    expect(readout("FC ondas P")).toContain("75");
    expect(readout("FC complejos QRS")).toContain("40");
    expect(readout("Cond. AV")).toBe("Disociada");
  });

  it("un flutter ensena su conduccion 2:1", () => {
    renderInspector({
      measurements: { atrial_rate_bpm: 300, ventricular_rate_bpm: 150 },
      avRelationship: "2:1",
    });
    expect(readout("Cond. AV")).toBe("2:1");
  });

  it("en un flutter lo que se cuenta son ondas F, no P", () => {
    renderInspector({
      rhythmId: "atrial_flutter",
      rhythmName: "Flutter auricular",
      measurements: { atrial_rate_bpm: 300, ventricular_rate_bpm: 150 },
      avRelationship: "2:1",
    });
    expect(readout("FC ondas F")).toContain("300");
    expect(screen.queryByText("FC ondas P")).not.toBeInTheDocument();
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
    expect(readout("FC complejos QRS")).toContain("86");
    // Sin onda que contar, el rotulo no puede prometer una P.
    expect(screen.queryByText("FC ondas P")).not.toBeInTheDocument();
  });

  it("en una fibrilacion ventricular no hay ninguna de las dos", () => {
    renderInspector({
      measurements: { atrial_rate_bpm: null, ventricular_rate_bpm: null },
      atrialActivity: "absent",
      avRelationship: null,
    });
    expect(readout("FC auricular")).toBe("Ausente");
    expect(readout("FC complejos QRS")).toBe("—");
  });

  it("antes de la primera medida las dos estan vacias, no a cero", () => {
    // Cero es un dato clinico —una asistolia— y no puede ser lo que se pinta
    // mientras se espera al servidor.
    renderInspector({ measurements: null, atrialActivity: null, avRelationship: null });
    expect(readout("FC ondas P")).toBe("—");
    expect(readout("FC complejos QRS")).toBe("—");
    expect(readout("Cond. AV")).toBe("—");
  });
});
