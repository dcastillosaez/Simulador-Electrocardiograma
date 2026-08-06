/** Lo que hace falta saber de la pantalla para traducir una distancia a
 * unidades clínicas. La velocidad de papel es la VIGENTE, no la de referencia:
 * con el zoom a 50 mm/s el mismo intervalo ocupa el doble de cuadros, y decir
 * lo contrario sería mentir sobre lo que se está viendo. */
export interface MeasureContext {
  sampleRateHz: number;
  paperSpeedMmS: number;
  clinicalGainMmPerMv: number;
}

export interface CaliperReadout {
  deltaMs: number;
  /** Con signo: una depresión del ST no es lo mismo que una elevación. */
  deltaMv: number;
  /** `null` cuando las dos marcas caen en la misma muestra. Dividir entre cero
   * daría Infinity, que se pintaría como un número y no lo es. */
  equivalentBpm: number | null;
  smallSquares: number;
  largeSquares: number;
  /** Altura en cuadros pequeños. Magnitud, sin signo: es una altura. */
  amplitudeSquares: number;
}

/** Distancia entre dos marcas, en las unidades en que se lee un ECG.
 *
 * Δt se calcula restando ÍNDICES DE MUESTRA, no timestamps: es aritmética
 * entera y el resultado es exacto. Restar dos flotantes de segundos arrastraría
 * el error de la conversión hasta el número que se enseña. */
export function caliperReadout(
  aSampleIndex: number,
  aVoltageV: number,
  bSampleIndex: number,
  bVoltageV: number,
  ctx: MeasureContext
): CaliperReadout {
  const deltaSamples = Math.abs(bSampleIndex - aSampleIndex);
  const deltaS = deltaSamples / ctx.sampleRateHz;
  const deltaMv = (bVoltageV - aVoltageV) * 1000;
  const smallSquares = deltaS * ctx.paperSpeedMmS;

  return {
    deltaMs: deltaS * 1000,
    deltaMv,
    equivalentBpm: deltaS === 0 ? null : 60 / deltaS,
    smallSquares,
    largeSquares: smallSquares / 5,
    amplitudeSquares: Math.abs(deltaMv) * ctx.clinicalGainMmPerMv,
  };
}

/** Los formateadores viven aquí y no en cada consumidor porque hay dos: el
 * rótulo que se dibuja en el canvas y el panel del inspector que lee el lector
 * de pantalla. Si divergen, la interfaz y la accesibilidad dicen cosas
 * distintas sobre la misma medida. */
const NO_VALUE = "—";

export function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

export function formatMv(mv: number): string {
  const sign = mv < 0 ? "-" : "+";
  return `${sign}${Math.abs(mv).toFixed(2)} mV`;
}

export function formatBpm(bpm: number | null): string {
  if (bpm === null) return NO_VALUE;
  // Un decimal por debajo de 100, entero por encima: a 366 lpm la décima es
  // ruido, a 69,8 distingue dos ritmos.
  return bpm >= 100 ? `${Math.round(bpm)} lpm` : `${bpm.toFixed(1)} lpm`;
}

export function formatSquares(squares: number): string {
  return squares.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(3)} s`;
}
