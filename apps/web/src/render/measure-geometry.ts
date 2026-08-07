import { COLUMN_GAP_PX, STRIP_GAP_PX, type LayoutMetrics } from "./layout-engine";
import type { LeadName } from "./layout";

/** Qué trozo del anillo se está viendo.
 *
 * Con el zoom a la velocidad de referencia la ventana es el anillo entero. Al
 * subir la velocidad de papel el anillo no cambia de tamaño: se enseña menos.
 * Por eso la ventana es una vista y no una recaptura. */
export interface TraceView {
  /** Posición del anillo que se dibuja en x = 0. */
  startRingPos: number;
  /** Muestras que caben a lo ancho de la tira. */
  visibleSamples: number;
}

export interface StripLayout {
  leadColumns: readonly (readonly LeadName[])[];
  metrics: LayoutMetrics;
}

export interface StripHit {
  lead: LeadName;
  column: number;
  row: number;
  /** Coordenadas relativas a la esquina de la tira, no al display. */
  xInStrip: number;
  yInStrip: number;
}

export function fullView(capacity: number): TraceView {
  return { startRingPos: 0, visibleSamples: capacity };
}

/** Píxeles que ocupa una muestra. Se calcula una vez y se pasa: derivarlo en
 * cada conversión es cómo se acaban teniendo dos escalas en la misma pantalla. */
export function pxPerSample(metrics: LayoutMetrics, sampleRateHz: number): number {
  return metrics.pixelsPerSecond / sampleRateHz;
}

export function ringPosToPx(
  ringPos: number,
  view: TraceView,
  pxPerSampleValue: number,
  capacity: number
): number {
  return wrap(ringPos - view.startRingPos, capacity) * pxPerSampleValue;
}

/** Muestra más cercana a esa columna de píxeles.
 *
 * Es un redondeo con consecuencias: a la escala de referencia cada píxel
 * contiene unas seis muestras, así que la pantalla no puede distinguirlas y
 * hay que elegir una. Se elige la del centro del píxel. */
export function pxToRingPos(
  xPx: number,
  view: TraceView,
  pxPerSampleValue: number,
  capacity: number
): number {
  return wrap(view.startRingPos + Math.round(xPx / pxPerSampleValue), capacity);
}

/** Voltios en esa altura de la tira, respecto a la línea de 0 mV.
 *
 * En voltios y no en milivoltios: los módulos de cálculo trabajan en SI, como
 * el motor, y la conversión ocurre en un solo sitio, al formatear. */
export function pxToVoltage(
  yInStrip: number,
  stripHeightPx: number,
  metrics: LayoutMetrics
): number {
  return (stripHeightPx / 2 - yInStrip) / metrics.pixelsPerMillivolt / 1000;
}

/** Qué tira hay bajo ese punto del canvas de overlay, o `null` si es un hueco.
 *
 * Los huecos devuelven `null` a propósito: colocar una marca en la separación
 * entre dos derivaciones no significa nada, y asignarla a la de al lado sería
 * medir en una derivación distinta de la que el usuario está mirando. */
export function hitTest(
  xPx: number,
  yPx: number,
  layout: StripLayout
): StripHit | null {
  const { stripWidthPx, stripHeightPx } = layout.metrics;

  const columnPitch = stripWidthPx + COLUMN_GAP_PX;
  const column = Math.floor(xPx / columnPitch);
  const xInStrip = xPx - column * columnPitch;
  if (column < 0 || column >= layout.leadColumns.length) return null;
  if (xInStrip < 0 || xInStrip >= stripWidthPx) return null;

  const rowPitch = stripHeightPx + STRIP_GAP_PX;
  const row = Math.floor(yPx / rowPitch);
  const yInStrip = yPx - row * rowPitch;
  const leads = layout.leadColumns[column];
  if (row < 0 || row >= leads.length) return null;
  if (yInStrip < 0 || yInStrip >= stripHeightPx) return null;

  return { lead: leads[row], column, row, xInStrip, yInStrip };
}

function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
