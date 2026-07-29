import { getTheme, themeRoleGroups } from "../themes/index";
import type { Theme } from "../themes/types";
import {
  font,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  shadow,
  space,
} from "./tokens";

const BANNER =
  "/* GENERADO por tokens/build.ts. No editar a mano: `npm run tokens`. */";

function block(prefix: string, values: Record<string, string>): string[] {
  return Object.entries(values).map(([key, value]) => `  --${prefix}-${key}: ${value};`);
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Aplana los roles del tema a custom properties: `theme.ecg.gridMinor` sale
 * como `--ecg-grid-minor`. Los grupos salen de `themeRoleGroups`, que recorre
 * el objeto de tema en vez de listarlos a mano, así que añadir un rol a
 * `Theme` no obliga a tocar este generador — ver el docstring de
 * `themeRoleGroups` en `themes/index.ts`, que es también quien usa
 * `themes.test.ts` para no duplicar esta lista. */
function themeBlock(theme: Theme): string[] {
  return themeRoleGroups(theme).flatMap(([group, values]) =>
    Object.entries(values).map(([role, color]) => `  --${group}-${kebab(role)}: ${color};`)
  );
}

/** Pares prefijo CSS -> grupo de tokens que `renderTokensCss` emite bajo
 * `:root`. Fuente única de la relación grupo<->prefijo: el generador la
 * consume para construir el CSS y `css.test.ts` la consume para verificar,
 * grupo a grupo, que lo que hay en `tokens.ts` aparece en el CSS con el
 * nombre de custom property correcto. `palette` no está aquí a propósito:
 * los roles de color son de `themes/`, no de este fichero. */
export const TOKEN_CSS_GROUPS: ReadonlyArray<
  readonly [prefix: string, group: Record<string, string>]
> = [
  ["space", space],
  ["radius", radius],
  ["font", font],
  ["font-size", fontSize],
  ["font-weight", fontWeight],
  ["line-height", lineHeight],
  ["shadow", shadow],
  ["motion", motion],
];

/** Emite las custom properties independientes del tema bajo `:root`, y a
 * continuación los roles de color de cada tema: `dark` dentro del propio
 * `:root` (juego por defecto) y `light` bajo `:root[data-theme="light"]`. */
export function renderTokensCss(): string {
  return [
    BANNER,
    "",
    ":root {",
    ...TOKEN_CSS_GROUPS.flatMap(([prefix, group]) => block(prefix, group)),
    "",
    ...themeBlock(getTheme("dark")),
    "}",
    "",
    // El selector de atributo gana al `:root` desnudo por especificidad, así
    // que basta marcar el elemento raíz para intercambiar el juego entero.
    ':root[data-theme="light"] {',
    ...themeBlock(getTheme("light")),
    "}",
    "",
  ].join("\n");
}
