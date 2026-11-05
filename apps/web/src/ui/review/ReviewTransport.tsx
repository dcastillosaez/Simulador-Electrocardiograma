import type { RefObject } from "react";
import { SegmentedControl } from "@ui-system";
import { REVIEW_SPEEDS, type ReviewSpeed } from "../../cardiac/review-controller";
import type { UseReviewResult } from "./useReview";
import styles from "./ReviewTransport.module.css";

const SPEED_OPTIONS = REVIEW_SPEEDS.map((value) => ({
  value: String(value) as `${ReviewSpeed}`,
  label: `${String(value).replace(".", ",")}×`,
}));

const END_MESSAGES = {
  "rings-recreated":
    "El cambio de disposición vació el papel: el corazón ha vuelto a la cabeza de reproducción.",
  started: "Ha empezado otra sesión: el repaso se ha cerrado.",
} as const;

export interface ReviewTransportProps {
  review: UseReviewResult;
  timeLabel: RefObject<HTMLSpanElement>;
  phaseLabel: RefObject<HTMLSpanElement>;
  slider: RefObject<HTMLInputElement>;
}

/** La barra del repaso. Solo aparece con el trazado congelado.
 *
 * El arrastre va aquí y no sobre el trazado, donde clic y arrastre ya son de
 * la herramienta de medida. Los rótulos que cambian en cada fotograma —el
 * instante y la fase— los escribe el bucle del repaso directamente, sin pasar
 * por React. */
export function ReviewTransport({ review, timeLabel, phaseLabel, slider }: ReviewTransportProps) {
  if (!review.active) {
    return review.endReason ? (
      <p className={styles.notice} role="status">
        {END_MESSAGES[review.endReason]}
      </p>
    ) : null;
  }
  const history = review.history!;
  return (
    <div className={styles.bar} role="group" aria-label="Repaso del trazado congelado">
      <div className={styles.row}>
        <button type="button" onClick={() => review.step(-1)} aria-label="Paso atrás">
          ⏮
        </button>
        <button
          type="button"
          onClick={review.togglePlay}
          aria-label={review.playing ? "Pausar el repaso" : "Reproducir el repaso"}
        >
          {review.playing ? "⏸" : "▶"}
        </button>
        <button type="button" onClick={() => review.step(1)} aria-label="Paso adelante">
          ⏭
        </button>
        <button
          type="button"
          aria-pressed={review.looping}
          className={review.looping ? styles.active : undefined}
          onClick={review.toggleLoop}
        >
          Repetir fase
        </button>
        <span ref={timeLabel} className={styles.time} aria-live="off" />
      </div>
      <input
        ref={slider}
        className={styles.slider}
        type="range"
        aria-label="Instante del repaso"
        min={history.startS}
        max={history.endS}
        step={0.001}
        defaultValue={history.endS}
        onChange={(event) => review.seek(Number(event.target.value))}
      />
      <SegmentedControl
        label="Velocidad de repaso"
        value={String(review.speed) as `${ReviewSpeed}`}
        options={SPEED_OPTIONS}
        onChange={(value) => review.setSpeed(Number(value) as ReviewSpeed)}
      />
      <span ref={phaseLabel} className={styles.phase} />
    </div>
  );
}
