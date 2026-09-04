/** Escala real del modelo y barra de referencia.
 *
 * Un corte sin escala se mira; con escala se mide. En una herramienta docente
 * la diferencia importa: un ventrículo dilatado solo se reconoce como dilatado
 * si hay contra qué compararlo.
 */

/** Milímetros por unidad de escena.
 *
 * Ajustado por mínimos cuadrados contra las veintisiete dimensiones que
 * `build-heart-model.py` documentó en milímetros para las nueve estructuras:
 * residuo mediano del 0,25% y máximo del 1,95%. Que el ajuste sea tan bueno
 * con un solo factor confirma además que el modelo no está deformado en
 * ningún eje.
 *
 * Sale de ahí y no de `TARGET_HEIGHT`: el script normaliza a altura 1 el
 * conjunto entero —con la cava inferior colgando y el arco aórtico arriba—,
 * así que esa altura son 222 mm de bloque cardiomediastínico, no los 12 cm de
 * un corazón. Deducir la escala de "el corazón mide 1" da un 5,5% de error,
 * que es exactamente lo que daba antes de medirlo. */
export const MM_PER_UNIT = 222.4;

/** Píxeles por milímetro en el plano que pasa por el centro del modelo.
 *
 * Con proyección en perspectiva la escala depende de la profundidad, así que
 * este número es exacto solo en ese plano. Es la elección honesta para un
 * corte: el plano de sección pasa cerca del centro, que es justo lo que se
 * está midiendo. Hacia delante y hacia atrás el error crece con la
 * profundidad. */
export function pixelsPerMm(
  distanceToCentre: number,
  fovDeg: number,
  viewportHeightPx: number
): number {
  const visibleHeightUnits =
    2 * distanceToCentre * Math.tan((fovDeg / 2) * (Math.PI / 180));
  if (visibleHeightUnits <= 0) return 0;
  return viewportHeightPx / (visibleHeightUnits * MM_PER_UNIT);
}

/** Longitudes admisibles de la barra, en milímetros. Números redondos de los
 * que se leen de un vistazo: nadie mide contra una barra de 37 mm. */
const NICE_LENGTHS_MM = [1, 2, 5, 10, 20, 50, 100, 200];

export interface ScaleBarLength {
  mm: number;
  px: number;
}

/** La barra más larga de la lista que quepa en el ancho dado.
 *
 * Se prefiere larga: una barra corta se mide peor, porque el error relativo de
 * apreciar sus extremos pesa más. Si ni la más corta cabe —zoom extremo— se
 * devuelve esa, y la barra se saldrá del hueco previsto en vez de mentir sobre
 * su longitud. */
export function chooseScaleBar(
  pxPerMm: number,
  maxWidthPx: number
): ScaleBarLength {
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) {
    return { mm: NICE_LENGTHS_MM[0], px: 0 };
  }
  let chosen = NICE_LENGTHS_MM[0];
  for (const mm of NICE_LENGTHS_MM) {
    if (mm * pxPerMm <= maxWidthPx) chosen = mm;
  }
  return { mm: chosen, px: chosen * pxPerMm };
}

/** Cómo se escribe esa longitud. En centímetros a partir de 10 mm, que es
 * como se habla de un corazón. */
export function formatScaleLength(mm: number): string {
  return mm >= 10 ? `${mm / 10} cm` : `${mm} mm`;
}
