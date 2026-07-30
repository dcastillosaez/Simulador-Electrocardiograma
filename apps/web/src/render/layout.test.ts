import { describe, expect, it } from "vitest";
import {
  LEAD_ORDER,
  columnsForLayout,
  leadColumnsForLayout,
  leadIndex,
  leadsForLayout,
  rowsForLayout,
} from "./layout";

describe("layout", () => {
  it("LEAD_ORDER tiene las 12 derivaciones en el orden canonico del contrato", () => {
    expect(LEAD_ORDER).toEqual([
      "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6",
    ]);
  });

  it("leadIndex devuelve la posicion en LEAD_ORDER", () => {
    expect(leadIndex("I")).toBe(0);
    expect(leadIndex("V6")).toBe(11);
  });

  it("layout 1 muestra solo II", () => {
    expect(leadsForLayout("1")).toEqual(["II"]);
  });

  it("layout 12 muestra las 12 en orden canonico", () => {
    expect(leadsForLayout("12")).toEqual(LEAD_ORDER);
  });

  it("layout 3 y 6 son subconjuntos que empiezan por I, II, III", () => {
    expect(leadsForLayout("3")).toEqual(["I", "II", "III"]);
    expect(leadsForLayout("6").slice(0, 3)).toEqual(["I", "II", "III"]);
    expect(leadsForLayout("6")).toHaveLength(6);
  });
});

describe("formato de dos columnas", () => {
  it("6x2 muestra las doce derivaciones, igual que 12", () => {
    expect(leadsForLayout("6x2")).toEqual(LEAD_ORDER);
  });

  it("solo 6x2 usa dos columnas", () => {
    expect(columnsForLayout("6x2")).toBe(2);
    for (const layout of ["1", "3", "6", "12"] as const) {
      expect(columnsForLayout(layout), layout).toBe(1);
    }
  });

  it("reparte los miembros seis y seis, en orden de lectura", () => {
    // Izquierda las de miembros, derecha las precordiales: es el reparto del
    // ECG en papel y el que espera cualquiera que haya visto uno.
    const [izquierda, derecha] = leadColumnsForLayout("6x2");
    expect(izquierda).toEqual(["I", "II", "III", "aVR", "aVL", "aVF"]);
    expect(derecha).toEqual(["V1", "V2", "V3", "V4", "V5", "V6"]);
  });

  it("un layout de una columna devuelve una sola lista", () => {
    expect(leadColumnsForLayout("6")).toEqual([leadsForLayout("6")]);
  });

  it("6x2 tiene seis filas aunque tenga doce derivaciones", () => {
    // Es lo que hace que sus tiras sean el doble de altas que en 12: el alto
    // disponible se reparte entre filas, no entre derivaciones.
    expect(rowsForLayout("6x2")).toBe(6);
    expect(rowsForLayout("12")).toBe(12);
    expect(rowsForLayout("1")).toBe(1);
  });
});
