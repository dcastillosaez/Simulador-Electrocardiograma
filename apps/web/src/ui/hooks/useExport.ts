import { useCallback, useEffect, useRef, useState } from "react";

/** Nombre de fichero derivado del instante: `ecg-2026-07-30_170412.png`.
 *
 * Sin sello, exportar tres veces seguidas produce tres ficheros que el
 * navegador numera `(1)`, `(2)` y que luego no hay forma de ordenar.
 */
export function exportFilename(extension: string, at: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `ecg-${date}_${time}.${extension}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revocar en el mismo tick abortaría la descarga en Firefox, que lee la URL
  // de forma asíncrona. Un tick de más no le hace daño a nadie.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface UseExportResult {
  exportPng: () => void | Promise<void>;
  toggleRecording: () => void;
  isRecording: boolean;
  /** Motivo por el que la última acción no se pudo completar, para mostrarlo
   * en la interfaz en vez de dejarlo en la consola. */
  exportError: string | null;
}

export interface UseExportParams {
  /** El puesto entero rasterizado —controles, ECG e inspector—, o `null` si
   * todavía no hay nada que exportar. Asíncrono porque rasterizar el DOM pasa
   * por cargar una imagen, y eso no ocurre en el mismo tick. */
  composeSnapshot: () => Promise<HTMLCanvasElement | null>;
  /** Solo el trazado, por si la captura del puesto no sale. Exportar el ECG
   * solo es peor que exportarlo todo, pero mucho mejor que no exportar nada
   * por un fallo de rasterizado. */
  composeTraceOnly?: () => HTMLCanvasElement | null;
}

/** Exportar la vista: una imagen fija y un vídeo.
 *
 * Los dos guardan el puesto entero —controles, inspector, medidas— y no solo
 * el trazado, que para enseñar es justo lo que hace falta: doce ondas sin la
 * ganancia, la velocidad ni el ritmo al lado no se pueden leer después.
 *
 * Por caminos distintos, eso sí. El vídeo usa `getDisplayMedia` porque no hay
 * otra forma de grabar en movimiento, y paga el diálogo de permiso en cada
 * grabación: es una garantía del navegador, no un descuido. La imagen se
 * rasteriza desde el propio DOM, así que sigue siendo un clic.
 */
export function useExport({
  composeSnapshot,
  composeTraceOnly,
}: UseExportParams): UseExportResult {
  const [isRecording, setIsRecording] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const exportPng = useCallback(async () => {
    let canvas: HTMLCanvasElement | null = null;
    let warning: string | null = null;
    try {
      canvas = await composeSnapshot();
    } catch {
      canvas = composeTraceOnly?.() ?? null;
      warning = "No se pudo capturar la interfaz: se exportó solo el trazado.";
    }
    if (!canvas) {
      setExportError("No hay trazado que exportar todavía.");
      return;
    }
    setExportError(warning);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, exportFilename("png"));
    }, "image/png");
  }, [composeSnapshot, composeTraceOnly]);

  const stopRecording = useCallback(() => {
    recorder.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setExportError("Este navegador no permite grabar la pantalla.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);

      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      media.onstop = () => {
        // Parar las pistas es obligatorio, no higiene: sin esto el navegador
        // sigue mostrando el indicador de "compartiendo pantalla" y la
        // captura sigue viva aunque el grabador ya no escriba nada.
        for (const track of stream.getTracks()) track.stop();
        downloadBlob(new Blob(chunks, { type: "video/webm" }), exportFilename("webm"));
        recorder.current = null;
        setIsRecording(false);
      };
      // El usuario puede cortar la captura desde la barra del propio
      // navegador, sin tocar nuestro botón. Sin esto, la interfaz seguiría
      // diciendo "Grabando" sobre una captura que ya no existe.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => media.stop());

      media.start();
      recorder.current = media;
      setIsRecording(true);
      setExportError(null);
    } catch {
      // Denegar el permiso es una decisión del usuario, no un fallo: se
      // informa sin dramatizar y no se deja el botón encendido.
      setExportError("No se inició la grabación: permiso denegado o cancelado.");
      setIsRecording(false);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  // Una grabación viva sobrevive al desmontaje del componente y deja el
  // indicador de captura del navegador encendido para siempre.
  useEffect(() => () => recorder.current?.stop(), []);

  return { exportPng, toggleRecording, isRecording, exportError };
}
