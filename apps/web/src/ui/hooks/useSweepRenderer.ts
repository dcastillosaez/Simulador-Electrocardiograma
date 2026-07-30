import { useCallback, useEffect, useRef, useState } from "react";
import type { Theme } from "@ui-system/themes/types";
import { drawGrid } from "../../render/grid-layer";
import type { LayoutMetrics } from "../../render/layout-engine";
import { drawSweepSegment, type LeadCanvasOptions } from "../../render/lead-canvas";
import { SweepRebuilder } from "../../render/sweep-rebuilder";
import { SweepBuffer, sweepCapacitySamples } from "../../render/sweep-buffer";
import { leadIndex, type LeadName } from "../../render/layout";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

export interface UseSweepRendererParams {
  runtime: SessionRuntime;
  leads: readonly LeadName[];
  sampleRateHz: number;
  metrics: LayoutMetrics;
  widthPx: number;
  theme: Theme;
}

export interface UseSweepRendererResult {
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  isAwaitingSignal: boolean;
}

const rebuilder = new SweepRebuilder();

/** Dueño del bucle de dibujo, de los anillos de barrido y de los repintados
 * completos. */
export function useSweepRenderer({
  runtime,
  leads,
  sampleRateHz,
  metrics,
  widthPx,
  theme,
}: UseSweepRendererParams): UseSweepRendererResult {
  const traceCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const gridCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const sweeps = useRef(new Map<LeadName, SweepBuffer>());
  const [isAwaitingSignal, setIsAwaitingSignal] = useState(false);

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
      const nowS = nowMs / 1000;
      const elapsedS = lastS === undefined ? 0 : nowS - lastS;
      lastS = nowS;

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
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [runtime, leads, sampleRateHz, metrics, theme.name]);

  return { registerTrace, registerGrid, isAwaitingSignal };
}
