import { describe, expect, it } from "vitest";
import { describeClose } from "./close-reasons";

describe("describeClose", () => {
  it("explica el aforo en vez de decir solo 'desconectado'", () => {
    // Un servidor lleno y un servidor apagado se veian igual, y son dos
    // problemas con soluciones distintas: uno se arregla esperando y el otro
    // arrancando el backend.
    expect(describeClose({ code: 1013, reason: "" })).toMatch(/completo/i);
  });

  it("explica que no hay nadie al otro lado", () => {
    expect(describeClose({ code: 1006, reason: "" })).toMatch(/arrancado/i);
  });

  it("prefiere el motivo que manda el servidor al mensaje generico", () => {
    // Lo escribio quien sabe exactamente que paso.
    expect(describeClose({ code: 1013, reason: "servidor al completo" })).toBe(
      "servidor al completo"
    );
  });

  it("no inventa nada ante un cierre normal", () => {
    // Cerrar la pestana o parar la simulacion no es un incidente que haya que
    // explicar: un mensaje ahi solo seria ruido.
    expect(describeClose({ code: 1000, reason: "" })).toBeNull();
  });

  it("sin desconexion previa no dice nada", () => {
    expect(describeClose(null)).toBeNull();
  });
});
