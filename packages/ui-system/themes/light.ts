import { palette } from "../tokens/tokens";
import type { Theme } from "./types";

/** Papel de ECG. No es un tema inventado: son los colores que el renderer ya
 * tenía escritos a mano antes de esta entrega. Existe además por una razón
 * estructural — con un solo tema la costura de intercambio no se ejercita
 * nunca, y se descubre que no funciona el día que hace falta. */
export const lightTheme: Theme = {
  name: "light",
  ecg: {
    background: palette.paperWhite,
    gridMinor: palette.paperGridDim,
    gridMajor: palette.paperGridBright,
    trace: palette.paperInk,
    calibration: palette.ink700,
    cursor: palette.paperGridBright,
  },
  panel: {
    background: palette.paperWhite,
    border: palette.paperGridDim,
    hover: palette.paperGridDim,
  },
  inspector: {
    ok: palette.signalOk,
    warning: palette.signalWarning,
    critical: palette.signalError,
  },
  text: {
    primary: palette.ink900,
    muted: palette.ink700,
  },
  surface: {
    background: palette.paperWhite,
  },
};
