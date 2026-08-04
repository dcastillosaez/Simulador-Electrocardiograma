/** Valores crudos del sistema de diseño.
 *
 * Aquí no hay roles: `palette.phosphorGreen` no es "el color del trazo", es un
 * verde. Quién lo usa y para qué lo decide el tema (`../themes/`). La razón es
 * que un rol sobrevive a un cambio de identidad visual y un nombre de color
 * no: el día del modo daltonismo, `theme.inspector.critical` seguirá
 * significando lo mismo aunque deje de ser rojo.
 *
 * Este fichero es la fuente única. De él se genera el CSS que consume React, y
 * de él importan directamente el renderer de Canvas y, en su día, Three.js. */

export const palette = {
  ink900: "#111315",
  ink850: "#181B20",
  ink700: "#2E3440",
  ink300: "#B6BDC8",
  ink100: "#F4F5F7",

  // Sólidos, no rojos translúcidos. Sobre un fondo conocido el resultado se ve
  // igual, pero el canvas se ahorra componer alfa en cada línea de cada tira
  // en cada repintado.
  gridRedDim: "#421010",
  gridRedBright: "#6B1C1C",

  phosphorGreen: "#37FF90",

  signalOk: "#32D583",
  signalWarning: "#FBBF24",
  signalError: "#EF4444",

  // Aspecto de papel de ECG: son los valores que el renderer ya tenía escritos
  // a mano antes de esta entrega, rescatados en vez de borrados.
  paperWhite: "#FFFFFF",
  paperGridDim: "#F4C6C6",
  paperGridBright: "#E08080",
  paperInk: "#000000",

  // Zonas del eje eléctrico: verde tenue en normal, azul en desviación
  // izquierda, ámbar en derecha, rojo oscuro en eje extremo.
  axisNormal: "#2E7D5B",
  axisLeft: "#3B6EA5",
  axisRight: "#B7791F",
  axisExtreme: "#7A2E2E",
} as const;

export const space = {
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "5": "24px",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "16px",
} as const;

export const font = {
  ui: 'Inter, "IBM Plex Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Roboto Mono", ui-monospace, monospace',
} as const;

export const fontSize = {
  xs: "11px",
  sm: "12px",
  md: "14px",
  lg: "18px",
  xl: "24px",
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
} as const;

export const lineHeight = {
  tight: "1.2",
  normal: "1.5",
} as const;

export const shadow = {
  card: "0 1px 2px rgba(0, 0, 0, 0.4)",
  dialog: "0 8px 24px rgba(0, 0, 0, 0.5)",
  overlay: "0 2px 8px rgba(0, 0, 0, 0.45)",
} as const;

export const motion = {
  fast: "120ms",
  normal: "200ms",
  slow: "320ms",
} as const;
