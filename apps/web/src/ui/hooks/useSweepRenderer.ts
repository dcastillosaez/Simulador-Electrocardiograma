import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "@ui-system/themes/types";
import { drawGrid } from "../../render/grid-layer";
import {
  COLUMN_GAP_PX,
  STRIP_GAP_PX,
  type LayoutMetrics,
} from "../../render/layout-engine";
import { drawSweepSegment, type LeadCanvasOptions } from "../../render/lead-canvas";
import { advanceClock } from "../../render/sweep-clock";
import { SweepRebuilder } from "../../render/sweep-rebuilder";
import { SweepBuffer, sweepCapacitySamples } from "../../render/sweep-buffer";
import { leadIndex, type LeadName } from "../../render/layout";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

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
}

export interface UseSweepRendererResult {
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  isAwaitingSignal: boolean;
  /** Aplana lo que hay en pantalla a un solo canvas, o `null` si aún no hay
   * nada dibujado. Vive aquí y no en el componente de exportación porque
   * quien sabe qué canvas existen y cómo se apilan es este hook. */
  composeSnapshot: (options?: SnapshotOptions) => HTMLCanvasElement | null;
}

export interface SnapshotOptions {
  /** Se estampa arriba a la derecha. Un trazado exportado sin fecha no se
   * puede situar después en la historia de nada. */
  stamp?: string;
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
}: UseSweepRendererParams): UseSweepRendererResult {
  const leads = useMemo(() => leadColumns.flat(), [leadColumns]);
  const widthPx = metrics.stripWidthPx;
  const traceCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const gridCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const sweeps = useRef(new Map<LeadName, SweepBuffer>());
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

  // Un anillo por derivación visible, dimensionado a los segundos de papel que
  // caben en el ancho del canvas — NO al buffer de jitter de red, que es dos
  // órdenes de magnitud menor. Se recrea si cambian layout, ancho o frecuencia
  // de muestreo, porque los tres alteran la capacidad.
  useEffect(() => {
    const capacity = sweepCapacitySamples(widthPx, metrics.pixelsPerSecond, sampleRateHz);
    const next = new Map<LeadName, SweepBuffer>();
    for (const lead of leads) next.set(lead, new SweepBuffer(capacity));
    sweeps.current = next;
  }, [leads, widthPx, metrics.pixelsPerSecond, sampleRateHz]);

  // Al arrancar una sesión el eje de tiempo empieza de cero: se vacían los
  // anillos y se limpian los canvas para no dejar el trazo del ritmo anterior
  // conviviendo con el nuevo.
  useEffect(() => {
    const onStarted = () => {
      for (const sweep of sweeps.current.values()) sweep.reset();
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
        rebuilder.rebuild(traceCtx, sweep, sampleRateHz, options, metrics.stripHeightPx);
      }
    }
  }, [
    leads,
    widthPx,
    metrics.stripHeightPx,
    metrics.viewportScalePxPerMm,
    metrics.pixelsPerSecond,
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

      if (options.stamp) {
        ctx.fillStyle = theme.text.muted;
        ctx.font = `${SNAPSHOT_LABEL_PX}px monospace`;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(options.stamp, out.width - SNAPSHOT_PADDING_PX, SNAPSHOT_PADDING_PX / 2);
      }

      return out;
    },
    [leadColumns, leads, theme]
  );

  return { registerTrace, registerGrid, isAwaitingSignal, composeSnapshot };
}
