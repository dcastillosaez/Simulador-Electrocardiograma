export type ThemeName = "dark" | "light";

/** Roles de color del trazado. Es lo único de un tema que el renderer de
 * Canvas necesita, y se pasa por parámetro: el renderer nunca consulta el DOM,
 * así que las funciones de dibujo siguen siendo puras y testeables con un
 * contexto simulado. */
export interface EcgTheme {
  background: string;
  gridMinor: string;
  gridMajor: string;
  trace: string;
  calibration: string;
  cursor: string;
}

export interface Theme {
  name: ThemeName;
  ecg: EcgTheme;
  /** `inset` es el fondo de los bloques que van DENTRO de un panel. Un panel
   * con cuatro apartados apilados al mismo tono se lee como una lista larga;
   * hundir cada apartado un escalón dice dónde empieza y dónde acaba cada uno
   * sin gastar una línea de separación por bloque. */
  panel: { background: string; border: string; hover: string; inset: string };
  inspector: { ok: string; warning: string; critical: string };
  axis: { normal: string; left: string; right: string; extreme: string };
  text: { primary: string; muted: string };
  surface: { background: string };
}
