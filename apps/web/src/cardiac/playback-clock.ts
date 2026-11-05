/** Lo que el reloj necesita del buffer de reproducción. */
export interface PlaybackSource {
  readonly playbackTimeS: number | null;
}

/** Una cabeza de reproducción con dos fuentes.
 *
 * En directo es `FrameBuffer.playbackTimeS`, el reloj que ya comparten el
 * trazado y el corazón. Con el trazado congelado y el repaso abierto es el
 * instante del cursor. Quien dibuja el corazón —`HeartModel`, `ValveReadout`—
 * lee de aquí y no sabe cuál de las dos está mandando.
 *
 * No hay segundo reloj: el repaso no lleva su propio tiempo, mueve un cursor
 * sobre la señal ya guardada. Y `advance()` sigue siendo cosa exclusiva de
 * `useSweepRenderer`: este objeto solo lee el buffer, nunca lo consume. */
export class PlaybackClock {
  /** Instante del cursor de repaso, o `null` en directo. */
  reviewTimeS: number | null = null;

  /** Cuánto pasado se conserva por detrás de la cabeza del directo. Lo fija
   * quien conoce el papel —lo que abarca el anillo del trazado—, porque el
   * repaso no puede ir más atrás que eso y retener más sería gasto. */
  retentionS = 1;

  constructor(private readonly source: PlaybackSource) {}

  /** La cabeza del directo. Es la referencia de la poda: el cursor del repaso
   * va hacia atrás, y podar contra él tiraría justo lo que se quiere ver. */
  get liveTimeS(): number | null {
    return this.source.playbackTimeS;
  }

  /** El instante que hay que dibujar. */
  get timeS(): number | null {
    return this.reviewTimeS ?? this.source.playbackTimeS;
  }

  get isReviewing(): boolean {
    return this.reviewTimeS !== null;
  }
}
