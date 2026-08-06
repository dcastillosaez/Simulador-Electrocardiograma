import { PX_PER_MM } from "./grid-layer";

/** Altura de tira por debajo de la cual la representación deja de ser óptima.
 * No es un recorte: ver `computeLayoutMetrics`. */
export const STRIP_MIN_PX = 52;
/** A partir de aquí la vista se considera holgada. */
export const STRIP_COMPACT_PX = 65;
/** Margen vertical que se quiere reservar a cada lado de la línea base, en
 * milivoltios. Con 2mV la R de V5 (~1,3mV) no toca el borde. Ya no fija la
 * escala: fija qué ganancia se elige en automático. */
export const STRIP_MARGIN_MV = 2;

/** Ganancia estándar de un electrocardiógrafo. */
const STANDARD_GAIN_MM_PER_MV = 10;

/** Tope duro de altura de tira.
 *
 * No es un número redondo elegido a ojo: es exactamente lo que ocupa el rango
 * clínico completo (`STRIP_MARGIN_MV` a cada lado) a ganancia estándar y
 * escala real. Por encima de eso la tira solo añade papel en blanco.
 *
 * El valor anterior, 140px, era arbitrario y tenía una consecuencia que nadie
 * había mirado: como 10mm/mV necesita 152px, ninguna tira llegaba nunca a la
 * ganancia estándar. La vista se habría quedado permanentemente en media
 * ganancia sin que hubiera un motivo clínico para ello. */
export const STRIP_MAX_PX = Math.ceil(
  2 * STRIP_MARGIN_MV * STANDARD_GAIN_MM_PER_MV * PX_PER_MM
);
/** Hueco entre tiras. Es `--space-1`. */
export const STRIP_GAP_PX = 4;
/** Suelo absoluto de seguridad: por debajo el canvas deja de ser dibujable. */
export const STRIP_FLOOR_PX = 16;

/** Ganancias de un electrocardiógrafo, de mayor a menor.
 *
 * Son las del equipo real y no una escala continua a propósito: el número que
 * aparece en pantalla tiene que ser uno que el alumno vaya a reconocer cuando
 * se ponga delante de una máquina. 10mm/mV es lo normal; 5 es «media
 * ganancia», lo que se pone cuando el QRS se sale; 20 es «doble ganancia»,
 * para complejos de bajo voltaje. */
export const GAIN_STEPS_MM_PER_MV = [20, 10, 5, 2.5] as const;

/** Ganancia vertical: `"auto"` la decide el reparto de altura, un número la
 * fija el usuario. */
export type GainSetting = "auto" | number;

/** Velocidad de papel de referencia: la estándar de un electrocardiógrafo.
 *
 * Es la que fija la escala de la pantalla. El zoom temporal la sube a 50 o 100
 * sin que la rejilla cambie de tamaño: lo que cambia es cuánto tiempo cabe. */
export const REFERENCE_PAPER_SPEED_MM_S = 25;

/** Ancho de papel que muestra la pantalla completa, en milímetros.
 *
 * Antes esta constante eran diez segundos. Que fueran segundos era un
 * accidente: en un electrocardiógrafo la constante es el papel y los segundos
 * salen de dividirlo por la velocidad. 250 mm son exactamente los mismos diez
 * segundos a 25 mm/s, dichos en las unidades correctas — y así el zoom
 * temporal es una división más, no un caso especial.
 *
 * Fijarlo —en vez de dejar que dependa del ancho de la ventana— hace que dos
 * personas con monitores distintos vean lo mismo. */
export const VIEWPORT_WIDTH_MM = 250;

/** Hueco entre columnas en el formato de dos columnas. Es `--space-2`. */
export const COLUMN_GAP_PX = 8;

export type Compression = "normal" | "compact" | "very-compact";

/** Todo lo que el renderer necesita saber sobre geometría. Se pasa entero en
 * vez de recalcular escalas en cada sitio: así no puede haber dos partes del
 * dibujo trabajando con escalas distintas. */
export interface LayoutMetrics {
  stripHeightPx: number;
  /** Ancho de UNA tira. Con dos columnas es la mitad del área, menos el
   * hueco. */
  stripWidthPx: number;
  /** Segundos que muestra cada tira. Diez a una columna, cinco a dos: el
   * split no comprime, enseña la mitad de tiempo en la mitad de ancho. */
  stripSeconds: number;
  compression: Compression;
  /** Ganancia efectiva. En automático, la mayor que cabe. */
  clinicalGainMmPerMv: number;
  /** Si la ha decidido el sistema o la ha fijado el usuario. */
  gainIsAuto: boolean;
  /** `false` cuando la ganancia elegida a mano no cabe en la tira y el trazo
   * se va a recortar. La interfaz lo avisa; no se corrige por detrás. */
  gainFits: boolean;
  /** Píxeles por milímetro de papel. **El mismo en los dos ejes**: es lo que
   * hace que la cuadrícula sea cuadrada y que medir sobre ella sea correcto. */
  viewportScalePxPerMm: number;
  pixelsPerMillivolt: number;
  pixelsPerSecond: number;
}

function classify(stripHeightPx: number): Compression {
  if (stripHeightPx >= STRIP_COMPACT_PX) return "normal";
  if (stripHeightPx >= STRIP_MIN_PX) return "compact";
  return "very-compact";
}

/** Milivoltios representables a cada lado de la línea base. */
function halfRangeMv(
  stripHeightPx: number,
  gainMmPerMv: number,
  scalePxPerMm: number
): number {
  return stripHeightPx / (2 * scalePxPerMm * gainMmPerMv);
}

/** La mayor ganancia estándar con la que `STRIP_MARGIN_MV` cabe a cada lado.
 *
 * Si no cabe ni con la más pequeña se devuelve esa: recortar es preferible a
 * inventar una ganancia intermedia que no existe en ningún equipo. */
function autoGain(stripHeightPx: number, scalePxPerMm: number): number {
  for (const gain of GAIN_STEPS_MM_PER_MV) {
    if (halfRangeMv(stripHeightPx, gain, scalePxPerMm) >= STRIP_MARGIN_MV) {
      return gain;
    }
  }
  return GAIN_STEPS_MM_PER_MV[GAIN_STEPS_MM_PER_MV.length - 1];
}

/** Reparte el alto disponible entre `leadCount` derivaciones y deriva de ahí la
 * cadena de escalas mV → mm → px.
 *
 * **El milímetro es el milímetro en los dos ejes.** Antes la escala vertical se
 * estiraba para llenar la tira mientras la horizontal seguía fija en
 * `PX_PER_MM`, y la rejilla se dibujaba con la vertical: el resultado era una
 * cuadrícula que mentía en el eje del tiempo —6,25 cuadros grandes por segundo
 * en vez de 5, un 25% de error al medir un RR sobre el papel—. En algo docente
 * eso enseña a medir mal, que es peor que no medir.
 *
 * Lo que se adapta es la ganancia, exactamente como en un electrocardiógrafo:
 * si la amplitud no cabe se baja a media ganancia y se declara en pantalla. La
 * velocidad del papel no se toca jamás.
 *
 * El tope superior de tira es duro; el inferior no existe como recorte. Un
 * `clamp` con suelo en `STRIP_MIN_PX` desbordaría la ventana con doce
 * derivaciones en un portátil, y el spec descarta tanto el scroll como ocultar
 * derivaciones en silencio: las tiras se comprimen más y `compression` lo
 * declara. Degradación informada, no silenciosa. */
export interface LayoutInput {
  availableWidthPx: number;
  availableHeightPx: number;
  /** Filas visibles, no derivaciones: en `"6x2"` son seis con doce
   * derivaciones. */
  rowCount: number;
  columnCount: number;
  gain: GainSetting;
  paperSpeedMmS: number;
}

export function computeLayoutMetrics({
  availableWidthPx,
  availableHeightPx,
  rowCount,
  columnCount,
  gain,
  paperSpeedMmS,
}: LayoutInput): LayoutMetrics {
  const rows = Math.max(1, Math.floor(rowCount));
  const columns = Math.max(1, Math.floor(columnCount));

  const gapsPx = STRIP_GAP_PX * (rows - 1);
  const perStripPx = (availableHeightPx - gapsPx) / rows;
  const stripHeightPx = Math.max(
    STRIP_FLOOR_PX,
    Math.min(STRIP_MAX_PX, perStripPx)
  );

  const stripWidthPx = Math.max(
    1,
    (availableWidthPx - COLUMN_GAP_PX * (columns - 1)) / columns
  );
  // El ancho de papel por tira es la constante; los segundos son consecuencia
  // de la velocidad. A la velocidad de referencia esto da exactamente lo mismo
  // que la formulación anterior en segundos fijos: regresión cero.
  const viewportWidthMm = VIEWPORT_WIDTH_MM / columns;

  // LA ESCALA SALE DEL ANCHO, no de una suposición de 96dpi, y **no depende de
  // la velocidad de papel**: subirla no agranda la rejilla, muestra menos
  // tiempo. Lo importante —y lo que arregló el defecto de la cuadrícula— es
  // que esta misma escala gobierne los DOS ejes: mientras eso se cumpla, la
  // celda es cuadrada, un segundo son cinco cuadros grandes y medir contando
  // cuadros es exacto, valga lo que valga el milímetro en píxeles.
  //
  // Como el ancho de columna y el ancho de papel se dividen los dos entre el
  // número de columnas, la escala es la MISMA en una columna que en dos: el
  // formato partido no comprime el trazado, solo enseña menos tiempo.
  const viewportScalePxPerMm = stripWidthPx / viewportWidthMm;
  const stripSeconds = viewportWidthMm / paperSpeedMmS;

  const gainIsAuto = gain === "auto";
  const clinicalGainMmPerMv = gainIsAuto
    ? autoGain(stripHeightPx, viewportScalePxPerMm)
    : gain;

  return {
    stripHeightPx,
    stripWidthPx,
    stripSeconds,
    compression: classify(stripHeightPx),
    clinicalGainMmPerMv,
    gainIsAuto,
    gainFits:
      halfRangeMv(stripHeightPx, clinicalGainMmPerMv, viewportScalePxPerMm) >=
      STRIP_MARGIN_MV,
    viewportScalePxPerMm,
    pixelsPerMillivolt: clinicalGainMmPerMv * viewportScalePxPerMm,
    pixelsPerSecond: paperSpeedMmS * viewportScalePxPerMm,
  };
}
