import { palette } from "../tokens/tokens";
import type { Theme } from "./types";

/** Monitor clínico. Fondo muy oscuro pero no negro puro, rejilla roja tenue y
 * trazo verde ligeramente fosforito, como un monitor de cabecera moderno. */
export const darkTheme: Theme = {
  name: "dark",
  ecg: {
    background: palette.ink900,
    gridMinor: palette.gridRedDim,
    gridMajor: palette.gridRedBright,
    trace: palette.phosphorGreen,
    calibration: palette.ink300,
    cursor: palette.phosphorGreen,
  },
  panel: {
    background: palette.ink850,
    border: palette.ink700,
    hover: palette.ink700,
  },
  inspector: {
    ok: palette.signalOk,
    warning: palette.signalWarning,
    critical: palette.signalError,
  },
  axis: {
    normal: palette.axisNormal,
    left: palette.axisLeft,
    right: palette.axisRight,
    extreme: palette.axisExtreme,
  },
  text: {
    primary: palette.ink100,
    muted: palette.ink300,
  },
  surface: {
    background: palette.ink900,
  },
};
