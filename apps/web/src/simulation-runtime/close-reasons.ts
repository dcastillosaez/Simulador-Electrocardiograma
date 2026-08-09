/** Por qué se cerró la conexión, dicho para quien está delante.
 *
 * «Desconectado» a secas hace que un servidor lleno y un servidor apagado se
 * vean igual, y son dos problemas con dos soluciones distintas: uno se arregla
 * esperando y el otro arrancando el backend. El servidor ya manda el código y
 * el motivo; lo único que faltaba era enseñarlo.
 */

export interface CloseInfo {
  code: number;
  reason: string;
}

/** Códigos de cierre de WebSocket que este servidor usa a propósito. */
const CLOSE_MESSAGES: Record<number, string> = {
  // El aforo del servidor (ver `limits.py`). No es un fallo: es que no cabe
  // nadie más ahora mismo.
  1013: "El servidor está al completo. Vuelve a intentarlo en unos minutos.",
  // Política incumplida. Hoy solo lo emite la comprobación de origen.
  1008: "El servidor rechazó la conexión.",
  // Fallo interno del simulador, ya notificado antes por el canal de errores.
  1011: "El simulador falló y cerró la sesión.",
  // Cierre anormal: el navegador lo usa cuando no hubo cierre limpio, que en
  // la práctica es «no hay nadie escuchando en esa dirección».
  1006: "No se pudo contactar con el servidor. ¿Está arrancado?",
};

export function describeClose(info: CloseInfo | null): string | null {
  if (info === null) return null;
  // El motivo que manda el servidor gana al mensaje genérico: lo escribió
  // quien sabe exactamente qué pasó.
  if (info.reason) return info.reason;
  return CLOSE_MESSAGES[info.code] ?? null;
}
