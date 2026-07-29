import { describe, expect, it } from "vitest";
import { LEAD_ORDER, leadIndex, leadsForLayout } from "./layout";

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
