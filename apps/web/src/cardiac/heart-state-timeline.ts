import type { HeartStateMessage } from "../types/ws-messages";

export type HeartStateValues = HeartStateMessage["values"];

interface Entry {
  tS: number;
  values: HeartStateValues;
}

/** El estado mecánico del corazón como tramos constantes en el tiempo.
 *
 * El servidor lo publica cuatro veces por segundo con el instante al que
 * corresponde (`t_s`). Aquí solo se guarda cuando cambia, y la consulta
 * devuelve el vigente en `tS`: si el modo de una cámara cambió hace seis
 * segundos, repasar ese tramo devuelve el corazón de entonces y no el de
 * ahora.
 *
 * Antes del primer estado conocido se devuelve el primero: no hay nada mejor
 * que enseñar, y es el que tenía la sesión al empezar. */
export class HeartStateTimeline {
  private entries: Entry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(values: HeartStateValues, tS: number): void {
    const last = this.entries[this.entries.length - 1];
    if (last && sameState(last.values, values)) return;
    if (last && tS < last.tS) {
      // Llega desordenado: se coloca en su sitio para que la consulta, que
      // recorre por orden, siga siendo correcta.
      this.entries.push({ tS, values });
      this.entries.sort((a, b) => a.tS - b.tS);
      return;
    }
    this.entries.push({ tS, values });
  }

  valuesAt(tS: number): HeartStateValues | null {
    if (this.entries.length === 0) return null;
    let current = this.entries[0].values;
    for (const entry of this.entries) {
      if (entry.tS > tS) break;
      current = entry.values;
    }
    return current;
  }

  /** Descarta lo anterior a `tS`, conservando el estado vigente en `tS`: sin
   * él, una consulta justo después de la poda no sabría qué modo tenía el
   * corazón. */
  prune(tS: number): void {
    let keepFrom = 0;
    for (let i = 0; i < this.entries.length; i += 1) {
      if (this.entries[i].tS <= tS) keepFrom = i;
    }
    if (keepFrom > 0) this.entries = this.entries.slice(keepFrom);
  }

  clear(): void {
    this.entries = [];
  }
}

function sameState(a: HeartStateValues, b: HeartStateValues): boolean {
  return (
    a.rhythm_id === b.rhythm_id &&
    a.heart_rate_bpm === b.heart_rate_bpm &&
    a.atrial_mode === b.atrial_mode &&
    a.ventricular_mode === b.ventricular_mode &&
    a.atrial_amplitude === b.atrial_amplitude &&
    a.ventricular_amplitude === b.ventricular_amplitude &&
    a.flutter_hz === b.flutter_hz
  );
}
