import { PX_PER_MM } from "./grid-layer";

/** Altura de tira por debajo de la cual la representación deja de ser óptima.
 * No es un recorte: ver `computeLayoutMetrics`. */
export const STRIP_MIN_PX = 52;
/** A partir de aquí la vista se considera holgada. */
export const STRIP_COMPACT_PX = 65;
/** Tope duro: más alto no aporta legibilidad y desperdicia pantalla. */
export const STRIP_MAX_PX = 140;
/** Hueco entre tiras. Es `--space-1`. */
export const STRIP_GAP_PX = 4;
/** Suelo absoluto de seguridad: por debajo el canvas deja de ser dibujable. */
export const STRIP_FLOOR_PX = 16;
/** Margen vertical reservado a cada lado de la línea base, en milivoltios. Con
 * 2mV la R de V5 (~1,3mV) nunca toca el borde, que es el arreglo I-2. */
export const STRIP_MARGIN_MV = 2;

export type Compression = "normal" | "compact" | "very-compact";

/** Todo lo que el renderer necesita saber sobre geometría. Se pasa entero en
 * vez de recalcular escalas en cada sitio: así no puede haber dos partes del
 * dibujo trabajando con escalas distintas. */
export interface LayoutMetrics {
  stripHeightPx: number;
  compression: Compression;
  /** Fisiología. El tamaño de la ventana no la toca jamás. */
  clinicalGainMmPerMv: number;
  /** Pantalla. Es el único eslabón que se adapta. */
  viewportScalePxPerMm: number;
  pixelsPerMillivolt: number;
  pixelsPerSecond: number;
}

function classify(stripHeightPx: number): Compression {
  if (stripHeightPx >= STRIP_COMPACT_PX) return "normal";
  if (stripHeightPx >= STRIP_MIN_PX) return "compact";
  return "very-compact";
}

/** Reparte el alto disponible entre `leadCount` derivaciones y deriva de ahí la
 * cadena de escalas mV → mm → px.
 *
 * El tope superior es duro; el inferior no existe como recorte. Un `clamp` con
 * suelo en `STRIP_MIN_PX` desbordaría la ventana con doce derivaciones en un
 * portátil, y el spec descarta tanto el scroll como ocultar derivaciones en
 * silencio: las tiras se comprimen más y `compression` lo declara para que la
 * interfaz avise. Degradación informada, no silenciosa. */
export function computeLayoutMetrics(
  availableHeightPx: number,
  leadCount: number,
  clinicalGainMmPerMv: number,
  paperSpeedMmS: number
): LayoutMetrics {
  const count = Math.max(1, Math.floor(leadCount));
  const gapsPx = STRIP_GAP_PX * (count - 1);
  const perStripPx = (availableHeightPx - gapsPx) / count;

  const stripHeightPx = Math.max(
    STRIP_FLOOR_PX,
    Math.min(STRIP_MAX_PX, perStripPx)
  );

  // La tira debe cubrir STRIP_MARGIN_MV a cada lado de la línea base, así que
  // el alto disponible fija cuántos píxeles vale un milímetro. La ganancia
  // clínica se queda fuera de este despeje: es un dato fisiológico, no una
  // consecuencia del tamaño de la ventana.
  const verticalMm = 2 * STRIP_MARGIN_MV * clinicalGainMmPerMv;
  const viewportScalePxPerMm = stripHeightPx / verticalMm;

  return {
    stripHeightPx,
    compression: classify(stripHeightPx),
    clinicalGainMmPerMv,
    viewportScalePxPerMm,
    pixelsPerMillivolt: clinicalGainMmPerMv * viewportScalePxPerMm,
    // Horizontal fijo, a propósito. Atarlo también a `viewportScale` daría
    // ~27 segundos por pantalla en compresión fuerte: ilegible.
    pixelsPerSecond: paperSpeedMmS * PX_PER_MM,
  };
}
