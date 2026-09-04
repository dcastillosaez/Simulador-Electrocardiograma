import { describe, expect, it } from "vitest";
import { PX_PER_MM } from "./grid-layer";
import {
  COLUMN_GAP_PX,
  GAIN_STEPS_MM_PER_MV,
  VIEWPORT_WIDTH_MM,
  STRIP_COMPACT_PX,
  STRIP_FLOOR_PX,
  STRIP_GAP_PX,
  STRIP_MARGIN_MV,
  STRIP_MAX_PX,
  STRIP_MIN_PX,
  computeLayoutMetrics,
  stripCeilingPx,
  MIN_SCALE_PX_PER_MM,
  STANDARD_STRIP_HEIGHT_MM,
} from "./layout-engine";

const SPEED = 25;
/** Los mismos diez segundos de antes, ahora derivados: la constante del
 * sistema es el ancho de papel y los segundos salen de dividirlo por la
 * velocidad. Ninguna asercion numerica de este fichero cambia de valor. */
const SCREEN_SECONDS = VIEWPORT_WIDTH_MM / SPEED;
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

/** Alto que deja a cada tira lo que ocupa el rango clinico a ganancia
 * estandar y escala de referencia: con esto la escala la manda el ancho, que
 * es el caso de partida de casi todas las pruebas. */
function roomyHeight(rowCount: number): number {
  return heightFor(stripCeilingPx(PX_PER_MM), rowCount);
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
    expect(metrics.stripHeightPx).toBeCloseTo(stripCeilingPx(PX_PER_MM));
  });

  it("el tope crece con la escala, porque son 40mm y no 152px", () => {
    // El defecto que esto arregla: el tope era una constante en pixeles de
    // 96dpi mientras la escala sale del ancho disponible. En un area ancha el
    // milimetro mide mas, el rango clinico a ganancia estandar ya no cabia en
    // 152px, y la vista se quedaba en media ganancia con toda la altura de la
    // ventana libre.
    const ancha = metricsFor(2000, 1, "auto", { availableWidthPx: WIDTH * 2 });
    expect(ancha.viewportScalePxPerMm).toBeCloseTo(PX_PER_MM * 2);
    expect(ancha.stripHeightPx).toBeCloseTo(stripCeilingPx(PX_PER_MM * 2));
    expect(ancha.clinicalGainMmPerMv).toBe(10);
    expect(ancha.gainFits).toBe(true);
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
    expect(metricsFor(300, 1, "auto").stripHeightPx).toBeCloseTo(
      stripCeilingPx(PX_PER_MM)
    );
  });
});

describe("cuadricula cuadrada", () => {
  it("un milimetro mide lo mismo en los dos ejes, siempre", () => {
    // ES EL ARREGLO. Antes la escala vertical se estiraba para llenar la tira
    // mientras la horizontal seguia fija, y la rejilla se dibujaba con la
    // vertical: daba 6,25 cuadros grandes por segundo en vez de 5, un 25% de
    // error al medir un RR sobre el papel. Ahora el milimetro es el milimetro
    // y lo que se adapta es la ganancia.
    // Que la escala pueda encoger con el alto no rompe el invariante: sea
    // cual sea, es UNA sola y gobierna los dos ejes.
    for (const stripPx of [16, 46, 70, 121, 140]) {
      const metrics = metricsFor(heightFor(stripPx, 6), 6, "auto");
      expect(metrics.pixelsPerSecond, `${stripPx}px`).toBeCloseTo(
        SPEED * metrics.viewportScalePxPerMm
      );
    }
    expect(metricsFor(roomyHeight(6), 6, "auto").viewportScalePxPerMm).toBeCloseTo(
      PX_PER_MM
    );
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

  it("el eje horizontal no depende de la ganancia", () => {
    const normal = metricsFor(roomyHeight(6), 6, 10);
    const doble = metricsFor(roomyHeight(6), 6, 20);
    expect(doble.pixelsPerSecond).toBeCloseTo(normal.pixelsPerSecond);
    expect(normal.pixelsPerSecond).toBeCloseTo(SPEED * PX_PER_MM);
  });

  it("con poco alto encoge el papel entero, no solo el trazo", () => {
    // El precio de conservar la ganancia estandar: cuando el alto no da, el
    // milimetro mide menos y el papel se dibuja mas pequeno. Los dos ejes
    // encogen a la vez, que es lo que mantiene la cuadricula cuadrada; lo que
    // NO cambia es cuanto papel se ve: siguen siendo 250mm.
    const baja = metricsFor(heightFor(46, 12), 12, "auto");
    const holgada = metricsFor(roomyHeight(12), 12, "auto");
    expect(baja.viewportScalePxPerMm).toBeLessThan(holgada.viewportScalePxPerMm);
    expect(baja.pixelsPerSecond).toBeLessThan(holgada.pixelsPerSecond);
    expect(baja.stripWidthPx / baja.pixelsPerSecond).toBeCloseTo(SCREEN_SECONDS);
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

    // Con la tira mas estrecha ya no se baja la ganancia: se encoge el papel.
    // La ganancia estandar es la que se lee en cualquier equipo y es lo
    // ultimo que se sacrifica.
    const justa = metricsFor(heightFor(80, 6), 6, "auto");
    expect(justa.clinicalGainMmPerMv).toBe(10);
    expect(justa.viewportScalePxPerMm).toBeLessThan(PX_PER_MM);
  });

  it("solo baja la ganancia cuando el papel ya no puede encoger mas", () => {
    const gainAt = (stripPx: number) =>
      metricsFor(heightFor(stripPx, 6), 6, "auto").clinicalGainMmPerMv;
    // El punto de ruptura: por debajo de este alto, ni al minimo de escala
    // caben los 40mm de tira.
    const floorPx = MIN_SCALE_PX_PER_MM * STANDARD_STRIP_HEIGHT_MM;

    expect(gainAt(1000)).toBe(10); // el tope de tira impide llegar a 20
    expect(gainAt(Math.ceil(floorPx) + 1)).toBe(10);
    expect(gainAt(Math.floor(floorPx) - 5)).toBe(5);
    expect(gainAt(30)).toBe(2.5);
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
    expect(metrics.pixelsPerSecond).toBeCloseTo(
      SPEED * metrics.viewportScalePxPerMm
    );
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
    const metrics = metricsFor(roomyHeight(6), 6, "auto", { columnCount: 2 });
    expect(metrics.stripWidthPx).toBeCloseTo((WIDTH - COLUMN_GAP_PX) / 2);
  });

  it("lo que el ECG no necesita a lo ancho no se rellena estirando", () => {
    // Es lo que hace sitio al corazon: con el alto justo, el papel encoge y
    // el ECG ocupa menos de lo disponible. Antes se estiraba hasta el borde y
    // ese ancho de mas era exactamente lo que impedia la ganancia estandar.
    const metrics = metricsFor(heightFor(80, 6), 6, "auto");
    expect(metrics.ecgWidthPx).toBeLessThan(WIDTH);
    expect(metrics.ecgWidthPx).toBeCloseTo(metrics.stripWidthPx);
    expect(metrics.clinicalGainMmPerMv).toBe(10);
  });

  it("el ancho ocupado cuenta las columnas y sus huecos", () => {
    const metrics = metricsFor(roomyHeight(6), 6, "auto", { columnCount: 2 });
    expect(metrics.ecgWidthPx).toBeCloseTo(
      metrics.stripWidthPx * 2 + COLUMN_GAP_PX
    );
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
    const ancha = metricsFor(roomyHeight(6) * 2, 6, "auto", {
      availableWidthPx: WIDTH * 2,
    });
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

describe("velocidad de papel", () => {
  it("a 25mm/s la tira muestra los diez segundos de siempre", () => {
    const metrics = metricsFor(600, 6, "auto");
    expect(metrics.stripSeconds).toBe(10);
  });

  it("al doblar la velocidad se ve la mitad de tiempo", () => {
    const metrics = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 50,
    });
    expect(metrics.stripSeconds).toBe(5);
  });

  it("a 100mm/s se ven 2,5 segundos", () => {
    const metrics = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 100,
    });
    expect(metrics.stripSeconds).toBe(2.5);
  });

  it("el cuadro pequeno conserva su tamano fisico al cambiar la velocidad", () => {
    // Es la diferencia entre velocidad de papel y zoom optico, y la razon de
    // ser de todo el diseno: contar cuadros tiene que seguir siendo exacto.
    const lenta = metricsFor(600, 6, "auto");
    const rapida = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 100,
    });
    expect(rapida.viewportScalePxPerMm).toBeCloseTo(lenta.viewportScalePxPerMm);
    expect(rapida.pixelsPerMillivolt).toBeCloseTo(lenta.pixelsPerMillivolt);
  });

  it("al cuadruplicar la velocidad, un segundo ocupa cuatro veces mas pixeles", () => {
    const lenta = metricsFor(600, 6, "auto");
    const rapida = computeLayoutMetrics({
      availableWidthPx: WIDTH,
      availableHeightPx: 600,
      rowCount: 6,
      columnCount: 1,
      gain: "auto",
      paperSpeedMmS: 100,
    });
    expect(rapida.pixelsPerSecond).toBeCloseTo(lenta.pixelsPerSecond * 4);
  });
});
