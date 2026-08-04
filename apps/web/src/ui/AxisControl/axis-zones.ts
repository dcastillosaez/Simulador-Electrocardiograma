// Espejo de `zone_for`/`AxisZone` del motor (packages/ecg-engine/leads.py).
// Se mantiene a mano con el test de contrato de al lado, igual que la cabecera
// binaria de 40 bytes es espejo de frames.py. Existe para que el disco pueda
// colorear la zona mientras el usuario arrastra, sin ida y vuelta al servidor.

export type AxisZone = "normal" | "left" | "right" | "extreme";

/** Lleva un ángulo cualquiera a (−180, +180]. */
export function normalizeDeg(deg: number): number {
  const d = (((deg + 180) % 360) + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

export function zoneFor(deg: number): AxisZone {
  const a = normalizeDeg(deg);
  if (a >= -30 && a <= 90) return "normal";
  if (a >= -90 && a < -30) return "left";
  if (a > 90 && a <= 180) return "right";
  return "extreme";
}

export const ZONE_LABEL: Record<AxisZone, string> = {
  normal: "eje normal",
  left: "desviación izquierda",
  right: "desviación derecha",
  extreme: "eje extremo",
};

/** Nota docente bajo el disco. No modifica la señal ni condiciona nada. */
export const ZONE_NOTE: Record<AxisZone, string> = {
  normal: "Eje entre −30° y +90°: orientación normal del adulto.",
  left: "Compatible con hemibloqueo anterior izquierdo, hipertrofia ventricular izquierda o cardiopatía isquémica.",
  right: "Compatible con hemibloqueo posterior izquierdo, hipertrofia ventricular derecha o corazón vertical.",
  extreme: "Eje en tierra de nadie: sospechar ritmo de origen ventricular o error de colocación de electrodos.",
};
