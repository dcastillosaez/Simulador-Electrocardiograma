import { describe, expect, it } from "vitest";
import { PX_PER_MM } from "./grid-layer";
import {
  COLUMN_GAP_PX,
  GAIN_STEPS_MM_PER_MV,
  SCREEN_SECONDS,
  STRIP_COMPACT_PX,
  STRIP_FLOOR_PX,
  STRIP_GAP_PX,
  STRIP_MARGIN_MV,
  STRIP_MAX_PX,
  STRIP_MIN_PX,
  computeLayoutMetrics,
} from "./layout-engine";

const SPEED = 25;
/** Ancho que hace que un milimetro mida PX_PER_MM, para que los tests puedan
 * seguir razonando en la escala fisica de referencia. */
const WIDTH = SCREEN_SECONDS * SPEED * PX_PER_MM;

/** Envoltorio: la mayoria de los tests solo varian alto, filas y ganancia. */
function metricsFor(
  availableHeightPx: number,
  rowCount: number,
  gain: "auto" | number,
  options: { columnCount?: number; availableWidthPx?: number } = {}
) {
  return computeLayoutMetrics({
    availableWidthPx: options.availableWidthPx ?? WIDTH,
    availableHeightPx,
    rowCount,
    columnCount: options.columnCount ?? 1,
    gain,
    paperSpeedMmS: SPEED,
  });
}

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
    const metrics = metricsFor(heightFor(70, 12), 12, "auto");
    expect(metrics.stripHeightPx).toBeCloseTo(70);
  });

  it("nunca pasa del maximo, aunque sobre alto", () => {
    const metrics = metricsFor(heightFor(400, 3), 3, "auto");
    expect(metrics.stripHeightPx).toBe(STRIP_MAX_PX);
  });

  it("el minimo es blando: por debajo de 52px sigue comprimiendo, no recorta", () => {
    const metrics = metricsFor(heightFor(46, 12), 12, "auto");
    expect(metrics.stripHeightPx).toBeCloseTo(46);
    expect(metrics.stripHeightPx).toBeLessThan(STRIP_MIN_PX);
  });

  it("respeta un suelo absoluto para no crear canvas degenerados", () => {
    expect(metricsFor(12, 12, "auto").stripHeightPx).toBe(STRIP_FLOOR_PX);
  });

  it("clasifica la compresion en las tres fronteras", () => {
    const at = (stripPx: number, leads = 12) =>
      metricsFor(heightFor(stripPx, leads), leads, "auto").compression;

    expect(at(STRIP_COMPACT_PX)).toBe("normal");
    expect(at(STRIP_COMPACT_PX - 1)).toBe("compact");
    expect(at(STRIP_MIN_PX)).toBe("compact");
    expect(at(STRIP_MIN_PX - 1)).toBe("very-compact");
  });

  it("una sola derivacion no descuenta huecos", () => {
    expect(metricsFor(300, 1, "auto").stripHeightPx).toBe(STRIP_MAX_PX);
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
      const metrics = metricsFor(heightFor(stripPx, 6), 6, "auto");
      expect(metrics.viewportScalePxPerMm, `${stripPx}px`).toBeCloseTo(PX_PER_MM);
    }
  });

  it("a 25mm/s un segundo son exactamente cinco cuadros grandes", () => {
    // La comprobacion que hace un clinico con el dedo sobre la pantalla.
    const metrics = metricsFor(heightFor(121, 6), 6, "auto");
    const bigSquarePx = 5 * metrics.viewportScalePxPerMm;
    expect(metrics.pixelsPerSecond / bigSquarePx).toBeCloseTo(5);
  });

  it("un cuadro pequeno son 40ms, la lectura de toda la vida", () => {
    const metrics = metricsFor(heightFor(121, 6), 6, "auto");
    const smallSquareS = metrics.viewportScalePxPerMm / metrics.pixelsPerSecond;
    expect(smallSquareS).toBeCloseTo(0.04);
  });

  it("el eje horizontal no depende del alto de tira ni de la ganancia", () => {
    const alta = metricsFor(heightFor(140, 3), 3, "auto");
    const baja = metricsFor(heightFor(46, 12), 12, "auto");
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
    const holgada = metricsFor(heightFor(STRIP_MAX_PX, 6), 6, "auto");
    expect(holgada.clinicalGainMmPerMv).toBe(10);
    expect(STRIP_MAX_PX).toBeGreaterThanOrEqual(heightForGain(10));

    const justa = metricsFor(heightFor(80, 6), 6, "auto");
    expect(justa.clinicalGainMmPerMv).toBe(5);
  });

  it("baja escalon a escalon segun se estrecha la tira", () => {
    const gainAt = (stripPx: number) =>
      metricsFor(heightFor(stripPx, 6), 6, "auto").clinicalGainMmPerMv;

    expect(gainAt(1000)).toBe(10); // el tope de tira impide llegar a 20
    expect(gainAt(90)).toBe(5);
    expect(gainAt(40)).toBe(2.5);
  });

  it("nunca baja del escalon mas pequeno, aunque no quepa", () => {
    // Con doce derivaciones en una ventana diminuta no cabe ni a 2,5mm/mV.
    // Recortar es preferible a inventar una ganancia que no existe en ningun
    // equipo: el numero que se lee en pantalla tiene que ser uno real.
    const metrics = metricsFor(12, 12, "auto");
    expect(metrics.clinicalGainMmPerMv).toBe(Math.min(...GAIN_STEPS_MM_PER_MV));
  });

  it("se declara como automatica", () => {
    const metrics = metricsFor(heightFor(121, 6), 6, "auto");
    expect(metrics.gainIsAuto).toBe(true);
    // En automatico siempre cabe salvo en el suelo, asi que no hay aviso.
    expect(metrics.gainFits).toBe(true);
  });
});

describe("ganancia manual", () => {
  it("respeta la que fija el usuario aunque quepa una mayor", () => {
    const metrics = metricsFor(heightFor(140, 3), 3, 2.5);
    expect(metrics.clinicalGainMmPerMv).toBe(2.5);
    expect(metrics.gainIsAuto).toBe(false);
  });

  it("avisa cuando la ganancia elegida no cabe, pero la aplica igual", () => {
    // El usuario manda. Un equipo real tampoco impide subir la ganancia: la
    // sube y la señal se sale por arriba. Lo que no puede pasar es que se
    // altere la escala temporal para disimularlo.
    const metrics = metricsFor(heightFor(50, 12), 12, 20);
    expect(metrics.clinicalGainMmPerMv).toBe(20);
    expect(metrics.gainFits).toBe(false);
    expect(metrics.pixelsPerSecond).toBeCloseTo(SPEED * PX_PER_MM);
  });

  it("la ganancia manual no toca la cuadricula", () => {
    const normal = metricsFor(heightFor(121, 6), 6, 10);
    const doble = metricsFor(heightFor(121, 6), 6, 20);
    expect(doble.viewportScalePxPerMm).toBeCloseTo(normal.viewportScalePxPerMm);
    expect(doble.pixelsPerSecond).toBeCloseTo(normal.pixelsPerSecond);
  });
});

describe("cadena de escalas", () => {
  it("pixelsPerMillivolt es el producto de los dos eslabones", () => {
    const metrics = metricsFor(heightFor(100, 6), 6, "auto");
    expect(metrics.pixelsPerMillivolt).toBeCloseTo(
      metrics.clinicalGainMmPerMv * metrics.viewportScalePxPerMm
    );
  });

  it("doblar la ganancia dobla la altura del trazo", () => {
    const normal = metricsFor(heightFor(121, 6), 6, 10);
    const doble = metricsFor(heightFor(121, 6), 6, 20);
    expect(doble.pixelsPerMillivolt).toBeCloseTo(normal.pixelsPerMillivolt * 2);
  });
});

describe("segundos por pantalla", () => {
  it("una tira a una columna muestra la tira de ritmo estandar", () => {
    // Diez segundos es lo que se imprime y lo que se mira para contar una
    // arritmia. Antes dependia del ancho de la ventana: dos personas con
    // monitores distintos veian trazados distintos.
    const metrics = metricsFor(600, 6, "auto");
    expect(metrics.stripSeconds).toBe(SCREEN_SECONDS);
    expect(metrics.stripWidthPx / metrics.pixelsPerSecond).toBeCloseTo(SCREEN_SECONDS);
  });

  it("a dos columnas cada tira muestra la mitad de tiempo", () => {
    const metrics = metricsFor(600, 6, "auto", { columnCount: 2 });
    expect(metrics.stripSeconds).toBe(SCREEN_SECONDS / 2);
  });

  it("las dos columnas se reparten el ancho descontando el hueco", () => {
    const metrics = metricsFor(600, 6, "auto", { columnCount: 2 });
    expect(metrics.stripWidthPx).toBeCloseTo((WIDTH - COLUMN_GAP_PX) / 2);
  });

  it("el formato partido NO comprime: la escala es la misma", () => {
    // Es la propiedad que hace que el split sea util. Ancho de columna y
    // segundos por tira se dividen los dos entre el numero de columnas, asi
    // que el milimetro mide igual. Si comprimiese, el trazado partido seria
    // ilegible y la cuadricula dejaria de casar con la de la vista normal.
    const unaColumna = metricsFor(600, 6, "auto");
    const dosColumnas = metricsFor(600, 6, "auto", {
      columnCount: 2,
      availableWidthPx: WIDTH + COLUMN_GAP_PX,
    });
    expect(dosColumnas.viewportScalePxPerMm).toBeCloseTo(
      unaColumna.viewportScalePxPerMm
    );
    expect(dosColumnas.pixelsPerSecond).toBeCloseTo(unaColumna.pixelsPerSecond);
  });

  it("la escala sale del ancho, no de una suposicion de 96dpi", () => {
    // Con un area el doble de ancha, el milimetro vale el doble de pixeles y
    // se siguen viendo exactamente diez segundos.
    const ancha = metricsFor(600, 6, "auto", { availableWidthPx: WIDTH * 2 });
    expect(ancha.viewportScalePxPerMm).toBeCloseTo(PX_PER_MM * 2);
    expect(ancha.stripWidthPx / ancha.pixelsPerSecond).toBeCloseTo(SCREEN_SECONDS);
  });

  it("la cuadricula sigue cuadrando sea cual sea el ancho", () => {
    // La garantia que no se puede perder: un segundo son cinco cuadros
    // grandes, valga lo que valga el milimetro en pixeles.
    for (const width of [400, WIDTH, 1600]) {
      for (const columns of [1, 2]) {
        const m = metricsFor(600, 6, "auto", {
          columnCount: columns,
          availableWidthPx: width,
        });
        const bigSquarePx = 5 * m.viewportScalePxPerMm;
        expect(m.pixelsPerSecond / bigSquarePx, `${width}px/${columns}col`).toBeCloseTo(5);
      }
    }
  });
});
