import styles from "./Icon.module.css";

/** Trazados propios, deliberadamente simples. No se trae una librería de
 * iconos: hacen falta diez formas, y una dependencia entera para eso no se
 * paga sola. */
const PATHS = {
  play: ["M8 5l11 7-11 7z"],
  pause: ["M9 5v14", "M15 5v14"],
  stop: ["M6 6h12v12H6z"],
  ecg: ["M2 12h4l3-8 4 16 3-8h6"],
  signal: ["M5 12a10 10 0 0 1 14 0", "M8 15a6 6 0 0 1 8 0", "M12 18h.01"],
  warning: ["M12 3l9 16H3z", "M12 9v5", "M12 17h.01"],
  error: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M9 9l6 6", "M15 9l-6 6"],
  download: ["M12 3v12", "M8 11l4 4 4-4", "M4 20h16"],
  settings: [
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    "M12 3v3",
    "M12 18v3",
    "M4.5 7.5l2 1.5",
    "M17.5 15l2 1.5",
    "M4.5 16.5l2-1.5",
    "M17.5 9l2-1.5",
  ],
  heart: ["M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5c0 5-7 9.5-7 9.5z"],
  zoom: ["M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M15.5 15.5l4.5 4.5"],
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Lado del cuadrado, en píxeles. Por defecto 16: los iconos de una consola
   * clínica acompañan al texto, no lo dominan. */
  size?: number;
  /** Si se pasa, el icono se anuncia como imagen con ese nombre. Si no, queda
   * oculto para lectores de pantalla, que es lo correcto cuando el texto de al
   * lado ya dice lo mismo. */
  label?: string;
}

export function Icon({ name, size = 16, label }: IconProps) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
