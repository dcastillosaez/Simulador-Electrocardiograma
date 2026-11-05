import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { ElectricalTimeline } from "../../cardiac/electrical-timeline";
import { PHASE_DESCRIPTION, phaseAt } from "../../cardiac/electrical-phase";
import type { PlaybackClock } from "../../cardiac/playback-clock";
import {
  ReviewController,
  type ReviewRange,
  type ReviewSpeed,
} from "../../cardiac/review-controller";
import type { LayoutMetrics } from "../../render/layout-engine";
import { pxPerSample, ringPosToPx, type TraceView } from "../../render/measure-geometry";
import type { SampleIndexRing } from "../../render/sample-index";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import type { MeasureSource } from "../hooks/useSweepRenderer";
import type { ReviewCursorHandle } from "./ReviewCursor";

/** Por qué terminó un repaso sin que nadie lo cerrara. */
export type ReviewEndReason = "rings-recreated" | "started" | null;

export interface UseReviewParams {
  runtime: SessionRuntime;
  frozen: boolean;
  clock: PlaybackClock;
  electrical: MutableRefObject<ElectricalTimeline>;
  getMeasureSource: () => MeasureSource | null;
  sampleRateHz: number;
  metrics: LayoutMetrics;
  view: TraceView;
  /** Mueve la ventana del trazado cuando el cursor sale de ella con zoom. */
  onFollow: (startRingPos: number) => void;
  cursor: RefObject<ReviewCursorHandle>;
  timeLabel: RefObject<HTMLElement>;
  phaseLabel: RefObject<HTMLElement>;
  slider: RefObject<HTMLInputElement>;
}

export interface UseReviewResult {
  active: boolean;
  playing: boolean;
  speed: ReviewSpeed;
  looping: boolean;
  history: ReviewRange | null;
  endReason: ReviewEndReason;
  togglePlay: () => void;
  setSpeed: (speed: ReviewSpeed) => void;
  step: (direction: 1 | -1) => void;
  toggleLoop: () => void;
  seek: (tS: number) => void;
}

/** Dónde se coloca el cursor al seguirlo con zoom: a un décimo del borde
 * izquierdo, para que se vea lo que viene. */
const FOLLOW_MARGIN = 0.1;

function historyOf(ring: SampleIndexRing, sampleRateHz: number): ReviewRange | null {
  const oldest = ring.oldestSampleIndex;
  const newest = ring.newestSampleIndex;
  if (oldest === null || newest === null) return null;
  return { startS: oldest / sampleRateHz, endS: newest / sampleRateHz };
}

/** El repaso del trazado congelado.
 *
 * Solo existe en congelado: al congelar se abre con el cursor en la cabeza de
 * reproducción, al descongelar se cierra y el corazón vuelve a la cabeza, que
 * no se ha movido porque el motor estaba parado. El historial es lo que hay en
 * el papel: el anillo del trazado, unos diez segundos.
 *
 * Su bucle no consume el buffer ni dibuja el trazado: mueve el cursor del
 * reloj, coloca la línea sobre el papel y escribe dos rótulos. No manda nada
 * al servidor —este hook ni siquiera tiene con qué— salvo escuchar `started`
 * para cerrarse si llega otra sesión. */
export function useReview({
  runtime,
  frozen,
  clock,
  electrical,
  getMeasureSource,
  sampleRateHz,
  metrics,
  view,
  onFollow,
  cursor,
  timeLabel,
  phaseLabel,
  slider,
}: UseReviewParams): UseReviewResult {
  const controller = useRef<ReviewController | null>(null);
  const ring = useRef<SampleIndexRing | null>(null);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<ReviewSpeed>(1);
  const [looping, setLooping] = useState(false);
  const [history, setHistory] = useState<ReviewRange | null>(null);
  const [endReason, setEndReason] = useState<ReviewEndReason>(null);

  // El bucle lee estas en refs: cambian sin que haga falta rearrancarlo.
  const viewRef = useRef(view);
  viewRef.current = view;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const followRef = useRef(onFollow);
  followRef.current = onFollow;
  const followPending = useRef(false);
  followPending.current = false;
  // En una ref y no en las dependencias: quien la pasa puede no memorizarla,
  // y abrir el repaso en cada renderizado lo reabriría sin fin.
  const sourceRef = useRef(getMeasureSource);
  sourceRef.current = getMeasureSource;

  const end = useCallback(
    (reason: ReviewEndReason) => {
      controller.current = null;
      ring.current = null;
      clock.reviewTimeS = null;
      cursor.current?.place(null);
      setActive(false);
      setPlaying(false);
      setLooping(false);
      setEndReason(reason);
    },
    [clock, cursor]
  );

  // Abrir y cerrar con el congelado.
  useEffect(() => {
    if (!frozen) {
      end(null);
      return;
    }
    const source = sourceRef.current();
    const range = source ? historyOf(source.indexRing, sampleRateHz) : null;
    if (!source || !range) return;
    ring.current = source.indexRing;
    const start = clock.liveTimeS ?? range.endS;
    controller.current = new ReviewController(range, start);
    clock.reviewTimeS = controller.current.timeS;
    setHistory(range);
    setActive(true);
    setEndReason(null);
    setSpeedState(1);
  }, [frozen, sampleRateHz, clock, end]);

  // Otra sesión: se limpia todo.
  useEffect(() => {
    const onStarted = () => end("started");
    runtime.on("started", onStarted);
    return () => runtime.off("started", onStarted);
  }, [runtime, end]);

  // El bucle del repaso.
  useEffect(() => {
    if (!active) return;
    let frameId = 0;
    let lastMs: number | null = null;
    const tick = (nowMs: number) => {
      const review = controller.current;
      const source = sourceRef.current();
      // Un cambio de disposición o de ancho recrea los anillos y los vacía: lo
      // que se repasaba ya no está en el papel. Se vuelve a la cabeza.
      if (!review || !source || source.indexRing !== ring.current) {
        end("rings-recreated");
        return;
      }
      const elapsedS = lastMs === null ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      const wasPlaying = review.playing;
      review.tick(elapsedS);
      if (wasPlaying && !review.playing) setPlaying(false);
      clock.reviewTimeS = review.timeS;

      // Cursor: de tiempo a muestra, de muestra al anillo y de ahí al píxel.
      const sampleIndex = Math.round(review.timeS * sampleRateHz);
      const ringPos = source.indexRing.findNearestRingPos(sampleIndex);
      const currentView = viewRef.current;
      const pps = pxPerSample(metricsRef.current, sampleRateHz);
      if (ringPos === null) {
        cursor.current?.place(null);
      } else {
        const offset =
          (((ringPos - currentView.startRingPos) % source.capacity) + source.capacity) %
          source.capacity;
        if (offset >= currentView.visibleSamples && !followPending.current) {
          // Con zoom la ventana enseña un trozo del anillo; si el cursor se
          // sale, la ventana lo sigue.
          followPending.current = true;
          const lead = Math.round(currentView.visibleSamples * FOLLOW_MARGIN);
          followRef.current(
            (((ringPos - lead) % source.capacity) + source.capacity) % source.capacity
          );
        }
        cursor.current?.place(
          offset < currentView.visibleSamples
            ? ringPosToPx(ringPos, currentView, pps, source.capacity)
            : null
        );
      }

      if (timeLabel.current) {
        const text = `${review.timeS.toFixed(3).replace(".", ",")} s`;
        if (timeLabel.current.textContent !== text) timeLabel.current.textContent = text;
      }
      if (phaseLabel.current) {
        const phase = phaseAt(electrical.current, review.timeS);
        const text = phase ? PHASE_DESCRIPTION[phase.phase] : "Entre latidos";
        if (phaseLabel.current.textContent !== text) phaseLabel.current.textContent = text;
      }
      if (slider.current && document.activeElement !== slider.current) {
        slider.current.value = String(review.timeS);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, sampleRateHz, clock, electrical, cursor, timeLabel, phaseLabel, slider, end]);

  const togglePlay = useCallback(() => {
    const review = controller.current;
    if (!review) return;
    // Al darle a reproducir en el borde, se empieza desde el principio: es lo
    // que espera quien ya ha llegado al final.
    if (!review.playing && review.timeS >= review.history.endS) {
      review.seek(review.history.startS);
    }
    review.playing = !review.playing;
    setPlaying(review.playing);
  }, []);

  const setSpeed = useCallback((value: ReviewSpeed) => {
    if (controller.current) controller.current.speed = value;
    setSpeedState(value);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      controller.current?.step(direction, electrical.current);
      setPlaying(false);
    },
    [electrical]
  );

  const toggleLoop = useCallback(() => {
    const review = controller.current;
    if (!review) return;
    const phase = phaseAt(electrical.current, review.timeS);
    review.toggleLoop(phase ? { startS: phase.startS, endS: phase.endS } : null);
    setLooping(review.loop !== null);
    setPlaying(review.playing);
  }, [electrical]);

  const seek = useCallback((tS: number) => {
    controller.current?.seek(tS);
    if (controller.current) setLooping(controller.current.loop !== null);
  }, []);

  return {
    active,
    playing,
    speed,
    looping,
    history,
    endReason,
    togglePlay,
    setSpeed,
    step,
    toggleLoop,
    seek,
  };
}
