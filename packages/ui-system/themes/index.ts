import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import type { Theme, ThemeName } from "./types";

export type { Theme, ThemeName, EcgTheme } from "./types";

/** Un grupo de roles de un tema: el nombre del campo (p.ej. `"ecg"`) junto con
 * su objeto de valores (p.ej. `{ gridMinor: "#...", ... }`). */
export type ThemeRoleGroup = [group: string, values: Record<string, string>];

/** Recorre los campos de nivel superior de un tema y devuelve solo los que
 * son grupos de roles (objetos), descartando los escalares — hoy únicamente
 * `name: ThemeName`. Es la única fuente de la lista de grupos: tanto
 * `tokens/css.ts` (para emitir las custom properties) como `themes.test.ts`
 * (para comparar `dark` y `light`) la consumen, así que añadir un grupo
 * nuevo a `Theme` no exige tocar ninguno de los dos y ambos ven siempre el
 * mismo conjunto. Un escalar futuro (string, número, booleano) se ignora
 * igual que `name`; solo un campo escalar que además fuera un objeto —algo
 * que no encaja con el propio nombre "escalar"— escaparía a este filtro. */
export function themeRoleGroups(theme: Theme): ThemeRoleGroup[] {
  return Object.entries(theme).filter(
    (entry): entry is ThemeRoleGroup => typeof entry[1] === "object" && entry[1] !== null
  );
}

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
