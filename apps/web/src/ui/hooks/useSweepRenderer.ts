import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "@ui-system/themes/types";
import { drawGrid } from "../../render/grid-layer";
import {
  COLUMN_GAP_PX,
  REFERENCE_PAPER_SPEED_MM_S,
  STRIP_GAP_PX,
  type LayoutMetrics,
} from "../../render/layout-engine";
import type { TraceView } from "../../render/measure-geometry";
import { drawSweepSegment, type LeadCanvasOptions } from "../../render/lead-canvas";
import { SampleIndexRing } from "../../render/sample-index";
import { advanceClock } from "../../render/sweep-clock";
import { SweepRebuilder } from "../../render/sweep-rebuilder";
import { INTENDED_USE_FULL } from "../intended-use";
import { SweepBuffer, sweepCapacitySamples } from "../../render/sweep-buffer";
import { leadIndex, type LeadName } from "../../render/layout";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import { formatBpm, formatMs, formatMv, formatSeconds } from "../../measure/formulas";
import type { MeasurementSession } from "../../measure/session";

export interface UseSweepRendererParams {
  runtime: SessionRuntime;
  /** Una lista por columna. El renderer las aplana para dibujar, pero necesita
   * la estructura para componer la exportacion. */
  leadColumns: readonly (readonly LeadName[])[];
  sampleRateHz: number;
  metrics: LayoutMetrics;
  theme: Theme;
  /** Congelado: el bucle sigue vivo pero no consume ni dibuja. Ocurre en el
   * mismo frame que el clic, sin esperar a que el servidor confirme la pausa
   * ni a que se vacíe el buffer de red. */
  frozen: boolean;
  /** Qué trozo del anillo se repinta. Con el zoom a la velocidad de referencia
   * es el anillo entero. */
  view: TraceView;
}

export interface UseSweepRendererResult {
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  isAwaitingSignal: boolean;
  /** Aplana lo que hay en pantalla a un solo canvas, o `null` si aún no hay
   * nada dibujado. Vive aquí y no en el componente de exportación porque
   * quien sabe qué canvas existen y cómo se apilan es este hook. */
  composeSnapshot: (options?: SnapshotOptions) => HTMLCanvasElement | null;
  /** Los anillos que la capa de medición necesita leer, o `null` si todavía no
   * hay nada escrito.
   *
   * Se entrega como función y no como valor para que el consumidor lea el
   * estado del momento sin que el hook tenga que volver a renderizar cuando los
   * anillos se recrean. */
  getMeasureSource: () => MeasureSource | null;
}

/** Lo que hay que saber para medir sobre el trazado: la señal de cada
 * derivación y la identidad de cada muestra. */
export interface MeasureSource {
  sweeps: ReadonlyMap<LeadName, SweepBuffer>;
  indexRing: SampleIndexRing;
  capacity: number;
}

export interface SnapshotOptions {
  /** Se estampa arriba a la derecha. Un trazado exportado sin fecha no se
   * puede situar después en la historia de nada. */
  stamp?: string;
  /** El canvas de overlay, tal cual. Se dimensiona exactamente a la rejilla de
   * tiras, así que entra con un solo `drawImage` en (0,0) y no hay que
   * reimplementar el layout una segunda vez. */
  overlay?: HTMLCanvasElement | null;
  /** Lectura de la medida, estampada bajo el sello temporal. */
  readout?: readonly string[];
}

/** Las líneas de texto que acompañan a la captura.
 *
 * Se compone aquí y no en el canvas para poder probarla sin canvas, y para que
 * salga de las mismas funciones de formato que el panel y el rótulo: si
 * divergieran, la imagen exportada diría un número distinto del que se vio. */
export function composeSnapshotLines(session: MeasurementSession | null): string[] {
  const result = session?.result;
  if (!result) return [];
  if (result.kind === "cursor") {
    return [result.lead, formatSeconds(result.timestampS), formatMv(result.voltageV * 1000)];
  }
  return [
    `Δt ${formatMs(result.readout.deltaMs)}`,
    `ΔV ${formatMv(result.readout.deltaMv)}`,
    formatBpm(result.readout.equivalentBpm),
  ];
}

const SNAPSHOT_LABEL_PX = 11;
const SNAPSHOT_PADDING_PX = 6;

const rebuilder = new SweepRebuilder();

/** Dueño del bucle de dibujo, de los anillos de barrido y de los repintados
 * completos. */
export function useSweepRenderer({
  runtime,
  leadColumns,
  sampleRateHz,
  metrics,
  theme,
  frozen,
  view,
}: UseSweepRendererParams): UseSweepRendererResult {
  const leads = useMemo(() => leadColumns.flat(), [leadColumns]);
  const widthPx = metrics.stripWidthPx;
  const traceCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const gridCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const sweeps = useRef(new Map<LeadName, SweepBuffer>());
  // Uno solo para las doce derivaciones: se escriben en el mismo tick desde el
  // mismo trozo multicanal, así que comparten eje por construcción.
  const indexRing = useRef(new SampleIndexRing(1));
  const [isAwaitingSignal, setIsAwaitingSignal] = useState(false);

  // En una `ref` y no en las dependencias del efecto: congelar no debe
  // desmontar y remontar el bucle de dibujo.
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const registerTrace = useCallback((lead: LeadName, element: HTMLCanvasElement | null) => {
    if (element) traceCanvases.current.set(lead, element);
    else traceCanvases.current.delete(lead);
  }, []);

  const registerGrid = useCallback((lead: LeadName, element: HTMLCanvasElement | null) => {
    if (element) gridCanvases.current.set(lead, element);
    else gridCanvases.current.delete(lead);
  }, []);

  const options: LeadCanvasOptions = { metrics, theme: theme.ecg };

  // Píxeles por segundo A LA VELOCIDAD DE REFERENCIA, que no es lo mismo que
  // `metrics.pixelsPerSecond` en cuanto hay zoom temporal.
  //
  // El anillo se dimensiona con esta y no con la vigente a propósito: subir la
  // velocidad de papel no captura menos señal, solo enseña un trozo más corto
  // de la que ya hay. Si la capacidad siguiera a la velocidad vigente, hacer
  // zoom recrearía los anillos —y borraría el trazado que se quería mirar de
  // cerca, que es justo lo contrario de lo que el usuario pidió.
  const referencePixelsPerSecond =
    REFERENCE_PAPER_SPEED_MM_S * metrics.viewportScalePxPerMm;

  // Un anillo por derivación visible, dimensionado a los segundos de papel que
  // caben en el ancho del canvas — NO al buffer de jitter de red, que es dos
  // órdenes de magnitud menor. Se recrea si cambian layout, ancho o frecuencia
  // de muestreo, porque los tres alteran la capacidad.
  useEffect(() => {
    const capacity = sweepCapacitySamples(widthPx, referencePixelsPerSecond, sampleRateHz);
    const next = new Map<LeadName, SweepBuffer>();
    for (const lead of leads) next.set(lead, new SweepBuffer(capacity));
    sweeps.current = next;
    indexRing.current = new SampleIndexRing(capacity);
  }, [leads, widthPx, referencePixelsPerSecond, sampleRateHz]);

  // Al arrancar una sesión el eje de tiempo empieza de cero: se vacían los
  // anillos y se limpian los canvas para no dejar el trazo del ritmo anterior
  // conviviendo con el nuevo.
  useEffect(() => {
    const onStarted = () => {
      for (const sweep of sweeps.current.values()) sweep.reset();
      indexRing.current.reset();
      for (const canvas of traceCanvases.current.values()) {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    runtime.on("started", onStarted);
    return () => runtime.off("started", onStarted);
  }, [runtime]);

  // REPINTADO COMPLETO. Se dispara con los cuatro eventos del spec:
  // redimensionado (widthPx / stripHeightPx), cambio de tema, cambio de layout
  // (leads) y cambio de viewportScale. Nunca desde el bucle de rAF.
  //
  // Asignar canvas.width o canvas.height borra el contenido, así que sin este
  // efecto el ECG quedaría en blanco unos ocho segundos tras cada
  // redimensionado, hasta que el barrido diera la vuelta.
  useEffect(() => {
    for (const lead of leads) {
      const grid = gridCanvases.current.get(lead);
      const gridCtx = grid?.getContext("2d");
      if (grid && gridCtx) {
        grid.width = widthPx;
        grid.height = metrics.stripHeightPx;
        drawGrid(gridCtx, widthPx, metrics.stripHeightPx, metrics, theme.ecg);
      }

      const trace = traceCanvases.current.get(lead);
      const traceCtx = trace?.getContext("2d");
      const sweep = sweeps.current.get(lead);
      if (trace && traceCtx && sweep) {
        trace.width = widthPx;
        trace.height = metrics.stripHeightPx;
        rebuilder.rebuild(traceCtx, sweep, sampleRateHz, options, metrics.stripHeightPx, view);
      }
    }
  }, [
    leads,
    widthPx,
    metrics.stripHeightPx,
    metrics.viewportScalePxPerMm,
    metrics.pixelsPerSecond,
    // El zoom y el desplazamiento lateral son repintados completos: cambian
    // qué trozo del anillo se ve, no lo que hay dentro.
    view.startRingPos,
    view.visibleSamples,
    theme.name,
    sampleRateHz,
  ]);

  // Camino caliente. Aquí no entra nada que no sea dibujo incremental.
  useEffect(() => {
    let frameId: number;
    let lastS: number | undefined;

    const tick = (nowMs: number) => {
      const { elapsedS, nextPreviousS } = advanceClock(
        frozenRef.current,
        lastS,
        nowMs / 1000
      );
      lastS = nextPreviousS;

      // Congelado no se consume ni se dibuja: la imagen queda exactamente
      // donde estaba. El buffer tampoco se drena por detrás — el motor congela
      // también su reloj, así que lo que queda dentro es contiguo con lo que
      // llegará al reanudar, y tirarlo abriría un hueco artificial.
      if (!frozenRef.current) {
        runtime.buffer.advance(elapsedS);
        // Se lee una vez por tick y no por derivación: el eje es el mismo para
        // las doce. Va antes del dibujo para que la posición del anillo de
        // índices y la de los de señal avancen juntas.
        indexRing.current.push(runtime.buffer.consumedSampleIndices());
        // Se dibuja lo que advance() haya liberado ESTE tick, aunque el buffer
        // haya quedado vacío al hacerlo: si no, el último trozo consumido antes
        // de un underrun se perdería sin llegar a pintarse. Con cero muestras
        // nuevas, drawSweepSegment no toca el canvas y el trazo se congela en la
        // última muestra, sin interpolar jamás.
        //
        // El hueco es el mismo para las doce derivaciones (viene del mismo trozo
        // multicanal), así que se lee una vez por tick y no por derivación.
        const hadGap = runtime.buffer.justConsumedHadGap;
        for (const lead of leads) {
          const canvas = traceCanvases.current.get(lead);
          const ctx = canvas?.getContext("2d");
          const sweep = sweeps.current.get(lead);
          if (!canvas || !ctx || !sweep) continue;
          const samples = runtime.buffer.consumeNewSamples(leadIndex(lead));
          drawSweepSegment(
            ctx, sweep, samples, sampleRateHz, options, canvas.height, hadGap
          );
        }

        // "Esperando señal" cubre los dos motivos opuestos de no reproducir: no
        // queda nada (underrun) o aún no hay reserva suficiente (pre-roll).
        setIsAwaitingSignal(runtime.buffer.isUnderrun || !runtime.buffer.isPreRolled);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [runtime, leads, sampleRateHz, metrics, theme.name]);

  // Composición para exportar. Nunca en el camino caliente: se llama al
  // pulsar un botón o, como mucho, a cadencia de vídeo.
  //
  // Hay que redibujar en vez de capturar el DOM porque cada tira son dos
  // canvas superpuestos por CSS, y un canvas no "ve" lo que hay debajo. La
  // etiqueta de la derivación vive en un `<span>`, así que aquí se pinta a
  // mano: sin ella, un PNG de doce trazados no dice cuál es cuál.
  const composeSnapshot = useCallback(
    (options: SnapshotOptions = {}): HTMLCanvasElement | null => {
      const first = gridCanvases.current.get(leads[0]);
      if (!first || first.width === 0 || first.height === 0) return null;

      const stripHeight = first.height;
      const stripWidth = first.width;
      const rows = Math.max(...leadColumns.map((column) => column.length));
      const columns = leadColumns.length;

      const out = document.createElement("canvas");
      out.width = stripWidth * columns + COLUMN_GAP_PX * (columns - 1);
      out.height = stripHeight * rows + STRIP_GAP_PX * (rows - 1);

      const ctx = out.getContext("2d");
      if (!ctx) return null;

      ctx.fillStyle = theme.ecg.background;
      ctx.fillRect(0, 0, out.width, out.height);

      // La imagen exportada conserva la disposicion de la pantalla: un ECG en
      // formato de dos columnas se reconoce por su forma, y aplanarlo a una
      // tira unica lo haria irreconocible.
      leadColumns.forEach((column, columnIndex) => {
        const x = columnIndex * (stripWidth + COLUMN_GAP_PX);
        column.forEach((lead, rowIndex) => {
          const y = rowIndex * (stripHeight + STRIP_GAP_PX);
          const grid = gridCanvases.current.get(lead);
          const trace = traceCanvases.current.get(lead);
          if (grid) ctx.drawImage(grid, x, y);
          if (trace) ctx.drawImage(trace, x, y);

          ctx.fillStyle = theme.text.muted;
          ctx.font = `${SNAPSHOT_LABEL_PX}px monospace`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(lead, x + SNAPSHOT_PADDING_PX, y + SNAPSHOT_PADDING_PX / 2);
        });
      });

      // El overlay se dimensionó (en `MeasureOverlay.tsx`) con la misma
      // fórmula que `out.width`/`out.height` de aquí arriba, así que entra sin
      // recalcular nada: un solo `drawImage` en el origen.
      if (options.overlay) {
        ctx.drawImage(options.overlay, 0, 0);
      }

      if (options.stamp) {
        ctx.fillStyle = theme.text.muted;
        ctx.font = `${SNAPSHOT_LABEL_PX}px monospace`;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(options.stamp, out.width - SNAPSHOT_PADDING_PX, SNAPSHOT_PADDING_PX / 2);
      }

      // Debajo del sello temporal. Un PNG con dos marcas y ningún número
      // obliga a volver a medir sobre la imagen, que es justo lo que se acaba
      // de hacer sobre el trazado.
      if (options.readout?.length) {
        ctx.fillStyle = theme.text.muted;
        ctx.font = `${SNAPSHOT_LABEL_PX}px monospace`;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        options.readout.forEach((line, index) => {
          ctx.fillText(
            line,
            out.width - SNAPSHOT_PADDING_PX,
            SNAPSHOT_PADDING_PX / 2 + (index + 1) * (SNAPSHOT_LABEL_PX + 2)
          );
        });
      }

      // El uso previsto, dentro de la imagen. Un PNG se reenvía y acaba lejos
      // de la ventana donde se generó: sin esto, un trazado sintético puede
      // circular por un hospital sin nada que diga que lo es.
      ctx.fillStyle = theme.text.muted;
      ctx.font = `${SNAPSHOT_LABEL_PX}px monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        INTENDED_USE_FULL,
        SNAPSHOT_PADDING_PX,
        out.height - SNAPSHOT_PADDING_PX / 2
      );

      return out;
    },
    [leadColumns, leads, theme]
  );

  const getMeasureSource = useCallback((): MeasureSource | null => {
    // Sin muestras escritas no hay nada que medir, y devolver los anillos
    // vacíos dejaría al overlay midiendo los ceros de relleno.
    if (indexRing.current.writtenCount === 0) return null;
    return {
      sweeps: sweeps.current,
      indexRing: indexRing.current,
      capacity: indexRing.current.capacity,
    };
  }, []);

  return {
    registerTrace,
    registerGrid,
    isAwaitingSignal,
    composeSnapshot,
    getMeasureSource,
  };
}
