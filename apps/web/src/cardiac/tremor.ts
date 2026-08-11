/** Temblor continuo de una cámara que fibrila o aletea.
 *
 * Suma de tres senoides en relación no armónica: el resultado no se repite en
 * una escala visible pero es determinista, y determinista importa porque el
 * reloj puede retroceder —al reiniciar una sesión— y un ruido con estado
 * daría un salto visible al hacerlo.
 *
 * No es un modelo de nada. Una fibrilación no se anima con eventos porque no
 * los tiene: lo que se ve es una masa que tiembla, y esto es lo que produce
 * ese aspecto sin fingir una fisiología que el motor no calcula. */
export function tremorExcursion(tS: number, hz: number, amplitude: number): number {
  const raw =
    Math.sin(2 * Math.PI * hz * tS) * 0.55 +
    Math.sin(2 * Math.PI * hz * 1.73 * tS + 1.1) * 0.3 +
    Math.sin(2 * Math.PI * hz * 2.41 * tS + 2.7) * 0.15;
  return raw * amplitude;
}
