import { describe, expect, it } from "vitest";
import { PX_PER_MM } from "./grid-layer";
import {
  GAIN_STEPS_MM_PER_MV,
  STRIP_COMPACT_PX,
  STRIP_FLOOR_PX,
  STRIP_GAP_PX,
  STRIP_MARGIN_MV,
  STRIP_MAX_PX,
  STRIP_MIN_PX,
  computeLayoutMetrics,
} from "./layout-engine";

const SPEED = 25;

/** Alto que hay que dar al contenedor para que a cada tira le toquen
 * exactamente `stripPx`. Se calcula al revés para que los tests hablen de la
 * altura de tira, que es lo que importa, y no de aritmética de huecos. */
function heightFor(stripPx: number, leadCount: number): number {
  return stripPx * leadCount + STRIP_GAP_PX * (leadCount - 1);
}

/** Alto de tira justo para representar `marginMv` a cada lado de la línea
 * base con la ganancia dada, a escala real. */
function heightForGain(gainMmPerMv: number, marginMv = STRIP_MARGIN_MV): number {
  return 2 * marginMv * gainMmPerMv * PX_PER_MM;
}

describe("reparto de altura", () => {
  it("reparte el alto disponible entre las derivaciones, descontando los huecos", () => {
    const metrics = computeLayoutMetrics(heightFor(70, 12), 12, "auto", SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(70);
  });

  it("nunca pasa del maximo, aunque sobre alto", () => {
    const metrics = computeLayoutMetrics(heightFor(400, 3), 3, "auto", SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_MAX_PX);
  });

  it("el minimo es blando: por debajo de 52px sigue comprimiendo, no recorta", () => {
    const metrics = computeLayoutMetrics(heightFor(46, 12), 12, "auto", SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(46);
    expect(metrics.stripHeightPx).toBeLessThan(STRIP_MIN_PX);
  });

  it("respeta un suelo absoluto para no crear canvas degenerados", () => {
    expect(computeLayoutMetrics(12, 12, "auto", SPEED).stripHeightPx).toBe(STRIP_FLOOR_PX);
  });

  it("clasifica la compresion en las tres fronteras", () => {
    const at = (stripPx: number, leads = 12) =>
      computeLayoutMetrics(heightFor(stripPx, leads), leads, "auto", SPEED).compression;

    expect(at(STRIP_COMPACT_PX)).toBe("normal");
    expect(at(STRIP_COMPACT_PX - 1)).toBe("compact");
    expect(at(STRIP_MIN_PX)).toBe("compact");
    expect(at(STRIP_MIN_PX - 1)).toBe("very-compact");
  });

  it("una sola derivacion no descuenta huecos", () => {
    expect(computeLayoutMetrics(300, 1, "auto", SPEED).stripHeightPx).toBe(STRIP_MAX_PX);
  });
});

describe("cuadricula cuadrada", () => {
  it("un milimetro mide lo mismo en los dos ejes, siempre", () => {
    // ES EL ARREGLO. Antes la escala vertical se estiraba para llenar la tira
    // mientras la horizontal seguia fija, y la rejilla se dibujaba con la
    // vertical: daba 6,25 cuadros grandes por segundo en vez de 5, un 25% de
    // error al medir un RR sobre el papel. Ahora el milimetro es el milimetro
    // y lo que se adapta es la ganancia.
    for (const stripPx of [16, 46, 70, 121, 140]) {
      const metrics = computeLayoutMetrics(heightFor(stripPx, 6), 6, "auto", SPEED);
      expect(metrics.viewportScalePxPerMm, `${stripPx}px`).toBeCloseTo(PX_PER_MM);
    }
  });

  it("a 25mm/s un segundo son exactamente cinco cuadros grandes", () => {
    // La comprobacion que hace un clinico con el dedo sobre la pantalla.
    const metrics = computeLayoutMetrics(heightFor(121, 6), 6, "auto", SPEED);
    const bigSquarePx = 5 * metrics.viewportScalePxPerMm;
    expect(metrics.pixelsPerSecond / bigSquarePx).toBeCloseTo(5);
  });

  it("un cuadro pequeno son 40ms, la lectura de toda la vida", () => {
    const metrics = computeLayoutMetrics(heightFor(121, 6), 6, "auto", SPEED);
    const smallSquareS = metrics.viewportScalePxPerMm / metrics.pixelsPerSecond;
    expect(smallSquareS).toBeCloseTo(0.04);
  });

  it("el eje horizontal no depende del alto de tira ni de la ganancia", () => {
    const alta = computeLayoutMetrics(heightFor(140, 3), 3, "auto", SPEED);
    const baja = computeLayoutMetrics(heightFor(46, 12), 12, "auto", SPEED);
    expect(baja.pixelsPerSecond).toBeCloseTo(alta.pixelsPerSecond);
    expect(alta.pixelsPerSecond).toBeCloseTo(SPEED * PX_PER_MM);
  });
});

describe("ganancia automatica", () => {
  it("elige la mayor ganancia estandar que quepa", () => {
    // Es lo que hace un electrocardiografo real: si la amplitud no cabe se
    // baja la ganancia, nunca se toca la velocidad del papel.
    // Con la tira al maximo cabe justo el rango clinico a ganancia estandar:
    // el tope de altura esta derivado precisamente de eso.
    const holgada = computeLayoutMetrics(heightFor(STRIP_MAX_PX, 6), 6, "auto", SPEED);
    expect(holgada.clinicalGainMmPerMv).toBe(10);
    expect(STRIP_MAX_PX).toBeGreaterThanOrEqual(heightForGain(10));

    const justa = computeLayoutMetrics(heightFor(80, 6), 6, "auto", SPEED);
    expect(justa.clinicalGainMmPerMv).toBe(5);
  });

  it("baja escalon a escalon segun se estrecha la tira", () => {
    const gainAt = (stripPx: number) =>
      computeLayoutMetrics(heightFor(stripPx, 6), 6, "auto", SPEED).clinicalGainMmPerMv;

    expect(gainAt(1000)).toBe(10); // el tope de tira impide llegar a 20
    expect(gainAt(90)).toBe(5);
    expect(gainAt(40)).toBe(2.5);
  });

  it("nunca baja del escalon mas pequeno, aunque no quepa", () => {
    // Con doce derivaciones en una ventana diminuta no cabe ni a 2,5mm/mV.
    // Recortar es preferible a inventar una ganancia que no existe en ningun
    // equipo: el numero que se lee en pantalla tiene que ser uno real.
    const metrics = computeLayoutMetrics(12, 12, "auto", SPEED);
    expect(metrics.clinicalGainMmPerMv).toBe(Math.min(...GAIN_STEPS_MM_PER_MV));
  });

  it("se declara como automatica", () => {
    const metrics = computeLayoutMetrics(heightFor(121, 6), 6, "auto", SPEED);
    expect(metrics.gainIsAuto).toBe(true);
    // En automatico siempre cabe salvo en el suelo, asi que no hay aviso.
    expect(metrics.gainFits).toBe(true);
  });
});

describe("ganancia manual", () => {
  it("respeta la que fija el usuario aunque quepa una mayor", () => {
    const metrics = computeLayoutMetrics(heightFor(140, 3), 3, 2.5, SPEED);
    expect(metrics.clinicalGainMmPerMv).toBe(2.5);
    expect(metrics.gainIsAuto).toBe(false);
  });

  it("avisa cuando la ganancia elegida no cabe, pero la aplica igual", () => {
    // El usuario manda. Un equipo real tampoco impide subir la ganancia: la
    // sube y la señal se sale por arriba. Lo que no puede pasar es que se
    // altere la escala temporal para disimularlo.
    const metrics = computeLayoutMetrics(heightFor(50, 12), 12, 20, SPEED);
    expect(metrics.clinicalGainMmPerMv).toBe(20);
    expect(metrics.gainFits).toBe(false);
    expect(metrics.pixelsPerSecond).toBeCloseTo(SPEED * PX_PER_MM);
  });

  it("la ganancia manual no toca la cuadricula", () => {
    const normal = computeLayoutMetrics(heightFor(121, 6), 6, 10, SPEED);
    const doble = computeLayoutMetrics(heightFor(121, 6), 6, 20, SPEED);
    expect(doble.viewportScalePxPerMm).toBeCloseTo(normal.viewportScalePxPerMm);
    expect(doble.pixelsPerSecond).toBeCloseTo(normal.pixelsPerSecond);
  });
});

describe("cadena de escalas", () => {
  it("pixelsPerMillivolt es el producto de los dos eslabones", () => {
    const metrics = computeLayoutMetrics(heightFor(100, 6), 6, "auto", SPEED);
    expect(metrics.pixelsPerMillivolt).toBeCloseTo(
      metrics.clinicalGainMmPerMv * metrics.viewportScalePxPerMm
    );
  });

  it("doblar la ganancia dobla la altura del trazo", () => {
    const normal = computeLayoutMetrics(heightFor(121, 6), 6, 10, SPEED);
    const doble = computeLayoutMetrics(heightFor(121, 6), 6, 20, SPEED);
    expect(doble.pixelsPerMillivolt).toBeCloseTo(normal.pixelsPerMillivolt * 2);
  });
});
