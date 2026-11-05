/** Las velocidades de repaso. Se llaman así, y no «velocidad» a secas, para que
 * nadie las confunda con la velocidad de papel: esta mueve un cursor sobre señal
 * ya guardada, aquella cambia cuántos milímetros ocupa un segundo. */
export const REVIEW_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type ReviewSpeed = (typeof REVIEW_SPEEDS)[number];

export interface ReviewRange {
  startS: number;
  endS: number;
}

/** Lo que el controlador consulta para saltar de tramo en tramo y para saber
 * qué fase repetir. Es la `ElectricalTimeline`; se tipa así para probarlo sin
 * ella. */
export interface BoundarySource {
  boundaryFrom(tS: number, direction: 1 | -1): number | null;
}

/** El estado del repaso, sin React ni reloj propio.
 *
 * El tiempo real entra por `tick(elapsedS)` desde el bucle de dibujo, y sale
 * convertido en tiempo de simulación según la velocidad. Nada de esto toca el
 * servidor ni el buffer: el repaso solo existe en congelado, con el motor
 * parado, y por eso no hay nada que alcanzar ni nada que pueda divergir. */
export class ReviewController {
  timeS: number;
  playing = false;
  speed: ReviewSpeed = 1;
  /** La fase que se repite, si se ha pedido. */
  loop: ReviewRange | null = null;

  constructor(
    public history: ReviewRange,
    startS: number = history.endS
  ) {
    this.timeS = clamp(startS, history);
  }

  /** Avanza `elapsedS` segundos de tiempo real. En el borde del historial el
   * cursor se detiene: no da la vuelta, porque detrás del borde no hay señal
   * sino la del principio, y volver a ella sería enseñar otra cosa. */
  tick(elapsedS: number): void {
    if (!this.playing || elapsedS <= 0) return;
    const next = this.timeS + elapsedS * this.speed;
    if (this.loop && next > this.loop.endS) {
      this.timeS = this.loop.startS;
      return;
    }
    if (next >= this.history.endS) {
      this.timeS = this.history.endS;
      this.playing = false;
      return;
    }
    this.timeS = next;
  }

  seek(tS: number): void {
    this.timeS = clamp(tS, this.history);
    if (this.loop && (this.timeS < this.loop.startS || this.timeS > this.loop.endS)) {
      this.loop = null;
    }
  }

  /** Salta al siguiente límite de tramo eléctrico, o al anterior. */
  step(direction: 1 | -1, boundaries: BoundarySource): void {
    this.playing = false;
    const next = boundaries.boundaryFrom(this.timeS, direction);
    if (next !== null) this.seek(next);
  }

  /** Repite en bucle el tramo `range` (la fase eléctrica en curso). Llamarlo
   * otra vez lo quita. */
  toggleLoop(range: ReviewRange | null): void {
    if (this.loop || range === null) {
      this.loop = null;
      return;
    }
    this.loop = { startS: clamp(range.startS, this.history), endS: clamp(range.endS, this.history) };
    this.timeS = this.loop.startS;
    this.playing = true;
  }

  setHistory(history: ReviewRange): void {
    this.history = history;
    this.timeS = clamp(this.timeS, history);
  }
}

function clamp(tS: number, range: ReviewRange): number {
  return Math.min(range.endS, Math.max(range.startS, tS));
}
