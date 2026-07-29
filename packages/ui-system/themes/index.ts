import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import type { Theme, ThemeName } from "./types";

export type { Theme, ThemeName, EcgTheme } from "./types";

export const THEME_NAMES = ["dark", "light"] as const satisfies readonly ThemeName[];

const THEMES: Record<ThemeName, Theme> = {
  dark: darkTheme,
  light: lightTheme,
};

let active: ThemeName = "dark";

export function activeThemeName(): ThemeName {
  return active;
}

/** Sin argumento devuelve el tema activo. Con argumento, ese tema concreto —
 * lo necesitan el generador de CSS y los tests, que deben poder mirar un tema
 * sin activarlo. */
export function getTheme(name: ThemeName = active): Theme {
  return THEMES[name];
}

/** Cambia el tema activo y lo marca en el elemento raíz, que es de donde el
 * CSS toma su juego de custom properties. El repintado del canvas no ocurre
 * aquí: lo dispara quien observa este cambio (ver useSweepRenderer). */
export function setTheme(name: ThemeName): void {
  active = name;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = name;
  }
}
