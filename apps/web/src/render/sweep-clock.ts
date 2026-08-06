export interface ClockTick {
  /** Segundos de señal a consumir en este tick. */
  elapsedS: number;
  /** Instante que el siguiente tick debe usar como referencia. `undefined`
   * significa «no hay referencia»: el siguiente tick consumirá cero. */
  nextPreviousS: number | undefined;
}

/** Cuánto avanza la reproducción en este frame.
 *
 * Congelar es del CLIENTE y ocurre en el mismo frame que el clic. Esperar a
 * que el servidor confirme la pausa y a que se vacíe el buffer de red
 * significaría hasta 0,7 s de trazado moviéndose después de pulsar, que se lee
 * como retardo de la herramienta.
 *
 * Congelado no se drena nada: el motor congela también su reloj, así que lo
 * que quedó en el buffer es contiguo con lo que llegará al reanudar y tirarlo
 * abriría un hueco artificial en el trazo.
 *
 * Olvidar la referencia temporal mientras se está congelado es lo que evita
 * que el primer tick tras reanudar pida de golpe todos los segundos que duró
 * la pausa. */
export function advanceClock(
  frozen: boolean,
  previousS: number | undefined,
  nowS: number
): ClockTick {
  if (frozen) {
    return { elapsedS: 0, nextPreviousS: undefined };
  }
  return {
    elapsedS: previousS === undefined ? 0 : nowS - previousS,
    nextPreviousS: nowS,
  };
}
