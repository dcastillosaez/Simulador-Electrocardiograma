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

/** Emite las custom properties independientes del tema. Los roles de color los
 * añade `themes/` sobre este mismo fichero: aquí solo vive lo que no cambia al
 * cambiar de tema. */
export function renderTokensCss(): string {
  return [
    BANNER,
    "",
    ":root {",
    ...TOKEN_CSS_GROUPS.flatMap(([prefix, group]) => block(prefix, group)),
    "}",
    "",
  ].join("\n");
}
