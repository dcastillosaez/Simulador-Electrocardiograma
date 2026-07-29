import { describe, expect, it } from "vitest";
import { PX_PER_MM } from "./grid-layer";
import {
  STRIP_COMPACT_PX,
  STRIP_FLOOR_PX,
  STRIP_GAP_PX,
  STRIP_MARGIN_MV,
  STRIP_MAX_PX,
  STRIP_MIN_PX,
  computeLayoutMetrics,
} from "./layout-engine";

const GAIN = 10;
const SPEED = 25;

/** Alto que hay que dar al contenedor para que a cada tira le toquen
 * exactamente `stripPx`. Se calcula al revés para que los tests hablen de la
 * altura de tira, que es lo que importa, y no de aritmética de huecos. */
function heightFor(stripPx: number, leadCount: number): number {
  return stripPx * leadCount + STRIP_GAP_PX * (leadCount - 1);
}

describe("computeLayoutMetrics", () => {
  it("reparte el alto disponible entre las derivaciones, descontando los huecos", () => {
    const metrics = computeLayoutMetrics(heightFor(70, 12), 12, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(70);
  });

  it("nunca pasa del maximo, aunque sobre alto", () => {
    const metrics = computeLayoutMetrics(heightFor(400, 3), 3, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_MAX_PX);
  });

  it("el minimo es blando: por debajo de 52px sigue comprimiendo, no recorta", () => {
    // Es la decision del spec: el scroll esta descartado y ocultar
    // derivaciones en silencio es inaceptable en algo clinico, asi que las
    // tiras se comprimen mas y la interfaz lo declara. Un clamp con suelo en
    // 52 desbordaria la ventana, que es justo lo que se quiere evitar.
    const metrics = computeLayoutMetrics(heightFor(46, 12), 12, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(46);
    expect(metrics.stripHeightPx).toBeLessThan(STRIP_MIN_PX);
  });

  it("respeta un suelo absoluto para no crear canvas degenerados", () => {
    const metrics = computeLayoutMetrics(12, 12, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_FLOOR_PX);
  });

  it("clasifica la compresion en las tres fronteras", () => {
    const at = (stripPx: number, leads = 12) =>
      computeLayoutMetrics(heightFor(stripPx, leads), leads, GAIN, SPEED).compression;

    expect(at(STRIP_COMPACT_PX)).toBe("normal");
    expect(at(STRIP_COMPACT_PX - 1)).toBe("compact");
    expect(at(STRIP_MIN_PX)).toBe("compact");
    expect(at(STRIP_MIN_PX - 1)).toBe("very-compact");
  });

  it("la ganancia clinica no depende del tamano de la ventana", () => {
    // El nucleo de la separacion fisiologia/viewport: un milivoltio es un
    // milivoltio, y lo que cambia con la pantalla es cuantos pixeles lo
    // representan.
    const grande = computeLayoutMetrics(heightFor(120, 6), 6, GAIN, SPEED);
    const pequena = computeLayoutMetrics(heightFor(46, 12), 12, GAIN, SPEED);
    expect(grande.clinicalGainMmPerMv).toBe(GAIN);
    expect(pequena.clinicalGainMmPerMv).toBe(GAIN);
    expect(pequena.viewportScalePxPerMm).toBeLessThan(grande.viewportScalePxPerMm);
  });

  it("pixelsPerMillivolt es el producto de los dos eslabones", () => {
    const metrics = computeLayoutMetrics(heightFor(100, 6), 6, GAIN, SPEED);
    expect(metrics.pixelsPerMillivolt).toBeCloseTo(
      metrics.clinicalGainMmPerMv * metrics.viewportScalePxPerMm
    );
  });

  it("el tope de 140px deja la escala vertical justo por debajo de los 96dpi", () => {
    // La altura de tira que daria exactamente PX_PER_MM es
    // 2 x margen x ganancia x PX_PER_MM = 151,2px, por encima del tope de 140.
    // O sea: con el tope actual la escala vertical NUNCA llega del todo a la
    // suposicion de 96dpi, se queda en 3,5 px/mm. Es una consecuencia real del
    // tope y no un accidente, asi que conviene que cambiarlo haga saltar esto.
    const alturaExacta96dpi = 2 * STRIP_MARGIN_MV * GAIN * PX_PER_MM;
    expect(alturaExacta96dpi).toBeGreaterThan(STRIP_MAX_PX);

    const topeada = computeLayoutMetrics(heightFor(300, 1), 1, GAIN, SPEED);
    expect(topeada.stripHeightPx).toBe(STRIP_MAX_PX);
    expect(topeada.viewportScalePxPerMm).toBeCloseTo(
      STRIP_MAX_PX / (2 * STRIP_MARGIN_MV * GAIN)
    );
    expect(topeada.viewportScalePxPerMm).toBeLessThan(PX_PER_MM);
  });

  it("la senal de 2mV cabe justo en media tira, sin recortar", () => {
    // Es la propiedad que arreglo I-2 y que ahora debe sobrevivir a cualquier
    // tamano de ventana: la R de V5 (~1,3mV) nunca toca el borde.
    for (const stripPx of [46, 70, 140]) {
      const metrics = computeLayoutMetrics(heightFor(stripPx, 12), 12, GAIN, SPEED);
      const halfPx = metrics.stripHeightPx / 2;
      expect(STRIP_MARGIN_MV * metrics.pixelsPerMillivolt).toBeCloseTo(halfPx);
    }
  });

  it("el eje horizontal no depende del alto de tira", () => {
    // Si viewportScale gobernase los dos ejes, comprimir 12 derivaciones daria
    // ~27 segundos por pantalla: un garabato ilegible.
    const alta = computeLayoutMetrics(heightFor(140, 3), 3, GAIN, SPEED);
    const baja = computeLayoutMetrics(heightFor(46, 12), 12, GAIN, SPEED);
    expect(baja.pixelsPerSecond).toBeCloseTo(alta.pixelsPerSecond);
    expect(alta.pixelsPerSecond).toBeCloseTo(SPEED * PX_PER_MM);
  });

  it("una sola derivacion no descuenta huecos", () => {
    const metrics = computeLayoutMetrics(300, 1, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_MAX_PX);
  });
});
