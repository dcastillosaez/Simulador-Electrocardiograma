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

/** Emite las custom properties independientes del tema. Los roles de color los
 * añade `themes/` sobre este mismo fichero: aquí solo vive lo que no cambia al
 * cambiar de tema. */
export function renderTokensCss(): string {
  return [
    BANNER,
    "",
    ":root {",
    ...block("space", space),
    ...block("radius", radius),
    ...block("font", font),
    ...block("font-size", fontSize),
    ...block("font-weight", fontWeight),
    ...block("line-height", lineHeight),
    ...block("shadow", shadow),
    ...block("motion", motion),
    "}",
    "",
  ].join("\n");
}
