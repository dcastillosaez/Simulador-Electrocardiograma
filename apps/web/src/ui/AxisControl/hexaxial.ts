// Convención del ECG hexaxial: lead I horizontal (0°) hacia la izquierda del
// paciente, aVF (+90°) hacia los pies. En pantalla el eje +y va hacia abajo,
// así que los grados positivos son horarios y +90° queda abajo, que coincide
// con la lectura clínica del diagrama.

export interface HexaxialLead {
  name: string;
  angleDeg: number;
}

/** Las seis derivaciones de miembros en sus ángulos reales. */
export const HEXAXIAL_LEADS: readonly HexaxialLead[] = [
  { name: "I", angleDeg: 0 },
  { name: "II", angleDeg: 60 },
  { name: "aVF", angleDeg: 90 },
  { name: "III", angleDeg: 120 },
  { name: "aVR", angleDeg: -150 },
  { name: "aVL", angleDeg: -30 },
];

/** Ángulo (grados, (−180,180]) del punto (x,y) respecto al centro (cx,cy). */
export function angleFromPoint(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

/** Punto a distancia `radius` en la dirección `deg`, relativo al centro. */
export function tipFor(deg: number, radius: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}
