/** Cuánto tarda una válvula en pasar de cerrada a abierta, en segundos.
 *
 * Una válvula cardíaca no se abre despacio: la mueve un gradiente de presión
 * que se invierte en decenas de milisegundos, y por eso hay un ruido cardíaco
 * cuando se cierra. Treinta milisegundos es lo que tarda una valva sana, y es
 * además lo bastante corto para que quepa dentro de la contracción
 * isovolumétrica: si el movimiento durara más que esa fase, la mitral aún
 * estaría cerrándose cuando la aórtica ya se ha abierto, y las dos ventanas
 * con las cuatro válvulas cerradas —que son el motivo de que el servidor mande
 * cuatro instantes y no dos— dejarían de verse.
 */
export const VALVE_TRANSITION_S = 0.03;

/** Un pulso con flancos suaves: 0 antes de `riseS`, 1 entre los dos instantes
 * y 0 otra vez después de `fallS`.
 *
 * Los flancos son cosenos alzados y no rampas por el mismo motivo que la curva
 * de contracción: la derivada es nula en los extremos, así que la valva
 * arranca y se para sin tirón. Con rampas lineales daría un golpe seco al
 * final del recorrido, que es el aspecto de "animación de programador" que el
 * spec descarta.
 *
 * Es presentación, no fisiología: cuándo se abre y cuándo se cierra lo decide
 * el servidor y llega en el evento; cómo transcurre el viaje entre esos dos
 * instantes se resuelve aquí, sesenta veces por segundo, sin viajar por la
 * red.
 */
export function valvePulse(
  tS: number,
  riseS: number,
  fallS: number,
  transitionS: number = VALVE_TRANSITION_S
): number {
  if (tS <= riseS) return 0;
  if (tS >= fallS + transitionS) return 0;

  const rising = ease((tS - riseS) / transitionS);
  const falling = 1 - ease((tS - fallS) / transitionS);
  // El mínimo y no el producto: con ventanas muy cortas —una taquicardia a 250
  // por minuto deja la eyección en 60 ms— los dos flancos se solapan, y
  // multiplicarlos hundiría el valor máximo a la mitad. Con el mínimo la
  // válvula abre menos, que es lo que de verdad pasa, en vez de abrir mal.
  return Math.max(0, Math.min(rising, falling));
}

/** Coseno alzado de 0 a 1, acotado fuera del intervalo. */
function ease(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 0.5 * (1 - Math.cos(Math.PI * u));
}
