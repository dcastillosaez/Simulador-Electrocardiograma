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

/** Hasta dónde se cierra sola una auriculoventricular en la diastasis.
 *
 * Una válvula abierta no se queda abierta de par en par toda la diástole: la
 * mitral se abre de golpe cuando el ventrículo se relaja —el punto E del modo
 * M— y en cuanto el gradiente de presión se agota los velos vuelven a
 * acercarse. Con la válvula clavada en uno esa mitad del ciclo se ve
 * congelada, que es lo que delata una animación de dos estados.
 *
 * Pero el remedio se pasó de largo en su primera versión. Con la diastasis en
 * 0,35 el velo hacía un viaje de ida y vuelta enorme en cada diástole, y una
 * válvula que oscila así llama más la atención que una quieta. La apertura
 * tiene que alcanzarse deprisa y **mantenerse** durante la mayor parte del
 * llenado; la caída de la diastasis es un descenso, no un cierre a medias. */
export const DIASTASIS_APERTURE = 0.6;

/** Cuánto tarda la válvula en caer del pico de llenado a la diastasis.
 *
 * Constante de tiempo del decaimiento, en segundos. Ciento ochenta
 * milisegundos dejan el velo por encima del 70% de su apertura durante los
 * primeros doscientos: se abre deprisa y se queda abierto, que es lo que hace
 * un velo de verdad. A frecuencias altas la diástole se acorta y la válvula no
 * llega a caer del todo antes de la sístole auricular — que es también lo que
 * pasa de verdad, y por eso una taquicardia pierde la separación entre la E y
 * la A. */
export const FILLING_DECAY_S = 0.18;

/** Cuánto reabre la sístole auricular una válvula ya medio cerrada.
 *
 * Es la onda A, y su trabajo es el último aporte de sangre antes de que se
 * cierre la válvula — no una segunda apertura completa. Con 0,8 el segundo
 * movimiento se veía casi tan grande como el primero y la válvula parecía
 * abrirse dos veces por latido. Cuarenta y cinco centésimas dejan la A como lo
 * que es: una separación pequeña sobre una válvula que ya estaba abierta.
 *
 * Cuándo ocurre no se decide aquí: se lee de la contracción auricular que ya
 * calcula el servidor. */
export const ATRIAL_KICK_GAIN = 0.45;

/** Apertura mínima de una sigmoidea mientras hay eyección.
 *
 * Por debajo de este suelo no baja aunque el flujo se agote: la válvula se
 * cierra por el pulso, en el instante que manda el servidor, no por quedarse
 * sin caudal. El suelo es lo que impide que las dos cosas se peleen y la valva
 * se cierre antes de tiempo. */
export const EJECTION_FLOOR = 0.62;

/** Apertura de una auriculoventricular durante el llenado, de 0 a 1.
 *
 * `sinceOpenS` son los segundos transcurridos desde que la válvula **acabó**
 * de abrirse —no desde que empezó— y `atrial` la excursión de la contracción
 * auricular en ese mismo instante, de 0 a 1. La diferencia no es cosmética:
 * midiendo desde el principio del flanco, el velo llegaría al final de su
 * recorrido con la caída ya empezada y nunca tocaría el pico.
 *
 * La forma resultante es la curva en M de toda la vida: pico de llenado
 * rápido, caída a la diastasis y segundo pico —más bajo— con la patada
 * auricular.
 *
 * La sístole auricular no se calcula aquí, y esa es la línea que separa lo que
 * es de este fichero de lo que no: cuándo se contrae la aurícula lo decide el
 * servidor y llega en el mismo mensaje que las válvulas. Aquí solo se decide
 * cuánto levanta el velo. */
export function fillingAperture(sinceOpenS: number, atrial: number): number {
  const decayed =
    DIASTASIS_APERTURE +
    (1 - DIASTASIS_APERTURE) * Math.exp(-Math.max(0, sinceOpenS) / FILLING_DECAY_S);
  const kick = (1 - decayed) * Math.min(1, Math.max(0, atrial)) * ATRIAL_KICK_GAIN;
  return Math.min(1, decayed + kick);
}

/** Apertura de una sigmoidea, en función del caudal que la atraviesa.
 *
 * `flow` es el flujo instantáneo normalizado, de 0 a 1. Y es flujo y no
 * fracción de la eyección transcurrida por un motivo que se ve en pantalla:
 * una válvula no sabe cuánto lleva abierta. Lo único que la mantiene separada
 * es la sangre que pasa, y cuando el ventrículo deja de acelerar el chorro las
 * valvas empiezan a caer hacia el centro **aunque falte sístole por delante**.
 * Colgarlo del reloj daba una rampa igual de larga en todos los latidos; del
 * caudal, la válvula abre de golpe con el pico de flujo, se sostiene mientras
 * dura y se va cerrando cuando decelera.
 *
 * La raíz cuadrada no es un adorno: la apertura de una sigmoidea es un área y
 * el flujo es proporcional a esa área por la velocidad, así que responder
 * linealmente al caudal cerraría la válvula demasiado pronto. */
export function ejectionAperture(flow: number): number {
  const u = Math.sqrt(Math.min(1, Math.max(0, flow)));
  return EJECTION_FLOOR + (1 - EJECTION_FLOOR) * u;
}
