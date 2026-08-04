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
  panel: { background: string; border: string; hover: string };
  inspector: { ok: string; warning: string; critical: string };
  axis: { normal: string; left: string; right: string; extreme: string };
  text: { primary: string; muted: string };
  surface: { background: string };
}
