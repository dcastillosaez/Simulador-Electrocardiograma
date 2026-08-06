import { describe, expect, it } from "vitest";
import {
  caliperReadout,
  formatBpm,
  formatMs,
  formatMv,
  formatSeconds,
  formatSquares,
} from "./formulas";

const CTX = { sampleRateHz: 500, paperSpeedMmS: 25, clinicalGainMmPerMv: 10 };

describe("caliperReadout", () => {
  it("reproduce el ejemplo de la especificacion", () => {
    // 82 muestras a 500Hz son 164ms. A 25mm/s eso son 4,1mm de papel.
    const r = caliperReadout(1000, 0, 1082, 1.21 / 1000, CTX);

    expect(r.deltaMs).toBeCloseTo(164, 9);
    expect(r.deltaMv).toBeCloseTo(1.21, 9);
    expect(r.equivalentBpm).toBeCloseTo(365.8537, 4);
    expect(r.smallSquares).toBeCloseTo(4.1, 9);
    expect(r.largeSquares).toBeCloseTo(0.82, 9);
  });

  it("reproduce el ejemplo de RR", () => {
    const r = caliperReadout(0, 0, 430, 0, CTX);
    expect(r.deltaMs).toBeCloseTo(860, 9);
    expect(r.equivalentBpm).toBeCloseTo(69.7674, 4);
  });

  it("Delta t es siempre positivo, sea cual sea el orden de las marcas", () => {
    const ida = caliperReadout(1082, 0, 1000, 0, CTX);
    expect(ida.deltaMs).toBeCloseTo(164, 9);
  });

  it("Delta V conserva el signo", () => {
    const r = caliperReadout(0, 0.5 / 1000, 10, -0.3 / 1000, CTX);
    expect(r.deltaMv).toBeCloseTo(-0.8, 9);
  });

  it("la altura en cuadros usa la ganancia y es una magnitud", () => {
    const r = caliperReadout(0, 0, 10, -1.5 / 1000, CTX);
    expect(r.amplitudeSquares).toBeCloseTo(15, 9);
  });

  it("al doblar la velocidad de papel el mismo intervalo ocupa el doble de cuadros", () => {
    const rapido = caliperReadout(1000, 0, 1082, 0, { ...CTX, paperSpeedMmS: 50 });
    expect(rapido.deltaMs).toBeCloseTo(164, 9);
    expect(rapido.smallSquares).toBeCloseTo(8.2, 9);
  });

  it("dos marcas en la misma muestra no producen una frecuencia infinita", () => {
    const r = caliperReadout(1000, 0, 1000, 0, CTX);
    expect(r.deltaMs).toBe(0);
    expect(r.equivalentBpm).toBeNull();
  });
});

describe("formateadores", () => {
  it("dan las cadenas del ejemplo de la especificacion", () => {
    expect(formatMs(164)).toBe("164 ms");
    expect(formatMv(1.21)).toBe("+1.21 mV");
    expect(formatMv(-0.8)).toBe("-0.80 mV");
    expect(formatBpm(365.853)).toBe("366 lpm");
    expect(formatBpm(69.767)).toBe("69.8 lpm");
    expect(formatBpm(null)).toBe("—");
    expect(formatSquares(4.1)).toBe("4.1");
    expect(formatSquares(0.82)).toBe("0.82");
    expect(formatSeconds(2.314)).toBe("2.314 s");
  });
});
