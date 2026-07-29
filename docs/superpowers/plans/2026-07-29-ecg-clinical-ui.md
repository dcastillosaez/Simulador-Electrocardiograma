# Puesto de simulación clínica — Plan de implementación (Entrega 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la vista en vivo del simulador en una consola de simulación clínica, con un sistema de diseño propio del que beben React y el canvas, y sin un solo color ni escala escritos a mano en el renderer.

**Architecture:** Un paquete `packages/ui-system` guarda los tokens tipados en TypeScript y genera de ellos el CSS que consume React; Canvas importa el modelo tipado directamente y recibe siempre un `Theme` ya resuelto, así que las funciones de dibujo siguen siendo puras. Un `LayoutEngine` traduce el tamaño del contenedor a un `LayoutMetrics` con la cadena de escalas mV → mm → px, y todo el renderer consume ese objeto. El barrido gana un `SweepRebuilder` para repintar el anillo completo cuando cambia tamaño, tema o layout, y el `SweepBuffer` guarda la continuidad de la señal para que ese repintado no reintroduzca interpolación.

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest 3 (jsdom), CSS Modules, custom properties CSS, Canvas 2D. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-07-29-ecg-clinical-ui-design.md`

## Global Constraints

- **La verdad visual es el modelo tipado en TypeScript.** El renderer **nunca** consulta el DOM: ni `getComputedStyle`, ni `document`, ni `window`. Recibe un `Theme` resuelto como parámetro.
- **Cero literales de color en `apps/web/src/render/`.** Ningún `#rrggbb`, `rgb(...)` ni nombre de color CSS. El test de tema centinela (Task 6) lo verifica.
- **Cero números mágicos de espaciado.** Todo margen, relleno y hueco sale de `var(--space-N)`.
- **CSS Grid para la shell; Flexbox solo dentro de componentes.**
- **El área de ECG nunca hace scroll.** Ni `overflow: auto`, ni `overflow: scroll`.
- **El repintado completo jamás entra en `requestAnimationFrame`.**
- **El árbol de accesibilidad se conserva.** Estos nombres siguen existiendo, con este texto exacto:
  - `aria-label="Seleccionar ritmo"` — lo usan el test unitario y el e2e de Playwright
  - `data-testid="lead-canvas-${lead}"` para las doce derivaciones
  - `aria-label="Calidad de señal"`, `aria-label="Derivaciones visibles"` (con `role="radiogroup"`)
  - `aria-label="Bajar frecuencia"`, `aria-label="Subir frecuencia"`
  - `aria-label` de los sliders de ruido: `"EMG"`, `"Interferencia 50Hz"`, `"Línea base"`, `"Movimiento"`, `"Saturación"`
  - `role="status"` y `role="alert"`
  - Textos literales `"Esperando señal…"` (con puntos suspensivos tipográficos, U+2026), `"Desconectado"`, `"Volver a modo básico"`
- **Valores fijos del sistema** (copiados del spec, §4 y §6): mínimo de tira 52 px, umbral de compacto 65 px, máximo 140 px, hueco entre tiras 4 px, margen vertical de señal 2 mV a cada lado, ganancia clínica 10 mm/mV, velocidad de papel 25 mm/s.
- **Los 120 tests existentes siguen pasando** al terminar cada tarea, salvo los que la propia tarea adapta a propósito.

## Corrección al spec

El §6 del spec escribe el reparto de altura como `clamp(52, (alto − huecos) / n, 140)` y en el párrafo siguiente dice que el mínimo es blando. Las dos cosas se contradicen: un `clamp` con suelo en 52 nunca baja de 52, y entonces doce derivaciones desbordan la ventana en un portátil, que es justo lo que el spec quiere evitar.

**Lo correcto, y lo que implementa este plan:** el tope superior es duro, el inferior no existe como recorte. El valor se calcula, se limita solo por arriba, y de dónde cae sale el nivel de compresión:

```
stripHeightPx = min(140, (alto − huecos) / n)     // sin suelo en 52
compression   = stripHeightPx >= 65 ? "normal"
              : stripHeightPx >= 52 ? "compact"
              : "very-compact"
```

Se conserva un suelo absoluto de seguridad de 16 px para no crear canvas degenerados en ventanas diminutas. Hay que corregir esa línea del spec al cerrar la entrega.

## Estructura de ficheros

```
packages/ui-system/
├── tokens/
│   ├── tokens.ts            valores crudos: paleta, espaciado, radios, tipografía, sombras, motion
│   ├── css.ts               renderTokensCss(): string — puro, testeable
│   ├── css.test.ts          sincronía del artefacto
│   ├── build.ts             script: escribe tokens.css
│   └── tokens.css           GENERADO. Se commitea, no se edita
├── themes/
│   ├── types.ts             Theme, EcgTheme, ThemeName
│   ├── dark.ts              monitor clínico
│   ├── light.ts             papel de ECG
│   ├── index.ts             getTheme, setTheme, useTheme
│   └── themes.test.ts
├── components/
│   ├── foundation/          Icon, Tooltip
│   ├── surface/             Panel, SectionTitle, Divider, ControlGroup
│   ├── data/                Metric, MetricGrid, Badge
│   ├── controls/            SegmentedControl, Slider, Stepper, Select
│   └── layout/              AppShell, Header, Sidebar, Inspector, StatusBar
└── index.ts                 superficie pública del paquete

apps/web/src/render/
├── layout-engine.ts         NUEVO: LayoutMetrics, computeLayoutMetrics
├── sweep-rebuilder.ts       NUEVO: repintado completo del anillo
├── grid-layer.ts            MODIFICAR: métricas + tema
├── lead-canvas.ts           MODIFICAR: métricas + tema, ERASE_BAND_MM
└── sweep-buffer.ts          MODIFICAR: continuityMask, writtenCount

apps/web/src/ui/
├── ECGWorkspace.tsx         REESCRIBIR: solo orquestación
├── EcgDisplay.tsx           NUEVO: contenedor medido
├── LeadStrip.tsx            NUEVO: una derivación
└── hooks/
    ├── useSimulationRuntime.ts
    ├── useLayoutMetrics.ts
    └── useSweepRenderer.ts
```

Cada componente del ui-system vive en su carpeta con su `.module.css` al lado y su test al lado. Los ficheros que cambian juntos viven juntos.

---

### Task 1: Tokens y cableado del paquete

Monta `packages/ui-system` con los valores crudos, el generador de CSS y el alias que permite importarlo desde la app. No hay colores todavía: los roles de color los asigna el tema en la Task 2, y meterlos aquí obligaría a importar los temas antes de que existan.

**Files:**
- Create: `packages/ui-system/tokens/tokens.ts`
- Create: `packages/ui-system/tokens/css.ts`
- Create: `packages/ui-system/tokens/build.ts`
- Create: `packages/ui-system/tokens/tokens.css` (generado en el paso 5)
- Create: `packages/ui-system/index.ts`
- Test: `packages/ui-system/tokens/css.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: nada.
- Produces: `palette`, `space`, `radius`, `font`, `fontSize`, `fontWeight`, `lineHeight`, `shadow`, `motion` desde `@ui-system/tokens/tokens`. `renderTokensCss(): string` desde `@ui-system/tokens/css`. Alias `@ui-system/*` resuelto en Vite, TypeScript y Vitest.

- [ ] **Step 1: Configurar el alias y ampliar el alcance de los tests**

Sin esto, un test dentro de `packages/` no lo recoge Vitest: su raíz es `apps/web` y el `include` por defecto no sale de ahí.

`apps/web/vite.config.ts` — reemplazar el fichero completo:

```ts
/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

const uiSystem = fileURLToPath(new URL("../../packages/ui-system", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@ui-system": uiSystem },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // El ui-system vive fuera de la raíz de Vitest (`apps/web`), así que hay
    // que nombrarlo: el include por defecto no sale de la raíz y sus tests
    // quedarían invisibles, en verde por no existir.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "../../packages/ui-system/**/*.{test,spec}.{ts,tsx}",
    ],
    // Redundante con el `include` de arriba, pero se mantiene explícito: las
    // specs de Playwright llaman al `test()` de @playwright/test, no al de
    // Vitest, y recogerlas rompe la recolección con "Playwright Test did not
    // expect test() to be called here".
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
```

`apps/web/tsconfig.json` — añadir `baseUrl`, `paths` y ampliar `include`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "@ui-system": ["../../packages/ui-system/index.ts"],
      "@ui-system/*": ["../../packages/ui-system/*"]
    }
  },
  "include": ["src", "../../packages/ui-system"]
}
```

`apps/web/package.json` — añadir el script `tokens` junto a los existentes:

```json
    "tokens": "vite-node ../../packages/ui-system/tokens/build.ts",
```

- [ ] **Step 2: Escribir el test que falla**

`packages/ui-system/tokens/css.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "./css";
import { space } from "./tokens";

describe("renderTokensCss", () => {
  it("emite una custom property por cada valor de espaciado", () => {
    const css = renderTokensCss();
    for (const [key, value] of Object.entries(space)) {
      expect(css).toContain(`--space-${key}: ${value};`);
    }
  });

  it("declara los valores dentro de :root", () => {
    expect(renderTokensCss()).toMatch(/:root\s*\{/);
  });

  it("avisa de que el fichero es generado", () => {
    expect(renderTokensCss()).toContain("GENERADO");
  });

  // El guardarraíl de verdad: tokens.css es un artefacto. Si alguien lo edita
  // a mano, o cambia tokens.ts y olvida `npm run tokens`, CSS y modelo tipado
  // se separan en silencio -- que es exactamente la clase de bug que todo el
  // sistema de tokens existe para hacer imposible.
  it("el tokens.css commiteado coincide con lo que emite el generador", () => {
    const committed = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    expect(committed.replace(/\r\n/g, "\n")).toBe(renderTokensCss());
  });
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/tokens/css.test.ts`
Expected: FAIL — `Failed to resolve import "./css"`.

- [ ] **Step 4: Escribir tokens y generador**

`packages/ui-system/tokens/tokens.ts`:

```ts
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
```

`packages/ui-system/tokens/css.ts`:

```ts
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
```

`packages/ui-system/tokens/build.ts`:

```ts
import { writeFileSync } from "node:fs";
import { renderTokensCss } from "./css";

// Script, no módulo: se ejecuta con `npm run tokens` (vite-node). La lógica
// vive en css.ts para poder testearla sin efectos secundarios.
writeFileSync(new URL("./tokens.css", import.meta.url), renderTokensCss(), "utf8");
process.stdout.write("tokens.css generado\n");
```

`packages/ui-system/index.ts`:

```ts
// Superficie pública del paquete. Nada de fuera importa rutas internas: el día
// que esto sea un paquete npm de verdad, este fichero es el `main`.
export * from "./tokens/tokens";
```

- [ ] **Step 5: Generar el artefacto y verificar que los tests pasan**

Run: `cd apps/web && npm run tokens && npx vitest run ../../packages/ui-system/tokens/css.test.ts`
Expected: `tokens.css generado`, y 4 tests PASS.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 124 tests PASS (120 previos + 4 nuevos).

- [ ] **Step 7: Commit**

```bash
git add packages/ui-system apps/web/vite.config.ts apps/web/tsconfig.json apps/web/package.json
git commit -m "feat(ui-system): tokens tipados y generacion de tokens.css

Monta packages/ui-system con los valores crudos del sistema de diseno y el
alias @ui-system en Vite, TypeScript y Vitest. tokens.css es un artefacto
generado y un test falla si se separa de tokens.ts."
```

---

### Task 2: Theme Engine

Los tokens son valores; el tema asigna roles y decide qué conjunto está activo. Aquí aparecen los dos temas y la parte de CSS que sí depende del tema.

**Files:**
- Create: `packages/ui-system/themes/types.ts`
- Create: `packages/ui-system/themes/dark.ts`
- Create: `packages/ui-system/themes/light.ts`
- Create: `packages/ui-system/themes/index.ts`
- Test: `packages/ui-system/themes/themes.test.ts`
- Modify: `packages/ui-system/tokens/css.ts`
- Modify: `packages/ui-system/tokens/tokens.css` (regenerar)
- Modify: `packages/ui-system/index.ts`

**Interfaces:**
- Consumes: `palette` de Task 1.
- Produces: tipos `Theme`, `EcgTheme`, `ThemeName` y funciones `getTheme(name?): Theme`, `setTheme(name): void`, `activeThemeName(): ThemeName` desde `@ui-system/themes`. `renderTokensCss()` pasa a emitir también los roles de color.

- [ ] **Step 1: Escribir el test que falla**

`packages/ui-system/themes/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activeThemeName, getTheme, setTheme, THEME_NAMES } from "./index";
import type { Theme } from "./types";

function allColorStrings(theme: Theme): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(theme.ecg);
  walk(theme.panel);
  walk(theme.inspector);
  walk(theme.text);
  walk(theme.surface);
  return out;
}

describe("temas", () => {
  it("los dos temas definen exactamente los mismos roles", () => {
    // Sin esto, añadir un rol a `dark` y olvidarlo en `light` no lo detecta
    // nadie hasta que alguien cambia de tema y ve un `undefined` pintado.
    const roleKeys = (theme: Theme) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries({
            ecg: theme.ecg,
            panel: theme.panel,
            inspector: theme.inspector,
            text: theme.text,
            surface: theme.surface,
          }).map(([group, values]) => [group, Object.keys(values).sort()])
        )
      );
    expect(roleKeys(getTheme("light"))).toBe(roleKeys(getTheme("dark")));
  });

  it("ningun rol queda sin valor", () => {
    for (const name of THEME_NAMES) {
      for (const color of allColorStrings(getTheme(name))) {
        expect(color, `${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("el tema de papel y el de monitor no comparten el color de trazo", () => {
    expect(getTheme("light").ecg.trace).not.toBe(getTheme("dark").ecg.trace);
  });

  it("setTheme cambia el tema activo y lo marca en el elemento raiz", () => {
    setTheme("light");
    expect(activeThemeName()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    setTheme("dark");
    expect(activeThemeName()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("getTheme sin argumento devuelve el tema activo", () => {
    setTheme("light");
    expect(getTheme().name).toBe("light");
    setTheme("dark");
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/themes/themes.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Escribir tipos y temas**

`packages/ui-system/themes/types.ts`:

```ts
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
  text: { primary: string; muted: string };
  surface: { background: string };
}
```

`packages/ui-system/themes/dark.ts`:

```ts
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
  text: {
    primary: palette.ink100,
    muted: palette.ink300,
  },
  surface: {
    background: palette.ink900,
  },
};
```

`packages/ui-system/themes/light.ts`:

```ts
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
```

`packages/ui-system/themes/index.ts`:

```ts
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
```

- [ ] **Step 4: Emitir los roles de color en el CSS**

`packages/ui-system/tokens/css.ts` — reemplazar el fichero completo:

```ts
import { getTheme } from "../themes/index";
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
 * como `--ecg-grid-minor`. Se recorre el objeto en vez de listar los nombres a
 * mano para que añadir un rol no obligue a tocar el generador. */
function themeBlock(theme: Theme): string[] {
  const groups: Array<[string, Record<string, string>]> = [
    ["ecg", theme.ecg],
    ["panel", theme.panel],
    ["inspector", theme.inspector],
    ["text", theme.text],
    ["surface", theme.surface],
  ];
  return groups.flatMap(([group, values]) =>
    Object.entries(values).map(([role, color]) => `  --${group}-${kebab(role)}: ${color};`)
  );
}

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
```

`packages/ui-system/index.ts` — reemplazar el fichero completo:

```ts
// Superficie pública del paquete. Nada de fuera importa rutas internas: el día
// que esto sea un paquete npm de verdad, este fichero es el `main`.
export * from "./tokens/tokens";
export * from "./themes/index";
```

- [ ] **Step 5: Regenerar el artefacto y verificar**

Run: `cd apps/web && npm run tokens && npx vitest run ../../packages/ui-system/`
Expected: `tokens.css generado`; 9 tests PASS (4 de css + 5 de themes).

Comprobar a ojo que `packages/ui-system/tokens/tokens.css` contiene ahora `--ecg-trace: #37FF90;` dentro de `:root` y `--ecg-trace: #000000;` dentro de `:root[data-theme="light"]`.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 129 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-system
git commit -m "feat(ui-system): theme engine con roles semanticos y dos temas

Los tokens son valores; el tema asigna roles (ecg.trace, panel.border,
inspector.critical) y decide que conjunto esta activo. dark es el monitor
clinico; light rescata el aspecto de papel que el renderer tenia escrito a
mano. El generador de CSS emite ambos juegos y setTheme marca el elemento
raiz. Un test verifica que los dos temas definen los mismos roles."
```

---

### Task 3: LayoutEngine

Traduce el tamaño del contenedor a la cadena de escalas que consume todo el renderer. Es una función pura sin DOM: el hook que la alimenta llega en la Task 12.

**Files:**
- Create: `apps/web/src/render/layout-engine.ts`
- Test: `apps/web/src/render/layout-engine.test.ts`

**Interfaces:**
- Consumes: `PX_PER_MM` de `./grid-layer`.
- Produces: `LayoutMetrics` (campos `stripHeightPx`, `compression`, `clinicalGainMmPerMv`, `viewportScalePxPerMm`, `pixelsPerMillivolt`, `pixelsPerSecond`), `computeLayoutMetrics(availableHeightPx, leadCount, clinicalGainMmPerMv, paperSpeedMmS): LayoutMetrics`, y las constantes `STRIP_MIN_PX = 52`, `STRIP_COMPACT_PX = 65`, `STRIP_MAX_PX = 140`, `STRIP_GAP_PX = 4`, `STRIP_FLOOR_PX = 16`, `STRIP_MARGIN_MV = 2`.

- [ ] **Step 1: Escribir el test que falla**

`apps/web/src/render/layout-engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PX_PER_MM } from "./grid-layer";
import {
  STRIP_COMPACT_PX,
  STRIP_FLOOR_PX,
  STRIP_GAP_PX,
  STRIP_MARGIN_MV,
  STRIP_MAX_PX,
  STRIP_MIN_PX,
  computeLayoutMetrics,
} from "./layout-engine";

const GAIN = 10;
const SPEED = 25;

/** Alto que hay que dar al contenedor para que a cada tira le toquen
 * exactamente `stripPx`. Se calcula al revés para que los tests hablen de la
 * altura de tira, que es lo que importa, y no de aritmética de huecos. */
function heightFor(stripPx: number, leadCount: number): number {
  return stripPx * leadCount + STRIP_GAP_PX * (leadCount - 1);
}

describe("computeLayoutMetrics", () => {
  it("reparte el alto disponible entre las derivaciones, descontando los huecos", () => {
    const metrics = computeLayoutMetrics(heightFor(70, 12), 12, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(70);
  });

  it("nunca pasa del maximo, aunque sobre alto", () => {
    const metrics = computeLayoutMetrics(heightFor(400, 3), 3, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_MAX_PX);
  });

  it("el minimo es blando: por debajo de 52px sigue comprimiendo, no recorta", () => {
    // Es la decision del spec: el scroll esta descartado y ocultar
    // derivaciones en silencio es inaceptable en algo clinico, asi que las
    // tiras se comprimen mas y la interfaz lo declara. Un clamp con suelo en
    // 52 desbordaria la ventana, que es justo lo que se quiere evitar.
    const metrics = computeLayoutMetrics(heightFor(46, 12), 12, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(46);
    expect(metrics.stripHeightPx).toBeLessThan(STRIP_MIN_PX);
  });

  it("respeta un suelo absoluto para no crear canvas degenerados", () => {
    const metrics = computeLayoutMetrics(12, 12, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_FLOOR_PX);
  });

  it("clasifica la compresion en las tres fronteras", () => {
    const at = (stripPx: number, leads = 12) =>
      computeLayoutMetrics(heightFor(stripPx, leads), leads, GAIN, SPEED).compression;

    expect(at(STRIP_COMPACT_PX)).toBe("normal");
    expect(at(STRIP_COMPACT_PX - 1)).toBe("compact");
    expect(at(STRIP_MIN_PX)).toBe("compact");
    expect(at(STRIP_MIN_PX - 1)).toBe("very-compact");
  });

  it("la ganancia clinica no depende del tamano de la ventana", () => {
    // El nucleo de la separacion fisiologia/viewport: un milivoltio es un
    // milivoltio, y lo que cambia con la pantalla es cuantos pixeles lo
    // representan.
    const grande = computeLayoutMetrics(heightFor(120, 6), 6, GAIN, SPEED);
    const pequena = computeLayoutMetrics(heightFor(46, 12), 12, GAIN, SPEED);
    expect(grande.clinicalGainMmPerMv).toBe(GAIN);
    expect(pequena.clinicalGainMmPerMv).toBe(GAIN);
    expect(pequena.viewportScalePxPerMm).toBeLessThan(grande.viewportScalePxPerMm);
  });

  it("pixelsPerMillivolt es el producto de los dos eslabones", () => {
    const metrics = computeLayoutMetrics(heightFor(100, 6), 6, GAIN, SPEED);
    expect(metrics.pixelsPerMillivolt).toBeCloseTo(
      metrics.clinicalGainMmPerMv * metrics.viewportScalePxPerMm
    );
  });

  it("el caso de referencia de 152px reproduce la suposicion de 96dpi", () => {
    // Comprobacion que valida el modelo entero: los 152px que fijo el arreglo
    // I-2 equivalen a 3,8 px/mm, y PX_PER_MM (96/25,4) es 3,7795. Es el mismo
    // numero, luego aquel valor ya era implicitamente la suposicion de 96dpi.
    const metrics = computeLayoutMetrics(heightFor(152, 1), 1, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBeCloseTo(140); // el tope lo limita
    const suelto = 152 / (2 * STRIP_MARGIN_MV * GAIN);
    expect(suelto).toBeCloseTo(3.8);
    expect(suelto).toBeCloseTo(PX_PER_MM, 1);
  });

  it("la senal de 2mV cabe justo en media tira, sin recortar", () => {
    // Es la propiedad que arreglo I-2 y que ahora debe sobrevivir a cualquier
    // tamano de ventana: la R de V5 (~1,3mV) nunca toca el borde.
    for (const stripPx of [46, 70, 140]) {
      const metrics = computeLayoutMetrics(heightFor(stripPx, 12), 12, GAIN, SPEED);
      const halfPx = metrics.stripHeightPx / 2;
      expect(STRIP_MARGIN_MV * metrics.pixelsPerMillivolt).toBeCloseTo(halfPx);
    }
  });

  it("el eje horizontal no depende del alto de tira", () => {
    // Si viewportScale gobernase los dos ejes, comprimir 12 derivaciones daria
    // ~27 segundos por pantalla: un garabato ilegible.
    const alta = computeLayoutMetrics(heightFor(140, 3), 3, GAIN, SPEED);
    const baja = computeLayoutMetrics(heightFor(46, 12), 12, GAIN, SPEED);
    expect(baja.pixelsPerSecond).toBeCloseTo(alta.pixelsPerSecond);
    expect(alta.pixelsPerSecond).toBeCloseTo(SPEED * PX_PER_MM);
  });

  it("una sola derivacion no descuenta huecos", () => {
    const metrics = computeLayoutMetrics(300, 1, GAIN, SPEED);
    expect(metrics.stripHeightPx).toBe(STRIP_MAX_PX);
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd apps/web && npx vitest run src/render/layout-engine.test.ts`
Expected: FAIL — `Failed to resolve import "./layout-engine"`.

- [ ] **Step 3: Escribir el LayoutEngine**

`apps/web/src/render/layout-engine.ts`:

```ts
import { PX_PER_MM } from "./grid-layer";

/** Altura de tira por debajo de la cual la representación deja de ser óptima.
 * No es un recorte: ver `computeLayoutMetrics`. */
export const STRIP_MIN_PX = 52;
/** A partir de aquí la vista se considera holgada. */
export const STRIP_COMPACT_PX = 65;
/** Tope duro: más alto no aporta legibilidad y desperdicia pantalla. */
export const STRIP_MAX_PX = 140;
/** Hueco entre tiras. Es `--space-1`. */
export const STRIP_GAP_PX = 4;
/** Suelo absoluto de seguridad: por debajo el canvas deja de ser dibujable. */
export const STRIP_FLOOR_PX = 16;
/** Margen vertical reservado a cada lado de la línea base, en milivoltios. Con
 * 2mV la R de V5 (~1,3mV) nunca toca el borde, que es el arreglo I-2. */
export const STRIP_MARGIN_MV = 2;

export type Compression = "normal" | "compact" | "very-compact";

/** Todo lo que el renderer necesita saber sobre geometría. Se pasa entero en
 * vez de recalcular escalas en cada sitio: así no puede haber dos partes del
 * dibujo trabajando con escalas distintas. */
export interface LayoutMetrics {
  stripHeightPx: number;
  compression: Compression;
  /** Fisiología. El tamaño de la ventana no la toca jamás. */
  clinicalGainMmPerMv: number;
  /** Pantalla. Es el único eslabón que se adapta. */
  viewportScalePxPerMm: number;
  pixelsPerMillivolt: number;
  pixelsPerSecond: number;
}

function classify(stripHeightPx: number): Compression {
  if (stripHeightPx >= STRIP_COMPACT_PX) return "normal";
  if (stripHeightPx >= STRIP_MIN_PX) return "compact";
  return "very-compact";
}

/** Reparte el alto disponible entre `leadCount` derivaciones y deriva de ahí la
 * cadena de escalas mV → mm → px.
 *
 * El tope superior es duro; el inferior no existe como recorte. Un `clamp` con
 * suelo en `STRIP_MIN_PX` desbordaría la ventana con doce derivaciones en un
 * portátil, y el spec descarta tanto el scroll como ocultar derivaciones en
 * silencio: las tiras se comprimen más y `compression` lo declara para que la
 * interfaz avise. Degradación informada, no silenciosa. */
export function computeLayoutMetrics(
  availableHeightPx: number,
  leadCount: number,
  clinicalGainMmPerMv: number,
  paperSpeedMmS: number
): LayoutMetrics {
  const count = Math.max(1, Math.floor(leadCount));
  const gapsPx = STRIP_GAP_PX * (count - 1);
  const perStripPx = (availableHeightPx - gapsPx) / count;

  const stripHeightPx = Math.max(
    STRIP_FLOOR_PX,
    Math.min(STRIP_MAX_PX, perStripPx)
  );

  // La tira debe cubrir STRIP_MARGIN_MV a cada lado de la línea base, así que
  // el alto disponible fija cuántos píxeles vale un milímetro. La ganancia
  // clínica se queda fuera de este despeje: es un dato fisiológico, no una
  // consecuencia del tamaño de la ventana.
  const verticalMm = 2 * STRIP_MARGIN_MV * clinicalGainMmPerMv;
  const viewportScalePxPerMm = stripHeightPx / verticalMm;

  return {
    stripHeightPx,
    compression: classify(stripHeightPx),
    clinicalGainMmPerMv,
    viewportScalePxPerMm,
    pixelsPerMillivolt: clinicalGainMmPerMv * viewportScalePxPerMm,
    // Horizontal fijo, a propósito. Atarlo también a `viewportScale` daría
    // ~27 segundos por pantalla en compresión fuerte: ilegible.
    pixelsPerSecond: paperSpeedMmS * PX_PER_MM,
  };
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run src/render/layout-engine.test.ts`
Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render/layout-engine.ts apps/web/src/render/layout-engine.test.ts
git commit -m "feat(web): LayoutEngine con la cadena de escalas separada

computeLayoutMetrics reparte el alto entre derivaciones y deriva mV -> mm ->
px en tres eslabones separados: la ganancia clinica no depende del tamano de
la ventana, solo el viewportScale. El tope superior es duro y el inferior es
blando con nivel de compresion declarado, porque el scroll esta descartado y
ocultar derivaciones en silencio no es aceptable."
```

---

### Task 4: Continuidad de la señal en el SweepBuffer

Mientras el dibujo era incremental bastaba saber si *este* trozo venía tras un hueco. Para reconstruir la imagen entera desde el anillo hace falta que el buffer recuerde dónde estaban esos huecos: si no, el primer redimensionado de ventana deshace el arreglo I-3 uniendo con línea recta discontinuidades que se dibujaron con el lápiz levantado.

**Files:**
- Modify: `apps/web/src/render/sweep-buffer.ts`
- Test: `apps/web/src/render/sweep-buffer.test.ts`

**Interfaces:**
- Consumes: `LayoutMetrics` de Task 3.
- Produces: `sweepCapacitySamples(widthPx, pixelsPerSecond, sampleRateHz): number` (firma cambiada), y en `SweepBuffer`: `push(samples, options?: { gapBefore?: boolean })`, `isDiscontinuityAt(index): boolean`, `get writtenCount(): number`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `apps/web/src/render/sweep-buffer.test.ts`, dentro del `describe` existente de `SweepBuffer`:

```ts
  it("marca la discontinuidad en la posicion de la primera muestra del push", () => {
    const sweep = new SweepBuffer(16);
    sweep.push(new Float32Array([1, 2, 3]));
    sweep.push(new Float32Array([4, 5]), { gapBefore: true });

    expect(sweep.isDiscontinuityAt(0)).toBe(false);
    expect(sweep.isDiscontinuityAt(3)).toBe(true);
    expect(sweep.isDiscontinuityAt(4)).toBe(false);
  });

  it("un push sin hueco limpia una marca anterior en esa misma posicion", () => {
    // El anillo se reescribe cada vuelta. Sin limpiar, la marca de una vuelta
    // pasada reaparecería como un corte fantasma en la vuelta siguiente.
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1]), { gapBefore: true });
    expect(sweep.isDiscontinuityAt(0)).toBe(true);

    sweep.push(new Float32Array([2, 3, 4]));
    sweep.push(new Float32Array([5]));

    expect(sweep.isDiscontinuityAt(0)).toBe(false);
  });

  it("isDiscontinuityAt envuelve los indices como at()", () => {
    const sweep = new SweepBuffer(8);
    sweep.push(new Float32Array([1, 2]));
    sweep.push(new Float32Array([3]), { gapBefore: true });

    expect(sweep.isDiscontinuityAt(2)).toBe(true);
    expect(sweep.isDiscontinuityAt(10)).toBe(true);
    expect(sweep.isDiscontinuityAt(-6)).toBe(true);
  });

  it("writtenCount cuenta las muestras escritas y se satura en la capacidad", () => {
    // Lo necesita el repintado completo: sin saberlo, pintaría los ceros de
    // relleno del array como una linea plana en la parte del anillo que
    // todavia no se ha escrito nunca.
    const sweep = new SweepBuffer(4);
    expect(sweep.writtenCount).toBe(0);

    sweep.push(new Float32Array([1, 2]));
    expect(sweep.writtenCount).toBe(2);

    sweep.push(new Float32Array([3, 4, 5, 6, 7]));
    expect(sweep.writtenCount).toBe(4);
  });

  it("reset borra las marcas y el contador", () => {
    const sweep = new SweepBuffer(4);
    sweep.push(new Float32Array([1]), { gapBefore: true });
    sweep.reset();

    expect(sweep.isDiscontinuityAt(0)).toBe(false);
    expect(sweep.writtenCount).toBe(0);
    expect(sweep.hasSamples).toBe(false);
  });
```

Y reemplazar las llamadas a `sweepCapacitySamples` del mismo fichero: la firma pasa de `(widthPx, paperSpeedMmS, sampleRateHz)` a `(widthPx, pixelsPerSecond, sampleRateHz)`. Buscar cada `sweepCapacitySamples(800, 25, 500)` y dejarlo en `sweepCapacitySamples(800, 25 * PX_PER_MM, 500)`, importando `PX_PER_MM` de `./grid-layer`.

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run src/render/sweep-buffer.test.ts`
Expected: FAIL — `sweep.isDiscontinuityAt is not a function`.

- [ ] **Step 3: Implementar la continuidad**

`apps/web/src/render/sweep-buffer.ts` — reemplazar el fichero completo:

```ts
/** Cuántas muestras caben a lo ancho de `widthPx` a la escala horizontal dada.
 *
 * Recibe `pixelsPerSecond` (de `LayoutMetrics`) y no la velocidad de papel:
 * quien decide cuántos píxeles vale un segundo es el `LayoutEngine`, y pasarle
 * la velocidad en milímetros obligaría a esta función a rederivar la escala por
 * su cuenta, que es como se acaba teniendo dos escalas distintas en la misma
 * pantalla.
 *
 * Es el tamaño de la VENTANA VISIBLE, no el del amortiguador de jitter de red
 * (`simulation-runtime/frame-buffer.ts`): con los valores por defecto del
 * proyecto (800px, 25mm/s, 500Hz) son 4233 muestras, unos 8,5 segundos de
 * papel — dos órdenes de magnitud más que los 0,7s del buffer de red. */
export function sweepCapacitySamples(
  widthPx: number,
  pixelsPerSecond: number,
  sampleRateHz: number
): number {
  const pxPerSample = pixelsPerSecond / sampleRateHz;
  return Math.max(1, Math.round(widthPx / pxPerSample));
}

export interface SweepPushOptions {
  /** Hay un hueco real de señal justo antes de estas muestras: pérdida de
   * frame en red o descarte por overrun. */
  gapBefore?: boolean;
}

/** Anillo circular de una derivación: la ventana de señal que hay pintada en
 * pantalla. Escribe avanzando y envolviendo un `Float32Array` de tamaño fijo,
 * sin asignar memoria por llamada — el trazo viejo se sobrescribe poco a poco
 * por delante del cursor, que es exactamente el barrido de un monitor de
 * cabecera.
 *
 * Guarda dos cosas por posición: el valor y si ahí empieza una discontinuidad.
 * Mientras el dibujo era solo incremental, la continuidad era un detalle del
 * renderer; en cuanto hay que reconstruir la imagen entera desde el anillo
 * pasa a ser estado de la señal, porque sin ella el repintado uniría con línea
 * recta huecos que se dibujaron con el lápiz levantado. */
export class SweepBuffer {
  readonly capacity: number;

  private readonly samples: Float32Array;
  /** Paralelo a `samples`: 1 donde empieza una discontinuidad. No se llama
   * `gapMask` porque el mismo mecanismo servirá para cambio de sesión, pausa y
   * discontinuidades intencionadas. */
  private readonly continuityMask: Uint8Array;
  private cursor = 0;
  private written = false;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.samples = new Float32Array(this.capacity);
    this.continuityMask = new Uint8Array(this.capacity);
  }

  /** Posición del anillo donde se escribirá la próxima muestra. */
  get writeCursor(): number {
    return this.cursor;
  }

  /** `false` mientras no se haya escrito ninguna muestra desde el último
   * `reset()`. Lo necesita el dibujo incremental para no enlazar el primer
   * segmento con un cero de relleno del array. */
  get hasSamples(): boolean {
    return this.written;
  }

  /** Muestras escritas desde el último `reset()`, saturado en `capacity`. Lo
   * necesita el repintado completo para no pintar como línea plana la parte
   * del anillo que todavía no se ha escrito nunca. */
  get writtenCount(): number {
    return this.count;
  }

  push(samples: Float32Array, options: SweepPushOptions = {}): void {
    if (samples.length === 0) {
      return;
    }
    for (let i = 0; i < samples.length; i++) {
      this.samples[this.cursor] = samples[i];
      // Solo la primera muestra del trozo hereda la marca; el resto la limpia.
      // Limpiar es imprescindible: el anillo se reescribe cada vuelta, y una
      // marca vieja sin borrar reaparecería como un corte fantasma.
      this.continuityMask[this.cursor] = i === 0 && options.gapBefore ? 1 : 0;
      this.cursor = this.cursor + 1 === this.capacity ? 0 : this.cursor + 1;
    }
    this.written = true;
    this.count = Math.min(this.capacity, this.count + samples.length);
  }

  /** Lee una posición del anillo. Acepta índices fuera de rango (incluidos
   * negativos) y los envuelve por módulo. */
  at(index: number): number {
    return this.samples[this.wrap(index)];
  }

  /** `true` si en esa posición empieza una discontinuidad y por tanto no debe
   * unirse con la muestra anterior. */
  isDiscontinuityAt(index: number): boolean {
    return this.continuityMask[this.wrap(index)] === 1;
  }

  /** Vacía el anillo. Al cambiar de ritmo o reiniciarse la sesión arranca un
   * eje de tiempo nuevo: mezclarlo con el trazo anterior dejaría dos ritmos
   * distintos en pantalla a la vez. */
  reset(): void {
    this.samples.fill(0);
    this.continuityMask.fill(0);
    this.cursor = 0;
    this.written = false;
    this.count = 0;
  }

  private wrap(index: number): number {
    return ((index % this.capacity) + this.capacity) % this.capacity;
  }
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run src/render/sweep-buffer.test.ts`
Expected: 17 tests PASS (12 previos + 5 nuevos).

- [ ] **Step 5: Ajustar los llamantes de sweepCapacitySamples**

`apps/web/src/ui/ECGWorkspace.tsx:57` — la llamada actual pasa la velocidad de papel:

```ts
    const capacity = sweepCapacitySamples(CANVAS_WIDTH_PX, PAPER_SPEED_MM_S, sampleRateHz);
```

Sustituir por la escala en píxeles por segundo, importando `PX_PER_MM` de `../render/grid-layer` (ya se importa `drawGrid` de ese módulo, añadir el nombre a esa importación):

```ts
    const capacity = sweepCapacitySamples(
      CANVAS_WIDTH_PX,
      PAPER_SPEED_MM_S * PX_PER_MM,
      sampleRateHz
    );
```

Y hacer lo mismo en `apps/web/src/render/lead-canvas.test.ts`, que llama a `sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ)` en varios tests: pasar `25 * PX_PER_MM` (el fichero ya importa `PX_PER_MM`).

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 134 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/render/sweep-buffer.ts apps/web/src/render/sweep-buffer.test.ts apps/web/src/render/lead-canvas.test.ts apps/web/src/ui/ECGWorkspace.tsx
git commit -m "feat(web): la continuidad de la senal pasa a ser estado del buffer

SweepBuffer guarda una continuityMask paralela a las muestras y expone
writtenCount. Sin esto, el repintado completo que necesita el redimensionado
uniria con linea recta los huecos que se dibujaron con el lapiz levantado,
deshaciendo el arreglo I-3 al primer resize.

sweepCapacitySamples pasa a recibir pixelsPerSecond en vez de la velocidad de
papel: la escala la decide el LayoutEngine y rederivarla aqui es como se
acaba con dos escalas distintas en la misma pantalla."
```

---

### Task 5: grid-layer tematizado

Saca de la rejilla los dos colores escritos a mano y la escala fija, y pásale las métricas.

**Files:**
- Modify: `apps/web/src/render/grid-layer.ts`
- Test: `apps/web/src/render/grid-layer.test.ts`

**Interfaces:**
- Consumes: `LayoutMetrics` de Task 3, `EcgTheme` de Task 2.
- Produces: `timeToPx(tS, metrics)`, `voltageToPx(vVolts, metrics)`, `computeGridLines(widthPx, heightPx, metrics)`, `drawGrid(ctx, widthPx, heightPx, metrics, theme)`. `PX_PER_MM` sigue exportándose.

- [ ] **Step 1: Reescribir el test**

`apps/web/src/render/grid-layer.test.ts` — reemplazar el fichero completo:

```ts
import { describe, expect, it, vi } from "vitest";
import { PX_PER_MM, computeGridLines, drawGrid, timeToPx, voltageToPx } from "./grid-layer";
import { computeLayoutMetrics } from "./layout-engine";
import { getTheme } from "@ui-system/themes/index";

const GAIN = 10;
const SPEED = 25;
// 152px de tira dan viewportScale = 3,8 px/mm, que es PX_PER_MM: es el caso de
// referencia con el que los tests de abajo pueden seguir hablando en mm.
const METRICS = computeLayoutMetrics(152, 1, GAIN, SPEED);
const THEME = getTheme("dark").ecg;

describe("timeToPx / voltageToPx", () => {
  it("a 25mm/s, 1mm equivale a 40ms (seccion 9 del spec)", () => {
    expect(timeToPx(0.04, METRICS)).toBeCloseTo(PX_PER_MM, 5);
  });

  it("voltageToPx convierte voltios a pixeles con la calibracion 10mm/mV", () => {
    // 1mV con ganancia 10mm/mV -> 10mm
    expect(voltageToPx(0.001, METRICS)).toBeCloseTo(10 * METRICS.viewportScalePxPerMm, 5);
  });

  it("voltageToPx escala con el viewport, no con la fisiologia", () => {
    const comprimida = computeLayoutMetrics(46, 1, GAIN, SPEED);
    expect(voltageToPx(0.001, comprimida)).toBeLessThan(voltageToPx(0.001, METRICS));
  });
});

describe("computeGridLines", () => {
  it("coloca una linea mayor cada 5 menores", () => {
    const widthPx = METRICS.viewportScalePxPerMm * 10;
    const lines = computeGridLines(widthPx, widthPx, METRICS);

    expect(lines.verticalMinor.length).toBeGreaterThan(lines.verticalMajor.length);
    expect(lines.verticalMajor[0]).toBeCloseTo(0);
    expect(lines.verticalMajor[1]).toBeCloseTo(5 * METRICS.viewportScalePxPerMm, 5);
  });

  it("el espaciado sigue al viewportScale: comprimir junta las lineas", () => {
    const comprimida = computeLayoutMetrics(46, 1, GAIN, SPEED);
    const anchas = computeGridLines(200, 200, METRICS);
    const juntas = computeGridLines(200, 200, comprimida);
    expect(juntas.verticalMinor.length).toBeGreaterThan(anchas.verticalMinor.length);
  });
});

describe("drawGrid", () => {
  it("dibuja tantos segmentos como lineas devuelve computeGridLines", () => {
    const widthPx = METRICS.viewportScalePxPerMm * 10;
    const heightPx = widthPx;
    const lines = computeGridLines(widthPx, heightPx, METRICS);
    const expectedSegments =
      lines.verticalMinor.length + lines.horizontalMinor.length +
      lines.verticalMajor.length + lines.horizontalMajor.length;

    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, widthPx, heightPx, METRICS, THEME);

    expect(ctx.moveTo).toHaveBeenCalledTimes(expectedSegments);
    expect(ctx.lineTo).toHaveBeenCalledTimes(expectedSegments);
  });

  it("pinta el fondo del tema en vez de dejarlo transparente", () => {
    // El canvas de rejilla es el que da color al area de ECG: si no pinta
    // fondo, el trazo queda sobre el color del contenedor y el tema de papel
    // se ve gris.
    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, 100, 50, METRICS, THEME);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd apps/web && npx vitest run src/render/grid-layer.test.ts`
Expected: FAIL — `Expected 5 arguments, but got 3` en `drawGrid`, o `ctx.fillRect` no llamado.

- [ ] **Step 3: Reescribir grid-layer**

`apps/web/src/render/grid-layer.ts` — reemplazar el fichero completo:

```ts
import type { EcgTheme } from "@ui-system/themes/types";
// Solo el tipo: `layout-engine.ts` importa `PX_PER_MM` de aquí, así que un
// import de valor cerraría un ciclo en tiempo de ejecución. `import type` se
// borra al compilar y no crea dependencia real.
import type { LayoutMetrics } from "./layout-engine";

/** Píxeles por milímetro que asume el navegador para la unidad `px` (96 dpi).
 *
 * Ya no lo consume el dibujo: es el `viewportScale` por defecto, la referencia
 * de la que parte `computeLayoutMetrics`. Que 96 dpi sea ficción en casi
 * cualquier monitor actual es cierto y asumido; los simuladores comerciales
 * tampoco logran escala física exacta, mantienen proporciones y ofrecen
 * calibración a quien la necesite. */
export const PX_PER_MM = 96 / 25.4;

export function timeToPx(tS: number, metrics: LayoutMetrics): number {
  return tS * metrics.pixelsPerSecond;
}

export function voltageToPx(vVolts: number, metrics: LayoutMetrics): number {
  return vVolts * 1000 * metrics.pixelsPerMillivolt;
}

export interface GridLines {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
}

const MINOR_SPACING_MM = 1;
const MAJOR_EVERY_N_MINOR = 5;

export function computeGridLines(
  widthPx: number,
  heightPx: number,
  metrics: LayoutMetrics
): GridLines {
  const spacingPx = MINOR_SPACING_MM * metrics.viewportScalePxPerMm;

  const verticalMinor: number[] = [];
  const verticalMajor: number[] = [];
  for (let i = 0; i * spacingPx <= widthPx; i++) {
    const x = i * spacingPx;
    verticalMinor.push(x);
    if (i % MAJOR_EVERY_N_MINOR === 0) verticalMajor.push(x);
  }

  const horizontalMinor: number[] = [];
  const horizontalMajor: number[] = [];
  for (let i = 0; i * spacingPx <= heightPx; i++) {
    const y = i * spacingPx;
    horizontalMinor.push(y);
    if (i % MAJOR_EVERY_N_MINOR === 0) horizontalMajor.push(y);
  }

  return { verticalMinor, verticalMajor, horizontalMinor, horizontalMajor };
}

/** Dibuja fondo y rejilla de UNA tira, con sus dimensiones reales.
 *
 * Antes había un único canvas de rejilla de 800x600 posicionado en absoluto que
 * no se alineaba con las tiras de debajo. Por tira, además de cuadrar, hace
 * cada derivación autónoma: se puede ampliar, congelar o resaltar una sin
 * tocar el resto. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  metrics: LayoutMetrics,
  theme: EcgTheme
): void {
  const lines = computeGridLines(widthPx, heightPx, metrics);

  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.strokeStyle = theme.gridMinor;
  ctx.lineWidth = 0.5;
  for (const x of lines.verticalMinor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMinor) drawLine(ctx, 0, y, widthPx, y);

  ctx.strokeStyle = theme.gridMajor;
  ctx.lineWidth = 1;
  for (const x of lines.verticalMajor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMajor) drawLine(ctx, 0, y, widthPx, y);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run src/render/grid-layer.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Ajustar el llamante de drawGrid**

`apps/web/src/ui/ECGWorkspace.tsx` — la llamada de la línea 138 pasa a necesitar métricas y tema. Como el layout definitivo llega en la Task 12, aquí basta un puente temporal que mantenga la app compilando y los tests en verde. Reemplazar el efecto del grid:

```ts
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    // Puente temporal: la Task 12 sustituye este canvas suelto por un canvas
    // de rejilla dentro de cada LeadStrip, con las metricas del LayoutEngine.
    const metrics = computeLayoutMetrics(
      canvas.height,
      1,
      GAIN_MM_PER_MV,
      PAPER_SPEED_MM_S
    );
    drawGrid(ctx, canvas.width, canvas.height, metrics, getTheme().ecg);
  }, [layout]);
```

Añadir a las importaciones del fichero:

```ts
import { computeLayoutMetrics } from "../render/layout-engine";
import { getTheme } from "@ui-system/themes/index";
```

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 136 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/render/grid-layer.ts apps/web/src/render/grid-layer.test.ts apps/web/src/ui/ECGWorkspace.tsx
git commit -m "feat(web): la rejilla toma color y escala del tema y de las metricas

drawGrid recibe LayoutMetrics y EcgTheme; el espaciado sale de
viewportScalePxPerMm en vez de PX_PER_MM, y los dos rojos que estaban
escritos a mano salen del tema. La rejilla pinta ademas el fondo del tema:
es el canvas que da color al area de ECG.

PX_PER_MM sobrevive degradado a referencia del viewportScale por defecto."
```

---

### Task 6: lead-canvas tematizado y tema centinela

Saca el último color escrito a mano del renderer, corrige las unidades de la banda de borrado y añade el guardarraíl que hace imposible que vuelva a colarse un literal.

**Files:**
- Modify: `apps/web/src/render/lead-canvas.ts`
- Test: `apps/web/src/render/lead-canvas.test.ts`
- Test: `apps/web/src/render/theme-contract.test.ts` (nuevo)

**Interfaces:**
- Consumes: `LayoutMetrics` de Task 3, `EcgTheme` de Task 2, `SweepBuffer` de Task 4.
- Produces: `LeadCanvasOptions { metrics: LayoutMetrics; theme: EcgTheme }`, `drawSweepSegment(ctx, sweep, newSamples, sampleRateHz, options, heightPx, hadGap?)` con la firma de `options` cambiada, `ERASE_BAND_MM = 2`, `eraseBandAhead` exportada para que la reutilice el `SweepRebuilder`.

- [ ] **Step 1: Escribir el test de tema centinela**

`apps/web/src/render/theme-contract.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { EcgTheme } from "@ui-system/themes/types";
import { drawGrid } from "./grid-layer";
import { drawSweepSegment } from "./lead-canvas";
import { computeLayoutMetrics } from "./layout-engine";
import { SweepBuffer, sweepCapacitySamples } from "./sweep-buffer";

/** Colores que no aparecen en ningun tema real ni en ningun sitio del codigo.
 * Si el renderer asigna algo que no este aqui, es que lo lleva escrito a
 * mano. */
const SENTINEL: EcgTheme = {
  background: "#FF00FF",
  gridMinor: "#00FFFF",
  gridMajor: "#FFFF00",
  trace: "#FF7F00",
  calibration: "#7F00FF",
  cursor: "#00FF7F",
};

const SENTINEL_VALUES = new Set(Object.values(SENTINEL));

/** Contexto que registra cada asignacion de color. `strokeStyle` y `fillStyle`
 * son propiedades, no metodos, asi que hay que interceptarlas con setters: un
 * `vi.fn()` no las ve. */
function makeRecordingCtx() {
  const assigned: string[] = [];
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    font: "",
    set strokeStyle(value: string) {
      assigned.push(value);
    },
    get strokeStyle() {
      return "";
    },
    set fillStyle(value: string) {
      assigned.push(value);
    },
    get fillStyle() {
      return "";
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, assigned };
}

const METRICS = computeLayoutMetrics(152, 1, 10, 25);

describe("contrato de tema del renderer", () => {
  it("drawGrid no asigna ningun color que no venga del tema", () => {
    const { ctx, assigned } = makeRecordingCtx();

    drawGrid(ctx, 200, 152, METRICS, SENTINEL);

    expect(assigned.length).toBeGreaterThan(0);
    for (const color of assigned) {
      expect(SENTINEL_VALUES, `color no tematizado: ${color}`).toContain(color);
    }
  });

  it("drawSweepSegment no asigna ningun color que no venga del tema", () => {
    // Es el test que le faltaba a los presets de ruido: aquel bug paso porque
    // ningun test afirmaba nada sobre los valores, solo sobre el round-trip.
    const { ctx, assigned } = makeRecordingCtx();
    const sweep = new SweepBuffer(
      sweepCapacitySamples(200, METRICS.pixelsPerSecond, 500)
    );

    drawSweepSegment(
      ctx,
      sweep,
      new Float32Array([0, 0.001, -0.0005]),
      500,
      { metrics: METRICS, theme: SENTINEL },
      152
    );

    expect(assigned.length).toBeGreaterThan(0);
    for (const color of assigned) {
      expect(SENTINEL_VALUES, `color no tematizado: ${color}`).toContain(color);
    }
  });
});
```

- [ ] **Step 2: Adaptar el test existente de lead-canvas**

`apps/web/src/render/lead-canvas.test.ts` — cambiar la cabecera del fichero (líneas 1 a 27) por:

```ts
import { describe, expect, it, vi } from "vitest";
import { ERASE_BAND_MM, OverlayLayer, drawSweepSegment } from "./lead-canvas";
import { PX_PER_MM } from "./grid-layer";
import { computeLayoutMetrics } from "./layout-engine";
import { SweepBuffer, sweepCapacitySamples } from "./sweep-buffer";
import { getTheme } from "@ui-system/themes/index";

function makeCtx() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    canvas: { width: 800 },
  } as unknown as CanvasRenderingContext2D;
}

const SAMPLE_RATE_HZ = 500;
const HEIGHT_PX = 152;
// 152px de tira con ganancia 10mm/mV y margen de 2mV dan viewportScale = 3,8
// px/mm, practicamente PX_PER_MM: asi los tests siguen pudiendo razonar en mm.
const METRICS = computeLayoutMetrics(HEIGHT_PX, 1, 10, 25);
const OPTIONS = { metrics: METRICS, theme: getTheme("dark").ecg };
const PX_PER_SAMPLE = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
const ERASE_BAND_PX = ERASE_BAND_MM * METRICS.viewportScalePxPerMm;
const CAPACITY = sweepCapacitySamples(800, METRICS.pixelsPerSecond, SAMPLE_RATE_HZ);

function xsOf(fn: unknown): number[] {
  return (fn as any).mock.calls.map((call: number[]) => call[0]);
}
```

Después, en el resto del fichero:

- Sustituir cada `sweepCapacitySamples(800, 25, SAMPLE_RATE_HZ)` por `CAPACITY`.
- Sustituir cada `voltageToPx(x, 10)` por `voltageToPx(x, METRICS)` y añadir `voltageToPx` a la importación de `./grid-layer`.
- En los dos tests con capacidad pequeña (`sampleRateHz = 10` y `sampleRateHz = 100`), sustituir el cálculo local `const pxPerSample = (PX_PER_MM * OPTIONS.paperSpeedMmS) / sampleRateHz;` por `const pxPerSample = METRICS.pixelsPerSecond / sampleRateHz;`.
- `HEIGHT_PX` pasa de 100 a 152, así que la aserción `expect(height).toBe(HEIGHT_PX)` sigue valiendo sin tocarla, y `overlay.draw(ctx, 800, 100)` pasa a `overlay.draw(ctx, 800, HEIGHT_PX)`.

Añadir además este test nuevo al final del `describe("drawSweepSegment")`:

```ts
  it("la banda de borrado se expresa en milimetros de papel, no en pixeles fijos", () => {
    // Su propio comentario ya decia "a 25mm/s son unos 2mm de papel": estaba
    // en las unidades equivocadas. Con escala variable, un hueco fijo en
    // pixeles se ve enorme comprimido y ridiculo en 4K.
    const comprimida = computeLayoutMetrics(46, 12, 10, 25);
    const ctx = makeCtx();
    const sweep = new SweepBuffer(CAPACITY);

    drawSweepSegment(
      ctx,
      sweep,
      new Float32Array(50),
      SAMPLE_RATE_HZ,
      { metrics: comprimida, theme: getTheme("dark").ecg },
      46
    );

    const [, , width] = (ctx.clearRect as any).mock.calls[0];
    expect(width).toBeCloseTo(
      50 * (comprimida.pixelsPerSecond / SAMPLE_RATE_HZ) +
        ERASE_BAND_MM * comprimida.viewportScalePxPerMm
    );
  });
```

- [ ] **Step 3: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run src/render/lead-canvas.test.ts src/render/theme-contract.test.ts`
Expected: FAIL — `ERASE_BAND_MM` no exportado y `#000000` no está en el tema centinela.

- [ ] **Step 4: Reescribir lead-canvas**

`apps/web/src/render/lead-canvas.ts` — reemplazar el fichero completo:

```ts
import type { EcgTheme } from "@ui-system/themes/types";
import { voltageToPx } from "./grid-layer";
import type { LayoutMetrics } from "./layout-engine";
import type { SweepBuffer } from "./sweep-buffer";

/** Todo lo que el dibujo de una tira necesita saber. Las escalas llegan ya
 * resueltas en `metrics` y el color en `theme`: el renderer no deriva escalas
 * por su cuenta ni consulta el DOM, así que sigue siendo puro. */
export interface LeadCanvasOptions {
  metrics: LayoutMetrics;
  theme: EcgTheme;
}

/** Ancho del hueco que se borra por delante del cursor de escritura, en
 * milímetros de papel. Es lo que separa visualmente el trazo nuevo del de la
 * vuelta anterior — el efecto de barrido de un monitor de cabecera.
 *
 * En milímetros y no en píxeles: con escala variable, un hueco fijo en píxeles
 * se ve enorme en una vista comprimida y ridículo en 4K. */
export const ERASE_BAND_MM = 2;

/** Escribe las muestras nuevas de este tick en el anillo de la derivación y
 * dibuja SOLO ese segmento, en la posición de píxel que le marca el cursor.
 *
 * El canvas nunca se borra entero: el trazo de la vuelta anterior sigue
 * pintado hasta que el cursor pasa por encima. Por eso escribir en el anillo
 * y dibujar ocurren aquí juntos — si el llamante empujase por su cuenta, el
 * cursor y la banda de borrado podrían desincronizarse con lo que se pinta. */
export function drawSweepSegment(
  ctx: CanvasRenderingContext2D,
  sweep: SweepBuffer,
  newSamples: Float32Array,
  sampleRateHz: number,
  options: LeadCanvasOptions,
  heightPx: number,
  hadGap = false
): void {
  if (newSamples.length === 0) {
    return;
  }

  const pxPerSample = options.metrics.pixelsPerSecond / sampleRateHz;
  const capacity = sweep.capacity;
  const sweepWidthPx = capacity * pxPerSample;
  const baselineY = heightPx / 2;

  const startIndex = sweep.writeCursor;
  // El enlace con el segmento del tick anterior solo existe si ya hay trazo
  // escrito, no acabamos de envolver (unir la posición 0 con la capacity-1
  // dibujaría una línea atravesando todo el canvas de derecha a izquierda) y
  // no hay un hueco real por delante: pérdida de frame en red o descarte por
  // overrun. Un hueco no se interpola nunca (spec §4) -- se levanta el lápiz
  // y el trazo nuevo empieza con su propio moveTo, igual que al envolver.
  const linksToPrevious = !hadGap && sweep.hasSamples && startIndex > 0;
  const previousY = linksToPrevious
    ? baselineY - voltageToPx(sweep.at(startIndex - 1), options.metrics)
    : 0;

  sweep.push(newSamples, { gapBefore: hadGap });
  // La banda borrada debe cubrir COMO MÍNIMO el tramo que se va a dibujar
  // ahora mismo (startIndex..writeCursor), no solo un hueco fijo por
  // delante del cursor nuevo: con trozos reales de 100ms (50 muestras) el
  // cursor avanza más que la banda, y una banda más estrecha que el avance
  // deja sin limpiar la cola de cada trozo — el trazo de la vuelta anterior
  // se queda ahí, mezclado con el nuevo, en cuanto se completa una vuelta.
  const eraseWidthPx =
    newSamples.length * pxPerSample + ERASE_BAND_MM * options.metrics.viewportScalePxPerMm;
  eraseBandAhead(ctx, startIndex * pxPerSample, eraseWidthPx, sweepWidthPx, heightPx);

  ctx.strokeStyle = options.theme.trace;
  ctx.lineWidth = 1;
  ctx.beginPath();

  let penDown = false;
  if (linksToPrevious) {
    ctx.moveTo((startIndex - 1) * pxPerSample, previousY);
    penDown = true;
  }
  for (let i = 0; i < newSamples.length; i++) {
    const ringIndex = (startIndex + i) % capacity;
    const x = ringIndex * pxPerSample;
    const y = baselineY - voltageToPx(newSamples[i], options.metrics);
    if (penDown && ringIndex !== 0) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      penDown = true;
    }
  }

  ctx.stroke();
}

/** Limpia una banda de `bandWidthPx` a partir de `cursorX`, envolviendo al
 * borde derecho si no cabe entera.
 *
 * Exportada para que el repintado completo (`sweep-rebuilder.ts`) reproduzca
 * el mismo hueco de barrido sin duplicar la aritmética de envolvimiento. */
export function eraseBandAhead(
  ctx: CanvasRenderingContext2D,
  cursorX: number,
  bandWidthPx: number,
  sweepWidthPx: number,
  heightPx: number
): void {
  const bandPx = Math.min(bandWidthPx, sweepWidthPx);
  const overflowPx = cursorX + bandPx - sweepWidthPx;
  if (overflowPx > 0) {
    ctx.clearRect(cursorX, 0, bandPx - overflowPx, heightPx);
    ctx.clearRect(0, 0, overflowPx, heightPx);
  } else {
    ctx.clearRect(cursorX, 0, bandPx, heightPx);
  }
}

/** Capa superior para medidas e interacción (cursores, calipers). Sin
 * funcionalidad en esta fase — el hueco existe en la arquitectura para no
 * tener que replanificar el layout cuando se implemente. */
export class OverlayLayer {
  draw(_ctx: CanvasRenderingContext2D, _widthPx: number, _heightPx: number): void {
    // Reservado.
  }
}
```

- [ ] **Step 5: Ajustar el llamante y verificar**

`apps/web/src/ui/ECGWorkspace.tsx` — la llamada a `drawSweepSegment` pasa el objeto de opciones nuevo. Sustituir el bloque de opciones:

```ts
            { metrics: computeLayoutMetrics(canvas.height, 1, GAIN_MM_PER_MV, PAPER_SPEED_MM_S), theme: getTheme().ecg },
```

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 141 tests PASS (136 previos + 1 de banda en mm + 2 de tema centinela, y los 12 de lead-canvas adaptados siguen contando igual).

- [ ] **Step 6: Verificar a mano que no queda ningún literal de color en render/**

Run: `cd apps/web && grep -rnE "#[0-9A-Fa-f]{3,8}|rgba?\(" src/render/ --include=*.ts | grep -v "\.test\.ts"`
Expected: sin resultados. Si aparece alguno, el test de tema centinela debería haberlo cazado — investigar por qué no.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/render/lead-canvas.ts apps/web/src/render/lead-canvas.test.ts apps/web/src/render/theme-contract.test.ts apps/web/src/ui/ECGWorkspace.tsx
git commit -m "feat(web): el trazo toma color del tema y la banda de borrado va en mm

Sale el ultimo literal de color del renderer (#000000 -> theme.ecg.trace) y
LeadCanvasOptions pasa a llevar { metrics, theme }: paperSpeedMmS y
gainMmPerMv desaparecen de aqui porque son entradas del LayoutEngine, no del
dibujo, y asi el renderer no puede derivarse su propia escala.

ERASE_BAND_PX pasa a ERASE_BAND_MM: su propio comentario ya decia que eran
2mm de papel, y con escala variable un hueco fijo en pixeles se ve enorme
comprimido y ridiculo en 4K.

Anade el test de tema centinela: se dibuja con colores absurdos y se afirma
que todo strokeStyle/fillStyle sale del objeto Theme. Es el guardarrail que
le faltaba a los presets de ruido."
```

---

### Task 7: SweepRebuilder

Asignar `canvas.width` o `canvas.height` borra el contenido del canvas, así que al redimensionar el ECG quedaría en blanco hasta que el barrido diera la vuelta entera, unos ocho segundos. Hace falta reconstruir la imagen desde el anillo — y hacerlo respetando la `continuityMask`, o el repintado reintroduce la interpolación que arregló I-3.

**Files:**
- Create: `apps/web/src/render/sweep-rebuilder.ts`
- Test: `apps/web/src/render/sweep-rebuilder.test.ts`

**Interfaces:**
- Consumes: `SweepBuffer` de Task 4, `LeadCanvasOptions` y `eraseBandAhead` de Task 6, `voltageToPx` de Task 5.
- Produces: `class SweepRebuilder` con `rebuild(ctx, sweep, sampleRateHz, options, heightPx): void`.

- [ ] **Step 1: Escribir los tests que fallan**

`apps/web/src/render/sweep-rebuilder.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { computeLayoutMetrics } from "./layout-engine";
import { drawSweepSegment } from "./lead-canvas";
import { SweepBuffer } from "./sweep-buffer";
import { SweepRebuilder } from "./sweep-rebuilder";
import { getTheme } from "@ui-system/themes/index";

const SAMPLE_RATE_HZ = 500;
const HEIGHT_PX = 152;
const METRICS = computeLayoutMetrics(HEIGHT_PX, 1, 10, 25);
const OPTIONS = { metrics: METRICS, theme: getTheme("dark").ecg };

function makeCtx() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

/** Conexiones dibujadas, como pares "x1->x2". Es la propiedad que de verdad
 * importa: dos secuencias de llamadas distintas que produzcan las mismas
 * uniones dan el mismo resultado visual. Un `moveTo` corta la cadena; un
 * `lineTo` une el punto anterior con el nuevo. */
function connections(ctx: CanvasRenderingContext2D): Set<string> {
  const calls: Array<{ kind: "move" | "line"; x: number }> = [];
  for (const [x] of (ctx.moveTo as any).mock.calls) calls.push({ kind: "move", x });
  // Reconstruir el orden real exige intercalar por orden de invocacion, que
  // vitest expone con `mock.invocationCallOrder`.
  const ordered: Array<{ kind: "move" | "line"; x: number }> = [];
  const moves = (ctx.moveTo as any).mock;
  const lines = (ctx.lineTo as any).mock;
  const events = [
    ...moves.calls.map((c: number[], i: number) => ({
      order: moves.invocationCallOrder[i],
      kind: "move" as const,
      x: c[0],
    })),
    ...lines.calls.map((c: number[], i: number) => ({
      order: lines.invocationCallOrder[i],
      kind: "line" as const,
      x: c[0],
    })),
  ].sort((a, b) => a.order - b.order);
  ordered.push(...events.map(({ kind, x }) => ({ kind, x })));
  void calls;

  const out = new Set<string>();
  let previous: number | null = null;
  for (const event of ordered) {
    if (event.kind === "line" && previous !== null) {
      out.add(`${previous.toFixed(4)}->${event.x.toFixed(4)}`);
    }
    previous = event.x;
  }
  return out;
}

describe("SweepRebuilder", () => {
  it("reproduce las mismas uniones que el dibujo incremental antes de envolver", () => {
    // Se compara sobre un anillo que aun no ha dado la vuelta: ahi no hay
    // ambiguedad entre lo mas viejo y lo mas nuevo, y la equivalencia debe ser
    // exacta. Ata las dos rutas de dibujo para siempre.
    const capacity = 600;
    const incremental = new SweepBuffer(capacity);
    const ctxIncremental = makeCtx();
    for (let tick = 0; tick < 4; tick++) {
      const samples = new Float32Array(50);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin((tick * 50 + i) / 10) * 0.001;
      }
      drawSweepSegment(
        ctxIncremental, incremental, samples, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX
      );
    }

    const rebuilt = new SweepBuffer(capacity);
    for (let tick = 0; tick < 4; tick++) {
      const samples = new Float32Array(50);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin((tick * 50 + i) / 10) * 0.001;
      }
      rebuilt.push(samples);
    }
    const ctxRebuilt = makeCtx();
    new SweepRebuilder().rebuild(ctxRebuilt, rebuilt, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(connections(ctxRebuilt)).toEqual(connections(ctxIncremental));
  });

  it("no une a traves de una discontinuidad: levanta el lapiz", () => {
    // Es la red que impide que un resize deshaga el arreglo I-3.
    const sweep = new SweepBuffer(600);
    sweep.push(new Float32Array(50));
    sweep.push(new Float32Array(50), { gapBefore: true });

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const pxPerSample = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
    const gapX = 50 * pxPerSample;
    // La union 49->50 no debe existir: ahi empieza el hueco.
    const forbidden = `${(49 * pxPerSample).toFixed(4)}->${gapX.toFixed(4)}`;
    expect(connections(ctx)).not.toContain(forbidden);
    // Y en esa x hay un moveTo, no un lineTo.
    expect((ctx.moveTo as any).mock.calls.map((c: number[]) => c[0])).toContainEqual(gapX);
  });

  it("no pinta la parte del anillo que nunca se ha escrito", () => {
    // Sin writtenCount, los ceros de relleno del Float32Array se dibujarian
    // como una linea plana en la mitad derecha de la tira.
    const sweep = new SweepBuffer(600);
    sweep.push(new Float32Array(50));

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const pxPerSample = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
    const drawnXs = [
      ...(ctx.moveTo as any).mock.calls.map((c: number[]) => c[0]),
      ...(ctx.lineTo as any).mock.calls.map((c: number[]) => c[0]),
    ];
    expect(Math.max(...drawnXs)).toBeLessThan(50 * pxPerSample);
  });

  it("un anillo vacio no dibuja nada, pero si limpia el canvas", () => {
    const sweep = new SweepBuffer(600);
    const ctx = makeCtx();

    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it("con el anillo lleno levanta el lapiz en la frontera del cursor", () => {
    // Cuando ha dado la vuelta, la posicion del cursor guarda lo MAS VIEJO y
    // la anterior lo MAS NUEVO: unirlas seria un salto de una pantalla entera
    // hacia atras en el tiempo.
    const capacity = 100;
    const sweep = new SweepBuffer(capacity);
    sweep.push(new Float32Array(150)); // da mas de una vuelta
    expect(sweep.writtenCount).toBe(capacity);
    expect(sweep.writeCursor).toBe(50);

    const ctx = makeCtx();
    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    const pxPerSample = METRICS.pixelsPerSecond / SAMPLE_RATE_HZ;
    expect((ctx.moveTo as any).mock.calls.map((c: number[]) => c[0])).toContainEqual(
      50 * pxPerSample
    );
  });

  it("usa el color de trazo del tema", () => {
    const sweep = new SweepBuffer(600);
    sweep.push(new Float32Array(50));
    const ctx = makeCtx();

    new SweepRebuilder().rebuild(ctx, sweep, SAMPLE_RATE_HZ, OPTIONS, HEIGHT_PX);

    expect(ctx.strokeStyle).toBe(OPTIONS.theme.trace);
  });
});
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run src/render/sweep-rebuilder.test.ts`
Expected: FAIL — `Failed to resolve import "./sweep-rebuilder"`.

- [ ] **Step 3: Escribir el SweepRebuilder**

`apps/web/src/render/sweep-rebuilder.ts`:

```ts
import { voltageToPx } from "./grid-layer";
import { ERASE_BAND_MM, eraseBandAhead, type LeadCanvasOptions } from "./lead-canvas";
import type { SweepBuffer } from "./sweep-buffer";

/** Repinta el anillo completo sobre un canvas recién invalidado.
 *
 * Es un subsistema y no una función suelta porque el mismo algoritmo va a
 * hacer falta para bastantes cosas: cambio de tema, de layout, de zoom, de
 * velocidad de papel, de ganancia, exportar a PNG o PDF, replay y congelado.
 *
 * **Eventos que fuerzan repintado completo:** redimensionado, cambio de tema,
 * cambio de layout y cambio de `viewportScale`. Un cambio de tema no se arregla
 * reasignando `strokeStyle`: hay que reconstruir rejilla, trazo, cursor y
 * calibración.
 *
 * **Nunca entra en el camino caliente.** Jamás dentro de
 * `requestAnimationFrame`. */
export class SweepRebuilder {
  rebuild(
    ctx: CanvasRenderingContext2D,
    sweep: SweepBuffer,
    sampleRateHz: number,
    options: LeadCanvasOptions,
    heightPx: number
  ): void {
    const pxPerSample = options.metrics.pixelsPerSecond / sampleRateHz;
    const capacity = sweep.capacity;
    const sweepWidthPx = capacity * pxPerSample;
    const baselineY = heightPx / 2;

    ctx.clearRect(0, 0, sweepWidthPx, heightPx);
    if (!sweep.hasSamples) {
      return;
    }

    const isFull = sweep.writtenCount >= capacity;
    const cursor = sweep.writeCursor;

    ctx.strokeStyle = options.theme.trace;
    ctx.lineWidth = 1;
    ctx.beginPath();

    let penDown = false;
    for (let ringIndex = 0; ringIndex < capacity; ringIndex++) {
      // Antes de dar la vuelta, solo [0, cursor) tiene señal escrita: el resto
      // son los ceros de relleno del Float32Array, y pintarlos sería una línea
      // plana en la parte de la tira que nunca se ha usado.
      if (!isFull && ringIndex >= cursor) {
        break;
      }

      const x = ringIndex * pxPerSample;
      const y = baselineY - voltageToPx(sweep.at(ringIndex), options.metrics);

      // Se levanta el lápiz en tres sitios, y ninguno es negociable:
      //   - x = 0, el borde izquierdo, igual que en el dibujo incremental;
      //   - una discontinuidad marcada en el anillo (pérdida de frame o
      //     descarte por overrun), que no se interpola jamás;
      //   - la frontera del cursor con el anillo lleno, donde lo anterior es
      //     lo más nuevo y esta posición lo más viejo.
      const lift =
        ringIndex === 0 ||
        sweep.isDiscontinuityAt(ringIndex) ||
        (isFull && ringIndex === cursor);

      if (penDown && !lift) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        penDown = true;
      }
    }

    ctx.stroke();

    // El hueco de barrido por delante del cursor forma parte de la imagen: sin
    // reproducirlo, tras un redimensionado el trazo aparecería cerrado en
    // círculo y se perdería la referencia de dónde está escribiendo.
    eraseBandAhead(
      ctx,
      cursor * pxPerSample,
      ERASE_BAND_MM * options.metrics.viewportScalePxPerMm,
      sweepWidthPx,
      heightPx
    );
  }
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run src/render/sweep-rebuilder.test.ts`
Expected: 6 tests PASS.

Si el primer test falla por diferencia en las uniones, la causa casi segura es que `drawSweepSegment` enlaza con la muestra anterior mediante un `moveTo` en `startIndex - 1` mientras el repintado llega a esa posición dibujando: comparar los dos conjuntos con `console.log` y corregir la condición de levantar el lápiz, no el test.

- [ ] **Step 5: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 147 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/render/sweep-rebuilder.ts apps/web/src/render/sweep-rebuilder.test.ts
git commit -m "feat(web): SweepRebuilder para repintar el anillo completo

Asignar canvas.width/height borra el contenido, asi que sin esto el ECG
quedaria en blanco unos 8 segundos tras cada redimensionado. Es un subsistema
y no una funcion suelta porque el mismo algoritmo hara falta para cambio de
tema, layout, zoom, exportar y replay.

Levanta el lapiz en el borde izquierdo, en cada discontinuidad marcada en la
continuityMask, y en la frontera del cursor cuando el anillo esta lleno. Un
property test comprueba que produce las mismas uniones que el dibujo
incremental: sin el, el repintado podria reintroducir la interpolacion que
arreglo I-3."
```

---

### Task 8: Foundation — Icon y Tooltip

La capa de la que dependerá todo lo demás. `Icon` es un envoltorio, no un sistema de iconos: sin él, los SVG acaban repartidos por media aplicación. `Tooltip` se construye ya aunque hoy solo lo use el indicador de compresión, porque en cuanto lleguen las medidas del inspector y las alarmas hará falta de todos modos.

**Files:**
- Create: `packages/ui-system/components/foundation/Icon.tsx`
- Create: `packages/ui-system/components/foundation/Icon.module.css`
- Create: `packages/ui-system/components/foundation/Tooltip.tsx`
- Create: `packages/ui-system/components/foundation/Tooltip.module.css`
- Create: `packages/ui-system/components/foundation/index.ts`
- Test: `packages/ui-system/components/foundation/foundation.test.tsx`
- Modify: `packages/ui-system/index.ts`

**Interfaces:**
- Consumes: tokens de Task 1 vía custom properties CSS.
- Produces: `Icon({ name, size?, label? })` con `IconName = "play" | "pause" | "stop" | "ecg" | "signal" | "warning" | "error" | "download" | "settings" | "heart"`, y `Tooltip({ content, placement?, children })` con `TooltipPlacement = "top" | "right" | "bottom" | "left"`.

- [ ] **Step 1: Escribir los tests que fallan**

`packages/ui-system/components/foundation/foundation.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

describe("Icon", () => {
  it("es decorativo por defecto: oculto para lectores de pantalla", () => {
    // Un icono junto a un texto que ya dice lo mismo solo anade ruido al
    // lector de pantalla. Solo se nombra si es la unica informacion.
    const { container } = render(<Icon name="play" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("con label pasa a ser una imagen accesible", () => {
    render(<Icon name="warning" label="Advertencia" />);
    expect(screen.getByRole("img", { name: "Advertencia" })).toBeInTheDocument();
  });

  it("dibuja algo para todos los nombres declarados", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector("path"), name).toBeTruthy();
      unmount();
    }
  });
});

describe("Tooltip", () => {
  it("no muestra el contenido hasta que hay hover", async () => {
    render(
      <Tooltip content="Altura insuficiente">
        <button type="button">Estado</button>
      </Tooltip>
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole("button", { name: "Estado" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Altura insuficiente");
  });

  it("tambien aparece con el foco de teclado", async () => {
    // Un tooltip que solo responde al raton deja fuera a quien navega con
    // teclado, que es justo quien mas necesita la explicacion.
    render(
      <Tooltip content="Explicacion">
        <button type="button">Estado</button>
      </Tooltip>
    );

    await userEvent.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("describe al hijo mediante aria-describedby", async () => {
    render(
      <Tooltip content="Explicacion">
        <button type="button">Estado</button>
      </Tooltip>
    );

    await userEvent.hover(screen.getByRole("button"));
    const describedBy = screen.getByRole("button").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByRole("tooltip")).toHaveAttribute("id", describedBy!);
  });
});
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/`
Expected: FAIL — `Failed to resolve import "./Icon"`.

- [ ] **Step 3: Escribir Icon**

`packages/ui-system/components/foundation/Icon.module.css`:

```css
.icon {
  display: inline-block;
  flex: none;
  vertical-align: -0.125em;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

`packages/ui-system/components/foundation/Icon.tsx`:

```tsx
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
```

- [ ] **Step 4: Escribir Tooltip**

`packages/ui-system/components/foundation/Tooltip.module.css`:

```css
.wrapper {
  position: relative;
  display: inline-flex;
}

.bubble {
  position: absolute;
  z-index: 10;
  max-width: 260px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-sm);
  background: var(--panel-background);
  box-shadow: var(--shadow-overlay);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
  /* El texto de un tooltip es una frase, no una etiqueta: sin esto hereda el
     nowrap de la barra de estado y se sale de la pantalla. */
  white-space: normal;
  pointer-events: none;
}

.top {
  bottom: calc(100% + var(--space-2));
  left: 50%;
  transform: translateX(-50%);
}

.bottom {
  top: calc(100% + var(--space-2));
  left: 50%;
  transform: translateX(-50%);
}

.left {
  right: calc(100% + var(--space-2));
  top: 50%;
  transform: translateY(-50%);
}

.right {
  left: calc(100% + var(--space-2));
  top: 50%;
  transform: translateY(-50%);
}
```

`packages/ui-system/components/foundation/Tooltip.tsx`:

```tsx
import { cloneElement, useId, useState, type ReactElement } from "react";
import styles from "./Tooltip.module.css";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  content: string;
  placement?: TooltipPlacement;
  /** Un único elemento enfocable. Recibe `aria-describedby` mientras el
   * tooltip está visible. */
  children: ReactElement;
}

/** Tooltip mínimo: posicionamiento absoluto, cuatro colocaciones, sin portal y
 * sin animación.
 *
 * No usa el `title=""` nativo porque hace falta que aparezca también con el
 * foco de teclado y que su contenido sea un nodo describible por
 * `aria-describedby`. No usa una librería de posicionamiento porque dentro de
 * paneles de anchura conocida las cuatro colocaciones fijas bastan. */
export function Tooltip({ content, placement = "top", children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const child = cloneElement(children, {
    "aria-describedby": visible ? id : undefined,
  } as Record<string, unknown>);

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {child}
      {visible && (
        <span role="tooltip" id={id} className={`${styles.bubble} ${styles[placement]}`}>
          {content}
        </span>
      )}
    </span>
  );
}
```

`packages/ui-system/components/foundation/index.ts`:

```ts
export { Icon, ICON_NAMES, type IconName, type IconProps } from "./Icon";
export { Tooltip, type TooltipPlacement, type TooltipProps } from "./Tooltip";
```

Añadir a `packages/ui-system/index.ts`:

```ts
export * from "./components/foundation/index";
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/`
Expected: 6 tests PASS.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 153 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-system
git commit -m "feat(ui-system): capa Foundation con Icon y Tooltip

Icon envuelve diez trazados propios en vez de traer una libreria entera, y es
decorativo por defecto: solo se anuncia si se le pasa label. Tooltip aparece
con hover Y con foco de teclado, y describe al hijo por aria-describedby --
por eso no basta el title nativo."
```

---

### Task 9: Surface y Data

Las superficies sobre las que se monta todo y las piezas que muestran valores.

**Files:**
- Create: `packages/ui-system/components/surface/Panel.tsx` + `Panel.module.css`
- Create: `packages/ui-system/components/surface/SectionTitle.tsx` + `SectionTitle.module.css`
- Create: `packages/ui-system/components/surface/Divider.tsx` + `Divider.module.css`
- Create: `packages/ui-system/components/surface/ControlGroup.tsx` + `ControlGroup.module.css`
- Create: `packages/ui-system/components/surface/index.ts`
- Create: `packages/ui-system/components/data/Metric.tsx` + `Metric.module.css`
- Create: `packages/ui-system/components/data/MetricGrid.tsx` + `MetricGrid.module.css`
- Create: `packages/ui-system/components/data/Badge.tsx` + `Badge.module.css`
- Create: `packages/ui-system/components/data/index.ts`
- Test: `packages/ui-system/components/surface/surface.test.tsx`
- Test: `packages/ui-system/components/data/data.test.tsx`
- Modify: `packages/ui-system/index.ts`

**Interfaces:**
- Consumes: tokens y temas.
- Produces: `Panel({ children, className? })`, `SectionTitle({ children })`, `Divider()`, `ControlGroup({ label, children })`, `Metric({ label, value, unit?, tone?, unavailable? })`, `MetricGrid({ children, columns? })`, `Badge({ tone, children })` con `Tone = "neutral" | "ok" | "warning" | "critical"`.

- [ ] **Step 1: Escribir los tests que fallan**

`packages/ui-system/components/surface/surface.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlGroup, Divider, Panel, SectionTitle } from "./index";

describe("Panel", () => {
  it("acepta una clase extra sin perder la propia", () => {
    // El layout necesita colocar el panel en su area de grid sin que el panel
    // sepa nada del layout.
    const { container } = render(<Panel className="externa">contenido</Panel>);
    const panel = container.firstElementChild!;
    expect(panel.className).toContain("externa");
    expect(panel.className.split(" ").length).toBeGreaterThan(1);
  });
});

describe("SectionTitle", () => {
  it("es una cabecera real, no un div con estilo", () => {
    render(<SectionTitle>Paciente</SectionTitle>);
    expect(screen.getByRole("heading", { name: "Paciente" })).toBeInTheDocument();
  });
});

describe("Divider", () => {
  it("se anuncia como separador", () => {
    render(<Divider />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});

describe("ControlGroup", () => {
  it("agrupa los controles con un nombre accesible", () => {
    // fieldset + legend en vez de div + span: asi el lector de pantalla anuncia
    // "Calidad de senal" al entrar en el grupo.
    render(
      <ControlGroup label="Calidad de señal">
        <button type="button">Perfecta</button>
      </ControlGroup>
    );
    expect(screen.getByRole("group", { name: "Calidad de señal" })).toBeInTheDocument();
  });
});
```

`packages/ui-system/components/data/data.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Metric, MetricGrid } from "./index";

describe("Metric", () => {
  it("muestra etiqueta, valor y unidad", () => {
    render(<Metric label="FC" value="72" unit="lpm" />);
    expect(screen.getByText("FC")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("lpm")).toBeInTheDocument();
  });

  it("una metrica no disponible lo dice, no finge un valor", () => {
    // Es el caso de PR/QRS/QT hasta la Entrega 2: el motor los calcula pero la
    // API no los expone. Mostrar un guion sin explicacion haria pensar en un
    // fallo de medida en vez de en una funcion que aun no existe.
    render(<Metric label="PR" value="" unavailable />);
    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("—")).toHaveAttribute("aria-label", "no disponible");
  });

  it("el valor se anuncia en vivo para que un cambio se oiga", () => {
    render(<Metric label="FC" value="72" unit="lpm" />);
    expect(screen.getByText("72").closest("[aria-live]")).not.toBeNull();
  });
});

describe("MetricGrid", () => {
  it("expone las metricas como una lista", () => {
    render(
      <MetricGrid>
        <Metric label="FC" value="72" unit="lpm" />
        <Metric label="RR" value="820" unit="ms" />
      </MetricGrid>
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Badge", () => {
  it("muestra su contenido", () => {
    render(<Badge tone="ok">Normal</Badge>);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("el tono no es la unica senal: hay texto", () => {
    // Un indicador que solo cambia de color deja fuera a quien no distingue
    // esos colores. El texto siempre acompana.
    const { container } = render(<Badge tone="critical">Muy compacta</Badge>);
    expect(container.textContent).toBe("Muy compacta");
  });
});
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/surface ../../packages/ui-system/components/data`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Escribir Surface**

`packages/ui-system/components/surface/Panel.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  padding: var(--space-4);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  background: var(--panel-background);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-md);
}
```

`packages/ui-system/components/surface/Panel.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export interface PanelProps {
  children: ReactNode;
  /** Para que el layout pueda colocarlo en su área de grid sin que el panel
   * sepa nada del layout. */
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return <div className={[styles.panel, className].filter(Boolean).join(" ")}>{children}</div>;
}
```

`packages/ui-system/components/surface/SectionTitle.module.css`:

```css
.title {
  margin: 0;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.08em;
  line-height: var(--line-height-tight);
  text-transform: uppercase;
}
```

`packages/ui-system/components/surface/SectionTitle.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./SectionTitle.module.css";

export interface SectionTitleProps {
  children: ReactNode;
}

/** `h2` y no un `div` con estilo: los títulos de sección son la estructura por
 * la que navega un lector de pantalla. */
export function SectionTitle({ children }: SectionTitleProps) {
  return <h2 className={styles.title}>{children}</h2>;
}
```

`packages/ui-system/components/surface/Divider.module.css`:

```css
.divider {
  height: 1px;
  margin: 0;
  border: 0;
  background: var(--panel-border);
}
```

`packages/ui-system/components/surface/Divider.tsx`:

```tsx
import styles from "./Divider.module.css";

export function Divider() {
  return <hr className={styles.divider} />;
}
```

`packages/ui-system/components/surface/ControlGroup.module.css`:

```css
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.legend {
  padding: 0;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

`packages/ui-system/components/surface/ControlGroup.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./ControlGroup.module.css";

export interface ControlGroupProps {
  label: string;
  children: ReactNode;
}

/** `fieldset` + `legend` y no `div` + `span`: así el lector de pantalla anuncia
 * el nombre del grupo al entrar en él, en vez de leer controles sueltos sin
 * contexto. */
export function ControlGroup({ label, children }: ControlGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {children}
    </fieldset>
  );
}
```

`packages/ui-system/components/surface/index.ts`:

```ts
export { Panel, type PanelProps } from "./Panel";
export { SectionTitle, type SectionTitleProps } from "./SectionTitle";
export { Divider } from "./Divider";
export { ControlGroup, type ControlGroupProps } from "./ControlGroup";
```

- [ ] **Step 4: Escribir Data**

`packages/ui-system/components/data/Metric.module.css`:

```css
.metric {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.label {
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.readout {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  min-width: 0;
}

.value {
  /* Monoespaciada y con cifras tabulares: un valor que cambia cada segundo no
     debe hacer bailar la columna entera. */
  font-family: var(--font-mono);
  font-size: var(--font-size-lg);
  font-variant-numeric: tabular-nums;
  line-height: var(--line-height-tight);
}

.unit {
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
}

.neutral { color: var(--text-primary); }
.ok { color: var(--inspector-ok); }
.warning { color: var(--inspector-warning); }
.critical { color: var(--inspector-critical); }

.unavailable {
  color: var(--text-muted);
}
```

`packages/ui-system/components/data/Metric.tsx`:

```tsx
import styles from "./Metric.module.css";

export type Tone = "neutral" | "ok" | "warning" | "critical";

export interface MetricProps {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  /** La medida no existe todavía en el sistema, no es que haya fallado. Es el
   * caso de PR/QRS/QT hasta la Entrega 2. */
  unavailable?: boolean;
}

export function Metric({ label, value, unit, tone = "neutral", unavailable }: MetricProps) {
  return (
    <div className={styles.metric}>
      <span className={styles.label}>{label}</span>
      <span className={styles.readout} aria-live="polite">
        {unavailable ? (
          <span className={`${styles.value} ${styles.unavailable}`} aria-label="no disponible">
            —
          </span>
        ) : (
          <>
            <span className={`${styles.value} ${styles[tone]}`}>{value}</span>
            {unit && <span className={styles.unit}>{unit}</span>}
          </>
        )}
      </span>
    </div>
  );
}
```

`packages/ui-system/components/data/MetricGrid.module.css`:

```css
.grid {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
```

`packages/ui-system/components/data/MetricGrid.tsx`:

```tsx
import { Children, type ReactNode } from "react";
import styles from "./MetricGrid.module.css";

export interface MetricGridProps {
  children: ReactNode;
  columns?: number;
}

/** Lista real (`ul`/`li`) y no una rejilla de `div`: un lector de pantalla
 * anuncia cuántas medidas hay y por dónde va, que en un inspector de seis
 * valores es la diferencia entre orientarse y no. */
export function MetricGrid({ children, columns = 2 }: MetricGridProps) {
  return (
    <ul className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Children.map(children, (child, index) => (
        <li key={index}>{child}</li>
      ))}
    </ul>
  );
}
```

`packages/ui-system/components/data/Badge.module.css`:

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.neutral { color: var(--text-muted); }
.ok { color: var(--inspector-ok); }
.warning { color: var(--inspector-warning); }
.critical { color: var(--inspector-critical); }
```

`packages/ui-system/components/data/Badge.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./Badge.module.css";
import type { Tone } from "./Metric";

export interface BadgeProps {
  tone: Tone;
  /** Siempre texto, nunca solo color: un indicador que se distingue únicamente
   * por el tono deja fuera a quien no distingue esos tonos. */
  children: ReactNode;
}

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
```

`packages/ui-system/components/data/index.ts`:

```ts
export { Metric, type MetricProps, type Tone } from "./Metric";
export { MetricGrid, type MetricGridProps } from "./MetricGrid";
export { Badge, type BadgeProps } from "./Badge";
```

Añadir a `packages/ui-system/index.ts`:

```ts
export * from "./components/surface/index";
export * from "./components/data/index";
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/`
Expected: 14 tests PASS (6 de foundation + 4 de surface + 4 de data... contar: surface tiene 4, data tiene 6, total 16).

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 163 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-system
git commit -m "feat(ui-system): capas Surface y Data

Panel, SectionTitle, Divider, ControlGroup, Metric, MetricGrid y Badge, todos
sobre tokens y sin un solo valor de espaciado escrito a mano.

Decisiones de accesibilidad: SectionTitle es un h2 real, ControlGroup es
fieldset+legend (el lector anuncia el grupo al entrar), MetricGrid es ul/li
(anuncia cuantas medidas hay), y Badge siempre lleva texto porque un
indicador que solo cambia de color deja fuera a quien no lo distingue.

Metric tiene estado 'unavailable' explicito para PR/QRS/QT: hasta la Entrega
2 la API no expone esas medidas, y un guion sin explicacion haria pensar en
un fallo de medida en vez de en algo que aun no existe."
```

---

### Task 10: Controls

Los cuatro controles del panel de escenario. `SegmentedControl` es la pieza que da aspecto de consola y absorbe cuatro usos: derivaciones, presets de ruido, velocidad de papel y selector de tema.

**Files:**
- Create: `packages/ui-system/components/controls/SegmentedControl.tsx` + `.module.css`
- Create: `packages/ui-system/components/controls/Slider.tsx` + `.module.css`
- Create: `packages/ui-system/components/controls/Stepper.tsx` + `.module.css`
- Create: `packages/ui-system/components/controls/Select.tsx` + `.module.css`
- Create: `packages/ui-system/components/controls/index.ts`
- Test: `packages/ui-system/components/controls/controls.test.tsx`
- Modify: `packages/ui-system/index.ts`

**Interfaces:**
- Consumes: tokens, `Icon` de Task 8.
- Produces:
  - `SegmentedControl<T extends string>({ label, value, options, onChange })` con `options: Array<{ value: T; label: string }>`
  - `Slider({ label, value, min, max, step, onChange })`
  - `Stepper({ label, value, onIncrement, onDecrement, disabled?, incrementLabel, decrementLabel })`
  - `Select({ label, value, options, onChange, placeholder? })` con `options: Array<{ value: string; label: string }>`

- [ ] **Step 1: Escribir los tests que fallan**

`packages/ui-system/components/controls/controls.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select, SegmentedControl, Slider, Stepper } from "./index";

describe("SegmentedControl", () => {
  const OPTIONS = [
    { value: "1", label: "1" },
    { value: "3", label: "3" },
    { value: "6", label: "6" },
    { value: "12", label: "12" },
  ];

  it("es un radiogroup con el nombre que se le pasa", () => {
    // El LayoutPicker actual usa role=radiogroup + aria-label="Derivaciones
    // visibles", y un test existente depende de ese nombre exacto.
    render(
      <SegmentedControl label="Derivaciones visibles" value="6" options={OPTIONS} onChange={vi.fn()} />
    );
    expect(
      screen.getByRole("radiogroup", { name: "Derivaciones visibles" })
    ).toBeInTheDocument();
  });

  it("marca la opcion activa y solo esa", () => {
    render(
      <SegmentedControl label="Derivaciones visibles" value="6" options={OPTIONS} onChange={vi.fn()} />
    );
    expect(screen.getByRole("radio", { name: "6" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "12" })).not.toBeChecked();
  });

  it("avisa del valor nuevo al pulsar otra opcion", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Derivaciones visibles" value="6" options={OPTIONS} onChange={onChange} />
    );

    await userEvent.click(screen.getByRole("radio", { name: "12" }));

    expect(onChange).toHaveBeenCalledWith("12");
  });
});

describe("Slider", () => {
  it("expone el nombre que se le pasa, no uno inventado", () => {
    // Los sliders de ruido dependen de estos nombres exactos: "EMG",
    // "Interferencia 50Hz", "Linea base", "Movimiento", "Saturacion".
    render(
      <Slider label="EMG" value={0} min={0} max={1} step={0.01} onChange={vi.fn()} />
    );
    expect(screen.getByRole("slider", { name: "EMG" })).toBeInTheDocument();
  });

  it("propaga el valor como numero, no como texto", async () => {
    const onChange = vi.fn();
    render(
      <Slider label="EMG" value={0} min={0} max={10} step={1} onChange={onChange} />
    );

    const slider = screen.getByRole("slider", { name: "EMG" });
    await userEvent.clear(slider).catch(() => undefined);
    // userEvent no arrastra un range: se dispara el cambio directamente.
    slider.setAttribute("value", "4");
    await userEvent.type(slider, "{arrowright}");

    expect(onChange).toHaveBeenCalled();
    expect(typeof onChange.mock.calls[0][0]).toBe("number");
  });
});

describe("Stepper", () => {
  it("cada boton tiene su propio nombre accesible", () => {
    render(
      <Stepper
        label="Frecuencia"
        value="72 lpm"
        decrementLabel="Bajar frecuencia"
        incrementLabel="Subir frecuencia"
        onDecrement={vi.fn()}
        onIncrement={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Bajar frecuencia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir frecuencia" })).toBeInTheDocument();
  });

  it("deshabilitado no llama a nadie", async () => {
    const onIncrement = vi.fn();
    render(
      <Stepper
        label="Frecuencia"
        value="150 lpm (fija)"
        disabled
        decrementLabel="Bajar frecuencia"
        incrementLabel="Subir frecuencia"
        onDecrement={vi.fn()}
        onIncrement={onIncrement}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Subir frecuencia" }));

    expect(onIncrement).not.toHaveBeenCalled();
  });

  it("el valor se anuncia en vivo", () => {
    render(
      <Stepper
        label="Frecuencia"
        value="72 lpm"
        decrementLabel="Bajar frecuencia"
        incrementLabel="Subir frecuencia"
        onDecrement={vi.fn()}
        onIncrement={vi.fn()}
      />
    );
    expect(screen.getByText("72 lpm").closest("[aria-live]")).not.toBeNull();
  });
});

describe("Select", () => {
  it("expone el nombre que se le pasa", () => {
    render(
      <Select
        label="Calidad de señal"
        value="perfecta"
        options={[{ value: "perfecta", label: "Perfecta" }]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Calidad de señal")).toBeInTheDocument();
  });

  it("con placeholder aparece una opcion inicial deshabilitada", () => {
    render(
      <Select
        label="Seleccionar ritmo"
        value=""
        placeholder="Selecciona un ritmo"
        options={[{ value: "sinus_normal", label: "Ritmo sinusal normal" }]}
        onChange={vi.fn()}
      />
    );
    const placeholder = screen.getByRole("option", { name: "Selecciona un ritmo" });
    expect(placeholder).toBeDisabled();
  });

  it("avisa del valor elegido", async () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Seleccionar ritmo"
        value=""
        placeholder="Selecciona un ritmo"
        options={[{ value: "sinus_normal", label: "Ritmo sinusal normal" }]}
        onChange={onChange}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");

    expect(onChange).toHaveBeenCalledWith("sinus_normal");
  });
});
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/controls`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Escribir SegmentedControl**

`packages/ui-system/components/controls/SegmentedControl.module.css`:

```css
.group {
  display: inline-flex;
  min-width: 0;
  margin: 0;
  padding: 2px;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-sm);
  background: var(--surface-background);
}

.legend {
  /* El nombre lo aporta el aria-label del contenedor; la leyenda visible
     sobra y ocuparia una linea entera dentro de la barra. */
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.option {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  padding: var(--space-1) var(--space-3);
  border-radius: calc(var(--radius-sm) - 2px);
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  transition: background var(--motion-fast), color var(--motion-fast);
}

.option:hover {
  background: var(--panel-hover);
}

.input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.input:checked + .text {
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}

.selected {
  background: var(--panel-hover);
  color: var(--text-primary);
}

/* Foco visible: sin esto, navegar el control con teclado es invisible porque
   el radio real esta oculto. */
.input:focus-visible + .text {
  outline: 2px solid var(--inspector-ok);
  outline-offset: 2px;
  border-radius: 2px;
}
```

`packages/ui-system/components/controls/SegmentedControl.tsx`:

```tsx
import { useId } from "react";
import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
}

/** Un grupo de radios con aspecto de botonera de consola.
 *
 * Radios de verdad y no botones: el teclado ya sabe recorrer un radiogroup con
 * las flechas, y un lector de pantalla anuncia "2 de 4". Reimplementar eso con
 * botones sale siempre peor.
 *
 * Absorbe cuatro usos —derivaciones, presets de ruido, velocidad de papel y
 * selector de tema—, que de otro modo serían cuatro componentes casi
 * idénticos. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId();

  return (
    <fieldset className={styles.group} role="radiogroup" aria-label={label}>
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`${styles.option} ${option.value === value ? styles.selected : ""}`}
        >
          <input
            className={styles.input}
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.text}>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
```

- [ ] **Step 4: Escribir Slider, Stepper y Select**

`packages/ui-system/components/controls/Slider.module.css`:

```css
.wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input {
  flex: 0 0 120px;
  accent-color: var(--inspector-ok);
}
```

`packages/ui-system/components/controls/Slider.tsx`:

```tsx
import styles from "./Slider.module.css";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className={styles.wrapper}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
```

`packages/ui-system/components/controls/Stepper.module.css`:

```css
.wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-sm);
  background: var(--surface-background);
  color: var(--text-primary);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--font-size-md);
  transition: background var(--motion-fast);
}

.button:hover:not(:disabled) {
  background: var(--panel-hover);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.value {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
```

`packages/ui-system/components/controls/Stepper.tsx`:

```tsx
import styles from "./Stepper.module.css";

export interface StepperProps {
  label: string;
  /** Ya formateado por el llamante: el Stepper no sabe de unidades. */
  value: string;
  decrementLabel: string;
  incrementLabel: string;
  onDecrement: () => void;
  onIncrement: () => void;
  disabled?: boolean;
}

export function Stepper({
  label,
  value,
  decrementLabel,
  incrementLabel,
  onDecrement,
  onIncrement,
  disabled,
}: StepperProps) {
  return (
    <div className={styles.wrapper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.button}
        aria-label={decrementLabel}
        disabled={disabled}
        onClick={onDecrement}
      >
        −
      </button>
      <span className={styles.value} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={styles.button}
        aria-label={incrementLabel}
        disabled={disabled}
        onClick={onIncrement}
      >
        +
      </button>
    </div>
  );
}
```

`packages/ui-system/components/controls/Select.module.css`:

```css
.select {
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-sm);
  background: var(--surface-background);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-md);
}

.select:hover {
  background: var(--panel-hover);
}
```

`packages/ui-system/components/controls/Select.tsx`:

```tsx
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Opción inicial deshabilitada, para cuando "nada elegido" es un estado
   * válido pero no una opción elegible. */
  placeholder?: string;
}

export function Select({ label, value, options, onChange, placeholder }: SelectProps) {
  return (
    <select
      className={styles.select}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
```

`packages/ui-system/components/controls/index.ts`:

```ts
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./SegmentedControl";
export { Slider, type SliderProps } from "./Slider";
export { Stepper, type StepperProps } from "./Stepper";
export { Select, type SelectProps, type SelectOption } from "./Select";
```

Añadir a `packages/ui-system/index.ts`:

```ts
export * from "./components/controls/index";
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/controls`
Expected: 10 tests PASS. Si el segundo test de `Slider` da problemas por cómo `userEvent` trata un `input[type=range]`, sustituirlo por un cambio directo:

```tsx
    const slider = screen.getByRole("slider", { name: "EMG" }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith(4);
```

importando `fireEvent` de `@testing-library/react`.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 173 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-system
git commit -m "feat(ui-system): capa Controls

SegmentedControl, Slider, Stepper y Select. SegmentedControl usa radios de
verdad y no botones: el teclado ya sabe recorrer un radiogroup con las flechas
y el lector anuncia '2 de 4'. Absorbe cuatro usos (derivaciones, presets de
ruido, velocidad de papel, tema) que si no serian cuatro componentes casi
identicos.

Todos reciben su nombre accesible por prop, para poder conservar los nombres
exactos de los que dependen los tests existentes."
```

---

### Task 11: Layout — la shell de cinco zonas

**Files:**
- Create: `packages/ui-system/components/layout/AppShell.tsx` + `.module.css`
- Create: `packages/ui-system/components/layout/Header.tsx` + `.module.css`
- Create: `packages/ui-system/components/layout/Sidebar.tsx` + `.module.css`
- Create: `packages/ui-system/components/layout/Inspector.tsx` + `.module.css`
- Create: `packages/ui-system/components/layout/StatusBar.tsx` + `.module.css`
- Create: `packages/ui-system/components/layout/index.ts`
- Test: `packages/ui-system/components/layout/layout.test.tsx`
- Modify: `packages/ui-system/index.ts`

**Interfaces:**
- Consumes: tokens, `Panel` de Task 9.
- Produces: `AppShell({ header, sidebar, ecg, inspector, status })`, `Header({ title, children })`, `Sidebar({ children })`, `Inspector({ children })`, `StatusBar({ children })`.

- [ ] **Step 1: Escribir los tests que fallan**

`packages/ui-system/components/layout/layout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell, Header, Inspector, Sidebar, StatusBar } from "./index";

describe("AppShell", () => {
  it("coloca las cinco zonas y las anuncia con landmarks distintos", () => {
    render(
      <AppShell
        header={<Header title="Simulador ECG" />}
        sidebar={<Sidebar>escenario</Sidebar>}
        ecg={<div>trazado</div>}
        inspector={<Inspector>medidas</Inspector>}
        status={<StatusBar>estado</StatusBar>}
      />
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    // El panel de escenario y el inspector son ambos `complementary`, asi que
    // se distinguen por nombre: sin eso, un lector de pantalla lee "region"
    // dos veces y no hay forma de saber en cual estas.
    expect(screen.getByRole("complementary", { name: "Escenario" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("trazado");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("estado");
  });

  it("el area de ECG es el main: es el contenido, no un adorno", () => {
    render(
      <AppShell
        header={<Header title="x" />}
        sidebar={<Sidebar>a</Sidebar>}
        ecg={<div data-testid="trazado" />}
        inspector={<Inspector>b</Inspector>}
        status={<StatusBar>c</StatusBar>}
      />
    );
    expect(screen.getByRole("main")).toContainElement(screen.getByTestId("trazado"));
  });
});

describe("Header", () => {
  it("muestra el titulo y lo que se le cuelgue", () => {
    render(<Header title="Simulador ECG">
      <span>extra</span>
    </Header>);
    expect(screen.getByText("Simulador ECG")).toBeInTheDocument();
    expect(screen.getByText("extra")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/layout`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Escribir AppShell**

`packages/ui-system/components/layout/AppShell.module.css`:

```css
.shell {
  display: grid;
  /* dvh y no vh: en tablet y movil la barra del navegador falsea vh y el
     layout da saltos al aparecer y desaparecer. */
  height: 100dvh;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--surface-background);
  grid-template-areas:
    "header  header    header"
    "sidebar ecg       inspector"
    "status  status    status";
  grid-template-columns: 280px 1fr 320px;
  grid-template-rows: auto 1fr auto;
  box-sizing: border-box;
}

.header { grid-area: header; }
.sidebar { grid-area: sidebar; }
.inspector { grid-area: inspector; }
.status { grid-area: status; }

.ecg {
  grid-area: ecg;
  /* Sin min-height:0 un hijo con contenido fuerza el desbordamiento de la fila,
     el grid crece mas alla del viewport y reaparece el scroll que el spec
     descarta. Es el fallo clasico de Grid. */
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Por debajo de esto las tres columnas no caben. Los paneles pasan a apilarse
   y el ECG mantiene su prioridad de altura. */
@media (max-width: 1100px) {
  .shell {
    grid-template-areas:
      "header"
      "ecg"
      "sidebar"
      "inspector"
      "status";
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto auto auto;
    height: auto;
    min-height: 100dvh;
  }
}
```

`packages/ui-system/components/layout/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  ecg: ReactNode;
  inspector: ReactNode;
  status: ReactNode;
}

/** Las cinco zonas fijas del puesto de simulación.
 *
 * El panel derecho es contextual y cambiará —inspector ahora, corazón 3D
 * después, farmacología más tarde—. El área de ECG no se mueve nunca. */
export function AppShell({ header, sidebar, ecg, inspector, status }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.header}>{header}</div>
      <div className={styles.sidebar}>{sidebar}</div>
      <main className={styles.ecg}>{ecg}</main>
      <div className={styles.inspector}>{inspector}</div>
      <div className={styles.status}>{status}</div>
    </div>
  );
}
```

- [ ] **Step 4: Escribir Header, Sidebar, Inspector y StatusBar**

`packages/ui-system/components/layout/Header.module.css`:

```css
.header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  background: var(--panel-background);
}

.title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.slot {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  justify-content: flex-end;
}
```

`packages/ui-system/components/layout/Header.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./Header.module.css";

export interface HeaderProps {
  title: string;
  children?: ReactNode;
}

export function Header({ title, children }: HeaderProps) {
  return (
    <header className={styles.header} role="banner">
      <h1 className={styles.title}>{title}</h1>
      {children && <div className={styles.slot}>{children}</div>}
    </header>
  );
}
```

`packages/ui-system/components/layout/Sidebar.module.css`:

```css
.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
  /* El escenario si puede scrollear: no es el ECG. Con doce sliders abiertos en
     una pantalla corta, la alternativa es recortarlos. */
  overflow-y: auto;
}
```

`packages/ui-system/components/layout/Sidebar.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  children: ReactNode;
}

/** Panel de escenario. `complementary` con nombre: comparte rol con el
 * inspector, y sin nombre un lector de pantalla lee "region" dos veces sin
 * forma de distinguirlas. */
export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="Escenario">
      {children}
    </aside>
  );
}
```

`packages/ui-system/components/layout/Inspector.module.css`:

```css
.inspector {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
  overflow-y: auto;
}
```

`packages/ui-system/components/layout/Inspector.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./Inspector.module.css";

export interface InspectorProps {
  children: ReactNode;
}

export function Inspector({ children }: InspectorProps) {
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      {children}
    </aside>
  );
}
```

`packages/ui-system/components/layout/StatusBar.module.css`:

```css
.status {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-1) var(--space-4);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  background: var(--panel-background);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow-x: auto;
}
```

`packages/ui-system/components/layout/StatusBar.tsx`:

```tsx
import type { ReactNode } from "react";
import styles from "./StatusBar.module.css";

export interface StatusBarProps {
  children: ReactNode;
}

/** Información técnica: útil para depurar, sin ocupar espacio clínico. */
export function StatusBar({ children }: StatusBarProps) {
  return (
    <footer className={styles.status} role="contentinfo">
      {children}
    </footer>
  );
}
```

`packages/ui-system/components/layout/index.ts`:

```ts
export { AppShell, type AppShellProps } from "./AppShell";
export { Header, type HeaderProps } from "./Header";
export { Sidebar, type SidebarProps } from "./Sidebar";
export { Inspector, type InspectorProps } from "./Inspector";
export { StatusBar, type StatusBarProps } from "./StatusBar";
```

Añadir a `packages/ui-system/index.ts`:

```ts
export * from "./components/layout/index";
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd apps/web && npx vitest run ../../packages/ui-system/components/layout`
Expected: 3 tests PASS.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 176 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-system
git commit -m "feat(ui-system): shell de cinco zonas sobre CSS Grid

AppShell con grid-template-areas, 100dvh (vh da saltos en tablet cuando
aparece la barra del navegador) y min-height:0 en el area de ECG, sin lo cual
un hijo con contenido desborda la fila y reaparece el scroll que el spec
descarta.

El area de ECG es el main y no scrollea nunca; sidebar e inspector si pueden,
porque no son el ECG. Los dos son complementary con nombre para que un lector
de pantalla pueda distinguirlos."
```

---

### Task 12: LeadStrip, EcgDisplay y los hooks del renderer

Aquí se juntan el LayoutEngine, el renderer tematizado y el repintado completo. Cada tira pasa a tener su propio canvas de rejilla, que es lo que arregla la desalineación del canvas suelto de 800x600.

**Files:**
- Create: `apps/web/src/ui/LeadStrip.tsx` + `LeadStrip.module.css`
- Create: `apps/web/src/ui/EcgDisplay.tsx` + `EcgDisplay.module.css`
- Create: `apps/web/src/ui/hooks/useLayoutMetrics.ts`
- Create: `apps/web/src/ui/hooks/useSweepRenderer.ts`
- Create: `apps/web/src/ui/hooks/useSimulationRuntime.ts`
- Test: `apps/web/src/ui/hooks/useLayoutMetrics.test.tsx`
- Modify: `apps/web/src/test-setup.ts`

**Interfaces:**
- Consumes: `computeLayoutMetrics`/`LayoutMetrics` (Task 3), `SweepBuffer`/`sweepCapacitySamples` (Task 4), `drawGrid` (Task 5), `drawSweepSegment`/`LeadCanvasOptions` (Task 6), `SweepRebuilder` (Task 7), `Theme` (Task 2), `SessionRuntime` y `useSessionStore` (existentes), `leadsForLayout`/`leadIndex`/`LeadName` (existentes).
- Produces:
  - `useLayoutMetrics({ leadCount, clinicalGainMmPerMv, paperSpeedMmS }) => { containerRef, metrics, widthPx }`
  - `useSweepRenderer({ runtime, leads, sampleRateHz, metrics, widthPx, theme }) => { registerTrace, registerGrid, isAwaitingSignal }`
  - `useSimulationRuntime(runtime) => void`
  - `LeadStrip({ lead, heightPx, widthPx, registerTrace, registerGrid })`
  - `EcgDisplay({ containerRef, leads, metrics, widthPx, registerTrace, registerGrid })`

- [ ] **Step 1: Dar a jsdom un ResizeObserver**

jsdom no lo implementa, así que sin esto cualquier test que monte `useLayoutMetrics` lanza `ResizeObserver is not defined`.

`apps/web/src/test-setup.ts` — reemplazar el fichero completo:

```ts
import "@testing-library/jest-dom/vitest";

// jsdom no implementa ResizeObserver, y `useLayoutMetrics` lo necesita. El
// doble no observa nada: en jsdom los elementos no tienen tamaño real, así que
// las medidas las inyecta cada test a mano cuando le hacen falta.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
```

- [ ] **Step 2: Escribir el test de useLayoutMetrics**

`apps/web/src/ui/hooks/useLayoutMetrics.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLayoutMetrics } from "./useLayoutMetrics";

function Probe({ leadCount }: { leadCount: number }) {
  const { containerRef, metrics, widthPx } = useLayoutMetrics({
    leadCount,
    clinicalGainMmPerMv: 10,
    paperSpeedMmS: 25,
  });
  return (
    <div ref={containerRef}>
      <span data-testid="strip">{metrics.stripHeightPx}</span>
      <span data-testid="compression">{metrics.compression}</span>
      <span data-testid="width">{widthPx}</span>
    </div>
  );
}

describe("useLayoutMetrics", () => {
  it("entrega metricas utilizables aunque el contenedor no tenga tamano medido", () => {
    // En jsdom todo mide 0. El hook debe devolver algo dibujable de todos
    // modos: si devolviera stripHeightPx = 0, los canvas serian degenerados y
    // el renderer no podria ni empezar.
    render(<Probe leadCount={12} />);

    expect(Number(screen.getByTestId("strip").textContent)).toBeGreaterThan(0);
    expect(Number(screen.getByTestId("width").textContent)).toBeGreaterThan(0);
  });

  it("clasifica la compresion a partir de las derivaciones visibles", () => {
    render(<Probe leadCount={1} />);
    expect(screen.getByTestId("compression").textContent).toBe("normal");
  });
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `cd apps/web && npx vitest run src/ui/hooks/useLayoutMetrics.test.tsx`
Expected: FAIL — `Failed to resolve import "./useLayoutMetrics"`.

- [ ] **Step 4: Escribir useLayoutMetrics**

`apps/web/src/ui/hooks/useLayoutMetrics.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { computeLayoutMetrics, type LayoutMetrics } from "../../render/layout-engine";

/** Tamaño de partida mientras no hay medida real. No es decorativo: en jsdom
 * todo mide cero, y unas métricas de altura cero producirían canvas
 * degenerados en los que el renderer no puede ni empezar a dibujar. */
const FALLBACK_WIDTH_PX = 800;
const FALLBACK_HEIGHT_PX = 600;

export interface UseLayoutMetricsParams {
  leadCount: number;
  clinicalGainMmPerMv: number;
  paperSpeedMmS: number;
}

export interface UseLayoutMetricsResult {
  containerRef: (element: HTMLElement | null) => void;
  metrics: LayoutMetrics;
  widthPx: number;
}

/** Observa el contenedor del ECG y traduce su tamaño a `LayoutMetrics`.
 *
 * Es la pieza que el spec llama `LayoutEngine` del lado de React: aquí vivirán
 * las decisiones de reparto que vengan después —ECG junto a corazón 3D,
 * pantalla partida, modo presentación—, y ninguna de ellas debería obligar a
 * tocar el renderer. */
export function useLayoutMetrics({
  leadCount,
  clinicalGainMmPerMv,
  paperSpeedMmS,
}: UseLayoutMetricsParams): UseLayoutMetricsResult {
  const [size, setSize] = useState({
    widthPx: FALLBACK_WIDTH_PX,
    heightPx: FALLBACK_HEIGHT_PX,
  });
  const observer = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!element) {
      observer.current = null;
      return;
    }
    observer.current = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Un contenedor de 0x0 es lo que reporta un elemento aún sin layout. No
      // se acepta: dejaría el ECG con canvas de altura cero hasta el siguiente
      // redimensionado.
      if (rect.width <= 0 || rect.height <= 0) return;
      setSize({ widthPx: rect.width, heightPx: rect.height });
    });
    observer.current.observe(element);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return {
    containerRef,
    widthPx: size.widthPx,
    metrics: computeLayoutMetrics(
      size.heightPx,
      leadCount,
      clinicalGainMmPerMv,
      paperSpeedMmS
    ),
  };
}
```

- [ ] **Step 5: Escribir useSimulationRuntime y useSweepRenderer**

`apps/web/src/ui/hooks/useSimulationRuntime.ts`:

```ts
import { useEffect } from "react";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import { useSessionStore } from "../../state/session-store";

/** Engancha el runtime al store y abre la conexión.
 *
 * `attachRuntime` devuelve `detach`, y devolverlo en el cleanup no es opcional:
 * React StrictMode monta, limpia y vuelve a montar el mismo efecto en
 * desarrollo sin recrear `runtime`, así que sin desuscribir se duplican los
 * listeners sobre la misma instancia y `framesLost` cuenta el doble. */
export function useSimulationRuntime(runtime: SessionRuntime): void {
  useEffect(() => {
    const detach = useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    return () => {
      detach();
      runtime.disconnect();
    };
  }, [runtime]);
}
```

`apps/web/src/ui/hooks/useSweepRenderer.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Theme } from "@ui-system/themes/types";
import { drawGrid } from "../../render/grid-layer";
import type { LayoutMetrics } from "../../render/layout-engine";
import { drawSweepSegment, type LeadCanvasOptions } from "../../render/lead-canvas";
import { SweepRebuilder } from "../../render/sweep-rebuilder";
import { SweepBuffer, sweepCapacitySamples } from "../../render/sweep-buffer";
import { leadIndex, type LeadName } from "../../render/layout";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";

export interface UseSweepRendererParams {
  runtime: SessionRuntime;
  leads: readonly LeadName[];
  sampleRateHz: number;
  metrics: LayoutMetrics;
  widthPx: number;
  theme: Theme;
}

export interface UseSweepRendererResult {
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  isAwaitingSignal: boolean;
}

const rebuilder = new SweepRebuilder();

/** Dueño del bucle de dibujo, de los anillos de barrido y de los repintados
 * completos. */
export function useSweepRenderer({
  runtime,
  leads,
  sampleRateHz,
  metrics,
  widthPx,
  theme,
}: UseSweepRendererParams): UseSweepRendererResult {
  const traceCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const gridCanvases = useRef(new Map<LeadName, HTMLCanvasElement>());
  const sweeps = useRef(new Map<LeadName, SweepBuffer>());
  const [isAwaitingSignal, setIsAwaitingSignal] = useState(false);

  const registerTrace = useCallback((lead: LeadName, element: HTMLCanvasElement | null) => {
    if (element) traceCanvases.current.set(lead, element);
    else traceCanvases.current.delete(lead);
  }, []);

  const registerGrid = useCallback((lead: LeadName, element: HTMLCanvasElement | null) => {
    if (element) gridCanvases.current.set(lead, element);
    else gridCanvases.current.delete(lead);
  }, []);

  const options: LeadCanvasOptions = { metrics, theme: theme.ecg };

  // Un anillo por derivación visible, dimensionado a los segundos de papel que
  // caben en el ancho del canvas — NO al buffer de jitter de red, que es dos
  // órdenes de magnitud menor. Se recrea si cambian layout, ancho o frecuencia
  // de muestreo, porque los tres alteran la capacidad.
  useEffect(() => {
    const capacity = sweepCapacitySamples(widthPx, metrics.pixelsPerSecond, sampleRateHz);
    const next = new Map<LeadName, SweepBuffer>();
    for (const lead of leads) next.set(lead, new SweepBuffer(capacity));
    sweeps.current = next;
  }, [leads, widthPx, metrics.pixelsPerSecond, sampleRateHz]);

  // Al arrancar una sesión el eje de tiempo empieza de cero: se vacían los
  // anillos y se limpian los canvas para no dejar el trazo del ritmo anterior
  // conviviendo con el nuevo.
  useEffect(() => {
    const onStarted = () => {
      for (const sweep of sweeps.current.values()) sweep.reset();
      for (const canvas of traceCanvases.current.values()) {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    runtime.on("started", onStarted);
    return () => runtime.off("started", onStarted);
  }, [runtime]);

  // REPINTADO COMPLETO. Se dispara con los cuatro eventos del spec:
  // redimensionado (widthPx / stripHeightPx), cambio de tema, cambio de layout
  // (leads) y cambio de viewportScale. Nunca desde el bucle de rAF.
  //
  // Asignar canvas.width o canvas.height borra el contenido, así que sin este
  // efecto el ECG quedaría en blanco unos ocho segundos tras cada
  // redimensionado, hasta que el barrido diera la vuelta.
  useEffect(() => {
    for (const lead of leads) {
      const grid = gridCanvases.current.get(lead);
      const gridCtx = grid?.getContext("2d");
      if (grid && gridCtx) {
        grid.width = widthPx;
        grid.height = metrics.stripHeightPx;
        drawGrid(gridCtx, widthPx, metrics.stripHeightPx, metrics, theme.ecg);
      }

      const trace = traceCanvases.current.get(lead);
      const traceCtx = trace?.getContext("2d");
      const sweep = sweeps.current.get(lead);
      if (trace && traceCtx && sweep) {
        trace.width = widthPx;
        trace.height = metrics.stripHeightPx;
        rebuilder.rebuild(traceCtx, sweep, sampleRateHz, options, metrics.stripHeightPx);
      }
    }
  }, [
    leads,
    widthPx,
    metrics.stripHeightPx,
    metrics.viewportScalePxPerMm,
    metrics.pixelsPerSecond,
    theme.name,
    sampleRateHz,
  ]);

  // Camino caliente. Aquí no entra nada que no sea dibujo incremental.
  useEffect(() => {
    let frameId: number;
    let lastS: number | undefined;

    const tick = (nowMs: number) => {
      const nowS = nowMs / 1000;
      const elapsedS = lastS === undefined ? 0 : nowS - lastS;
      lastS = nowS;

      runtime.buffer.advance(elapsedS);
      // Se dibuja lo que advance() haya liberado ESTE tick, aunque el buffer
      // haya quedado vacío al hacerlo: si no, el último trozo consumido antes
      // de un underrun se perdería sin llegar a pintarse. Con cero muestras
      // nuevas, drawSweepSegment no toca el canvas y el trazo se congela en la
      // última muestra, sin interpolar jamás.
      //
      // El hueco es el mismo para las doce derivaciones (viene del mismo trozo
      // multicanal), así que se lee una vez por tick y no por derivación.
      const hadGap = runtime.buffer.justConsumedHadGap;
      for (const lead of leads) {
        const canvas = traceCanvases.current.get(lead);
        const ctx = canvas?.getContext("2d");
        const sweep = sweeps.current.get(lead);
        if (!canvas || !ctx || !sweep) continue;
        const samples = runtime.buffer.consumeNewSamples(leadIndex(lead));
        drawSweepSegment(
          ctx, sweep, samples, sampleRateHz, options, canvas.height, hadGap
        );
      }

      // "Esperando señal" cubre los dos motivos opuestos de no reproducir: no
      // queda nada (underrun) o aún no hay reserva suficiente (pre-roll).
      setIsAwaitingSignal(runtime.buffer.isUnderrun || !runtime.buffer.isPreRolled);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [runtime, leads, sampleRateHz, metrics, theme.name]);

  return { registerTrace, registerGrid, isAwaitingSignal };
}
```

- [ ] **Step 6: Escribir LeadStrip y EcgDisplay**

`apps/web/src/ui/LeadStrip.module.css`:

```css
.strip {
  position: relative;
  flex: none;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
}

.canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.label {
  position: absolute;
  top: 2px;
  left: var(--space-2);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  /* El trazo pasa por debajo de la etiqueta: sin esto, el cursor del raton la
     convierte en un obstaculo para futuros calipers. */
  pointer-events: none;
  user-select: none;
}
```

`apps/web/src/ui/LeadStrip.tsx`:

```tsx
import type { LeadName } from "../render/layout";
import styles from "./LeadStrip.module.css";

export interface LeadStripProps {
  lead: LeadName;
  widthPx: number;
  heightPx: number;
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
}

/** Una derivación: canvas de rejilla al fondo, canvas de trazo encima,
 * etiqueta sobre ambos.
 *
 * Dos canvas y no uno porque el trazo se borra por bandas mientras la rejilla
 * permanece: con una sola capa habría que redibujar la rejilla de la banda en
 * cada tick. Y por tira, no global, porque el canvas suelto de 800x600 que
 * había antes no se alineaba con nada — además, así cada derivación es
 * autónoma y mañana se puede ampliar, congelar o resaltar una sin tocar el
 * resto. */
export function LeadStrip({
  lead,
  widthPx,
  heightPx,
  registerTrace,
  registerGrid,
}: LeadStripProps) {
  return (
    <div className={styles.strip} style={{ width: widthPx, height: heightPx }}>
      <canvas
        className={styles.canvas}
        ref={(element) => registerGrid(lead, element)}
        width={widthPx}
        height={heightPx}
        aria-hidden="true"
      />
      <canvas
        className={styles.canvas}
        data-testid={`lead-canvas-${lead}`}
        ref={(element) => registerTrace(lead, element)}
        width={widthPx}
        height={heightPx}
        aria-hidden="true"
      />
      <span className={styles.label}>{lead}</span>
    </div>
  );
}
```

`apps/web/src/ui/EcgDisplay.module.css`:

```css
.display {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  /* --space-1: el hueco que descuenta computeLayoutMetrics. */
  gap: var(--space-1);
  min-height: 0;
  min-width: 0;
  /* El area de ECG NO scrollea. Un monitor clinico no scrollea, y perderlo
     destruye la sensacion de monitorizacion continua. */
  overflow: hidden;
}
```

`apps/web/src/ui/EcgDisplay.tsx`:

```tsx
import type { LayoutMetrics } from "../render/layout-engine";
import type { LeadName } from "../render/layout";
import styles from "./EcgDisplay.module.css";
import { LeadStrip } from "./LeadStrip";

export interface EcgDisplayProps {
  containerRef: (element: HTMLElement | null) => void;
  leads: readonly LeadName[];
  metrics: LayoutMetrics;
  widthPx: number;
  registerTrace: (lead: LeadName, element: HTMLCanvasElement | null) => void;
  registerGrid: (lead: LeadName, element: HTMLCanvasElement | null) => void;
}

export function EcgDisplay({
  containerRef,
  leads,
  metrics,
  widthPx,
  registerTrace,
  registerGrid,
}: EcgDisplayProps) {
  return (
    <div className={styles.display} ref={containerRef}>
      {leads.map((lead) => (
        <LeadStrip
          key={lead}
          lead={lead}
          widthPx={widthPx}
          heightPx={metrics.stripHeightPx}
          registerTrace={registerTrace}
          registerGrid={registerGrid}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Ejecutar los tests y verificar**

Run: `cd apps/web && npx vitest run src/ui/hooks/useLayoutMetrics.test.tsx`
Expected: 2 tests PASS.

Run: `cd apps/web && npx tsc -b`
Expected: sin salida.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui/LeadStrip.tsx apps/web/src/ui/LeadStrip.module.css apps/web/src/ui/EcgDisplay.tsx apps/web/src/ui/EcgDisplay.module.css apps/web/src/ui/hooks apps/web/src/test-setup.ts
git commit -m "feat(web): LeadStrip, EcgDisplay y los hooks del renderer

Cada derivacion pasa a tener su propio canvas de rejilla, lo que arregla la
desalineacion del canvas suelto de 800x600 que habia antes y hace cada tira
autonoma.

useLayoutMetrics observa el contenedor con ResizeObserver y lo traduce a
LayoutMetrics. useSweepRenderer es dueno del bucle de rAF, de los anillos y
del repintado completo, que se dispara con los cuatro eventos del spec
(tamano, tema, layout, viewportScale) y nunca desde rAF.

test-setup gana un doble de ResizeObserver: jsdom no lo implementa."
```

---

### Task 13: Integrar ECGWorkspace y blindar el contrato de accesibilidad

La tarea que hace visible todo lo anterior. `ECGWorkspace` pasa de 230 líneas haciéndolo todo a orquestar y nada más.

**Files:**
- Modify: `apps/web/src/ui/ECGWorkspace.tsx` (reescritura)
- Modify: `apps/web/src/ui/ECGWorkspace.test.tsx`
- Modify: `apps/web/src/ui/BasicControlPanel.tsx`
- Modify: `apps/web/src/ui/LayoutPicker.tsx`
- Modify: `apps/web/src/ui/RhythmSelector.tsx`
- Modify: `apps/web/src/ui/AdvancedControlPanel.tsx`
- Modify: `apps/web/src/ui/HeartRateControl.tsx`
- Modify: `apps/web/src/main.tsx`
- Test: `apps/web/src/ui/accessibility-contract.test.tsx` (nuevo)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la aplicación completa.

- [ ] **Step 1: Cargar el CSS de tokens**

`apps/web/src/main.tsx` — añadir la importación del artefacto antes del render. Sin esto ninguna custom property existe y todos los componentes salen sin estilo:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@ui-system/tokens/tokens.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 2: Escribir el test de contrato de accesibilidad**

`apps/web/src/ui/accessibility-contract.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ECGWorkspace } from "./ECGWorkspace";
import { LEAD_ORDER } from "../render/layout";

/** Nombres accesibles de los que dependen tests unitarios, el e2e de Playwright
 * o ambos. Convierte en verificable la regla del §12 del spec: el rediseño es
 * visual y el árbol de accesibilidad se conserva.
 *
 * Si una pieza nueva obliga a cambiar uno de estos nombres, se cambia aquí de
 * forma explícita y se justifica en el commit. Nunca por accidente. */
const REQUIRED_LABELS = [
  "Seleccionar ritmo", // lo usa tambien el e2e de Playwright
  "Derivaciones visibles",
];

const RHYTHM_SUMMARY = {
  rhythm_id: "sinus_normal",
  display_name: "Sinusal normal",
  category: "sinus",
  ventricular_rate_hz: 1.1667,
  pr_is_measurable: true,
};
const RHYTHM_DETAIL = {
  ...RHYTHM_SUMMARY,
  default_parameters: { heart_rate_hz: 1.1667 },
  editable_parameters: { heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 } },
  clinical_description: "...",
  references: [],
  allowed_overlays: [],
};

class SilentSocket {
  static OPEN = 1;
  readyState = 1;
  binaryType = "blob";
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

function renderWorkspace() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.endsWith("/api/rhythms") ? [RHYTHM_SUMMARY] : RHYTHM_DETAIL),
      })
    )
  );
  return render(
    <ECGWorkspace
      wsUrl="ws://test"
      apiBaseUrl="http://api.test"
      webSocketFactory={() => new SilentSocket() as unknown as WebSocket}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contrato de accesibilidad", () => {
  it("conserva todos los nombres accesibles vigentes", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    for (const label of REQUIRED_LABELS) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });

  it("conserva el data-testid de cada derivacion visible", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    // Layout por defecto: 6 derivaciones.
    for (const lead of ["I", "II", "III", "aVR", "aVL", "aVF"]) {
      expect(screen.getByTestId(`lead-canvas-${lead}`), lead).toBeInTheDocument();
    }
  });

  it("en layout de 12 aparecen las doce, con su testid", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    await userEvent.click(screen.getByRole("radio", { name: "12" }));

    for (const lead of LEAD_ORDER) {
      expect(screen.getByTestId(`lead-canvas-${lead}`), lead).toBeInTheDocument();
    }
  });

  it("conserva los nombres de los controles de frecuencia y ruido tras elegir ritmo", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByText("Sinusal normal"));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");

    expect(screen.getByRole("button", { name: "Bajar frecuencia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir frecuencia" })).toBeInTheDocument();
    expect(screen.getByLabelText("Calidad de señal")).toBeInTheDocument();
  });

  it("conserva los nombres de los sliders del panel avanzado", async () => {
    renderWorkspace();
    await waitFor(() => screen.getByText("Sinusal normal"));
    await userEvent.selectOptions(screen.getByLabelText("Seleccionar ritmo"), "sinus_normal");
    await userEvent.selectOptions(screen.getByLabelText("Calidad de señal"), "personalizada");

    for (const label of ["EMG", "Interferencia 50Hz", "Línea base", "Movimiento", "Saturación"]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Volver a modo básico" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `cd apps/web && npx vitest run src/ui/accessibility-contract.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Derivaciones visibles` no falla todavía (existe), pero sí falla el test de 12 derivaciones porque `getByRole("radio", { name: "12" })` aún no existe con ese nombre en el `LayoutPicker` sin estilo. Anotar el fallo real que aparezca.

- [ ] **Step 4: Migrar los controles al ui-system**

`apps/web/src/ui/LayoutPicker.tsx` — reemplazar el fichero completo. El `role="radiogroup"` y el nombre `"Derivaciones visibles"` los aporta ahora `SegmentedControl`:

```tsx
import { SegmentedControl } from "@ui-system/components/controls/index";
import type { LayoutId } from "../render/layout";

const OPTIONS: Array<{ value: LayoutId; label: string }> = [
  { value: "1", label: "1" },
  { value: "3", label: "3" },
  { value: "6", label: "6" },
  { value: "12", label: "12" },
];

export interface LayoutPickerProps {
  value: LayoutId;
  onChange: (layout: LayoutId) => void;
}

export function LayoutPicker({ value, onChange }: LayoutPickerProps) {
  return (
    <SegmentedControl
      label="Derivaciones visibles"
      value={value}
      options={OPTIONS}
      onChange={onChange}
    />
  );
}
```

`apps/web/src/ui/RhythmSelector.tsx` — sustituir el `<select>` crudo por `Select`, conservando el `aria-label` exacto. Cambiar solo el `return` final:

```tsx
  return (
    <>
      <Select
        label="Seleccionar ritmo"
        value={selectedRhythmId ?? ""}
        placeholder="Selecciona un ritmo"
        options={rhythms.map((rhythm) => ({
          value: rhythm.rhythm_id,
          label: rhythm.display_name,
        }))}
        onChange={(rhythmId) => void handleChange(rhythmId)}
      />
      {selectError && (
        <p role="alert">No se pudo cargar el detalle del ritmo: {selectError}</p>
      )}
    </>
  );
```

Y añadir arriba: `import { Select } from "@ui-system/components/controls/index";`

`apps/web/src/ui/HeartRateControl.tsx` — sustituir el `return` por un `Stepper`, conservando los dos nombres de botón:

```tsx
  return (
    <Stepper
      label="Frecuencia"
      value={`${bpm} lpm${isFixed ? " (fija)" : ""}`}
      decrementLabel="Bajar frecuencia"
      incrementLabel="Subir frecuencia"
      disabled={isFixed}
      onDecrement={() => step(-STEP_BPM)}
      onIncrement={() => step(STEP_BPM)}
    />
  );
```

Y añadir arriba: `import { Stepper } from "@ui-system/components/controls/index";`

`apps/web/src/ui/BasicControlPanel.tsx` — envolver en `ControlGroup` y usar `Select`, conservando `"Calidad de señal"`:

```tsx
import { ControlGroup } from "@ui-system/components/surface/index";
import { Select } from "@ui-system/components/controls/index";
import { HeartRateControl } from "./HeartRateControl";
import { NOISE_PRESETS, PRESET_LABELS, matchPreset, type ConcretePresetId, type PresetId } from "./noise-presets";
import type { NoiseParamsPayload } from "../types/engine-params";

export interface BasicControlPanelProps {
  heartRateHz: number;
  heartRateRange: { minimum: number; maximum: number };
  noise: NoiseParamsPayload;
  onHeartRateChange: (hz: number) => void;
  onNoiseChange: (noise: NoiseParamsPayload) => void;
  onSwitchToAdvanced: () => void;
}

export function BasicControlPanel(props: BasicControlPanelProps) {
  const currentPreset = matchPreset(props.noise);

  const handlePresetChange = (preset: PresetId) => {
    if (preset === "personalizada") {
      props.onSwitchToAdvanced();
      return;
    }
    props.onNoiseChange(NOISE_PRESETS[preset as ConcretePresetId]);
  };

  return (
    <>
      <ControlGroup label="Ritmo">
        <HeartRateControl
          range={props.heartRateRange}
          valueHz={props.heartRateHz}
          onChange={props.onHeartRateChange}
        />
      </ControlGroup>
      <ControlGroup label="Señal">
        <Select
          label="Calidad de señal"
          value={currentPreset}
          options={(Object.keys(PRESET_LABELS) as PresetId[]).map((id) => ({
            value: id,
            label: PRESET_LABELS[id],
          }))}
          onChange={(value) => handlePresetChange(value as PresetId)}
        />
      </ControlGroup>
    </>
  );
}
```

`apps/web/src/ui/AdvancedControlPanel.tsx` — sustituir el `fieldset` por `ControlGroup` y los `NoiseSlider` por `Slider`, borrando la función local `NoiseSlider`. Reemplazar el `return` y quitar el helper:

```tsx
  return (
    <ControlGroup label="Ruido (avanzado)">
      <Slider label="EMG" value={noise.emg_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("emg_v", v)} />
      <Slider label="Interferencia 50Hz" value={noise.mains_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("mains_v", v)} />
      <Slider label="Línea base" value={noise.baseline_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("baseline_v", v)} />
      <Slider label="Movimiento" value={noise.motion_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("motion_v", v)} />
      {/* El extremo izquierdo (0) significa "sin saturación" (`clip_v: null`),
          no "recortar a amplitud cero" — sin este mapeo, arrastrar el slider y
          devolverlo a la izquierda dejaba `clip_v: 0`, que aplana el trazo
          entero a una línea recta sin forma de deshacerlo desde este panel. */}
      <Slider label="Saturación" value={noise.clip_v ?? 0} min={0} max={CLIP_MAX_V} step={CLIP_STEP_V}
        onChange={(v) => setField("clip_v", v === 0 ? null : v)} />
      <button type="button" onClick={onSwitchToBasic}>
        Volver a modo básico
      </button>
    </ControlGroup>
  );
```

Y las importaciones nuevas: `import { ControlGroup } from "@ui-system/components/surface/index";` y `import { Slider } from "@ui-system/components/controls/index";`

- [ ] **Step 5: Reescribir ECGWorkspace**

`apps/web/src/ui/ECGWorkspace.tsx` — reemplazar el fichero completo:

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  Badge,
  Header,
  Inspector,
  Metric,
  MetricGrid,
  Panel,
  SectionTitle,
  SegmentedControl,
  Sidebar,
  StatusBar,
  Tooltip,
} from "@ui-system";
import { getTheme, setTheme, type ThemeName } from "@ui-system/themes/index";
import { SessionRuntime } from "../simulation-runtime/session-runtime";
import { CatalogClient } from "../simulation-runtime/catalog-client";
import { useSessionStore } from "../state/session-store";
import { RhythmSelector } from "./RhythmSelector";
import { LayoutPicker } from "./LayoutPicker";
import { BasicControlPanel } from "./BasicControlPanel";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import { EcgDisplay } from "./EcgDisplay";
import { useLayoutMetrics } from "./hooks/useLayoutMetrics";
import { useSimulationRuntime } from "./hooks/useSimulationRuntime";
import { useSweepRenderer } from "./hooks/useSweepRenderer";
import { leadsForLayout, type LayoutId } from "../render/layout";
import type { Compression } from "../render/layout-engine";
import type { RhythmDetail } from "../types/rhythms";

const DEFAULT_VARIABILITY = {
  respiration_hz: 0.25,
  rsa_fraction: 0.04,
  amplitude_fraction: 0.03,
  rr_jitter_fraction: 0.015,
};
const SILENT_NOISE = { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null };
const DEFAULT_SAMPLE_RATE_HZ = 500;
const PAPER_SPEED_MM_S = 25;
const GAIN_MM_PER_MV = 10;

const THEME_OPTIONS: Array<{ value: ThemeName; label: string }> = [
  { value: "dark", label: "Monitor" },
  { value: "light", label: "Papel" },
];

/** El indicador es clínico, no técnico: en pantalla no aparece nunca un
 * "46 px/tira", porque ni el médico ni el alumno saben qué hacer con ese
 * número. La explicación va en el tooltip. */
const COMPRESSION_LABEL: Record<Compression, string> = {
  normal: "Normal",
  compact: "Vista compacta",
  "very-compact": "Vista muy compacta",
};
const COMPRESSION_TONE = {
  normal: "ok",
  compact: "warning",
  "very-compact": "critical",
} as const;
const COMPRESSION_HINT =
  "Altura disponible insuficiente para la representación óptima de 12 derivaciones.";

export interface ECGWorkspaceProps {
  wsUrl: string;
  apiBaseUrl: string;
  webSocketFactory?: (url: string) => WebSocket;
}

export function ECGWorkspace({ wsUrl, apiBaseUrl, webSocketFactory }: ECGWorkspaceProps) {
  const runtime = useMemo(
    () => new SessionRuntime(wsUrl, webSocketFactory),
    [wsUrl, webSocketFactory]
  );
  const catalogClient = useMemo(() => new CatalogClient({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  const store = useSessionStore();

  const [selectedRhythm, setSelectedRhythm] = useState<RhythmDetail | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [layout, setLayout] = useState<LayoutId>("6");
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const leads = useMemo(() => leadsForLayout(layout), [layout]);
  const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
  const theme = getTheme(themeName);

  useSimulationRuntime(runtime);

  const { containerRef, metrics, widthPx } = useLayoutMetrics({
    leadCount: leads.length,
    clinicalGainMmPerMv: GAIN_MM_PER_MV,
    paperSpeedMmS: PAPER_SPEED_MM_S,
  });

  const { registerTrace, registerGrid, isAwaitingSignal } = useSweepRenderer({
    runtime,
    leads,
    sampleRateHz,
    metrics,
    widthPx,
    theme,
  });

  // El CSS toma su juego de custom properties del atributo del elemento raíz.
  useEffect(() => {
    setTheme(themeName);
  }, [themeName]);

  useEffect(() => {
    if (store.connectionState === "connected" || store.connectionState === "running") {
      setHasConnectedOnce(true);
    }
  }, [store.connectionState]);

  const handleRhythmSelect = (rhythmId: string, detail: RhythmDetail) => {
    setSelectedRhythm(detail);
    store.selectRhythm(rhythmId);
    runtime.start(rhythmId, {
      heart_rate_hz: detail.default_parameters.heart_rate_hz,
      noise: SILENT_NOISE,
      variability: DEFAULT_VARIABILITY,
    });
  };

  const currentParams =
    store.params ??
    (selectedRhythm
      ? {
          heart_rate_hz: selectedRhythm.default_parameters.heart_rate_hz,
          noise: SILENT_NOISE,
          variability: DEFAULT_VARIABILITY,
        }
      : null);

  const bpm = currentParams ? Math.round(currentParams.heart_rate_hz * 60) : null;

  return (
    <AppShell
      header={
        <Header title="Simulador de electrocardiograma">
          <SegmentedControl
            label="Derivaciones visibles"
            value={layout}
            options={[
              { value: "1", label: "1" },
              { value: "3", label: "3" },
              { value: "6", label: "6" },
              { value: "12", label: "12" },
            ]}
            onChange={setLayout}
          />
          <SegmentedControl
            label="Aspecto"
            value={themeName}
            options={THEME_OPTIONS}
            onChange={setThemeName}
          />
        </Header>
      }
      sidebar={
        <Panel>
          <SectionTitle>Paciente</SectionTitle>
          <RhythmSelector
            catalogClient={catalogClient}
            selectedRhythmId={store.selectedRhythmId}
            onSelect={handleRhythmSelect}
          />
          {selectedRhythm && currentParams && (
            advancedMode ? (
              <AdvancedControlPanel
                noise={currentParams.noise}
                onChange={(noise) => runtime.update({ ...currentParams, noise })}
                onSwitchToBasic={() => setAdvancedMode(false)}
              />
            ) : (
              <BasicControlPanel
                heartRateHz={currentParams.heart_rate_hz}
                heartRateRange={selectedRhythm.editable_parameters.heart_rate_hz}
                noise={currentParams.noise}
                onHeartRateChange={(hz) => runtime.update({ ...currentParams, heart_rate_hz: hz })}
                onNoiseChange={(noise) => runtime.update({ ...currentParams, noise })}
                onSwitchToAdvanced={() => setAdvancedMode(true)}
              />
            )
          )}
        </Panel>
      }
      ecg={
        <EcgDisplay
          containerRef={containerRef}
          leads={leads}
          metrics={metrics}
          widthPx={widthPx}
          registerTrace={registerTrace}
          registerGrid={registerGrid}
        />
      }
      inspector={
        <Panel>
          <SectionTitle>Información</SectionTitle>
          {store.lastError && (
            <p role="alert">
              {store.lastError.code}: {store.lastError.detail}
            </p>
          )}
          {hasConnectedOnce && store.connectionState === "idle" && (
            <p role="status">Desconectado</p>
          )}
          {isAwaitingSignal && store.connectionState === "running" && (
            <p role="status">Esperando señal…</p>
          )}
          <MetricGrid>
            <Metric
              label="Ritmo"
              value={selectedRhythm?.display_name ?? ""}
              unavailable={!selectedRhythm}
            />
            <Metric label="FC" value={bpm === null ? "" : String(bpm)} unit="lpm" unavailable={bpm === null} />
            {/* PR, QRS, QT y RR llegan en la Entrega 2: el motor los calcula en
                measurements.py pero la API todavía no los expone. El hueco se
                deja visible a propósito. */}
            <Metric label="PR" value="" unavailable />
            <Metric label="QRS" value="" unavailable />
            <Metric label="QT" value="" unavailable />
            <Metric label="RR" value="" unavailable />
          </MetricGrid>
        </Panel>
      }
      status={
        <StatusBar>
          <span>{store.connectionState}</span>
          <span>{sampleRateHz} Hz</span>
          <span>{GAIN_MM_PER_MV} mm/mV</span>
          <span>{PAPER_SPEED_MM_S} mm/s</span>
          <span>Frames perdidos {store.framesLost}</span>
          <Tooltip content={COMPRESSION_HINT}>
            <Badge tone={COMPRESSION_TONE[metrics.compression]}>
              {COMPRESSION_LABEL[metrics.compression]}
            </Badge>
          </Tooltip>
        </StatusBar>
      }
    />
  );
}
```

Nótese que `LayoutPicker` deja de usarse aquí: el selector de derivaciones vive ahora en el `Header`. El fichero se conserva porque su test propio sigue siendo válido y documenta el componente.

- [ ] **Step 6: Adaptar el mock de canvas del test existente**

`apps/web/src/ui/ECGWorkspace.test.tsx` — el `makeMockCtx()` de la línea 54 no tiene `fillRect` ni `fillStyle`, y el nuevo `drawGrid` los usa: sin esto los 7 tests revientan con `ctx.fillRect is not a function`. Reemplazar la interfaz y la fábrica:

```tsx
interface MockCtx {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  canvas: { width: number };
}

function makeMockCtx(): MockCtx {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    canvas: { width: 800 },
  };
}
```

Además, ahora cada tira tiene **dos** canvas y el `data-testid` está en el de trazo, así que `screen.getByTestId("lead-canvas-II")` sigue devolviendo el canvas correcto sin cambios. Si algún test falla porque el contexto del canvas de rejilla se mezcla con el del trazo, comprobar que el mapa `canvasContexts` indexa por elemento y no por índice.

- [ ] **Step 7: Ejecutar toda la suite**

Run: `cd apps/web && npx tsc -b && npx vitest run`
Expected: tsc sin salida; 181 tests PASS (176 previos + 5 del contrato de accesibilidad).

Si algún test de `ECGWorkspace.test.tsx` falla por el tamaño de los canvas (en jsdom el `ResizeObserver` es un doble y no dispara, así que las métricas se quedan en el respaldo de 800x600), comprobar que el respaldo de `useLayoutMetrics` da una altura de tira dibujable — con 6 derivaciones y 600px son 96px, dentro de la banda normal.

- [ ] **Step 8: Verificar en el navegador**

Run: `npm run dev` desde `apps/web`, abrir `http://localhost:5173` con el backend arriba (`arrancar.bat` levanta los dos).

Comprobar a ojo:
- Las cinco zonas están donde el spec dice y nada scrollea en el área de ECG.
- Con 12 derivaciones caben todas sin barra de scroll.
- El trazo es verde sobre fondo oscuro; la rejilla está alineada con cada tira.
- Cambiar a "Papel" invierte el aspecto **y el trazo ya dibujado se repinta**, no se queda del color viejo.
- Redimensionar la ventana no deja el ECG en blanco.
- El indicador de la barra de estado cambia de Normal a Vista compacta al reducir el alto de la ventana con 12 derivaciones.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): integrar la shell clinica y blindar el contrato de accesibilidad

ECGWorkspace pasa de 230 lineas haciendolo todo a orquestar y nada mas: el
ciclo de vida del runtime, las metricas de layout y el bucle de dibujo viven
en hooks, y las tiras en EcgDisplay/LeadStrip.

Los controles pasan al ui-system conservando cada nombre accesible exacto, y
un test nuevo los enumera para que la regla del spec sea verificable en vez de
una buena intencion. El makeMockCtx del test existente gana fillRect/fillStyle,
que el nuevo drawGrid necesita.

El Inspector deja PR/QRS/QT/RR como huecos declarados: el motor los calcula
pero la API no los expone hasta la Entrega 2."
```

---

## Auto-revisión

**Cobertura del spec.** Cada sección tiene tarea: §2 principio rector → Tasks 1, 2, 5, 6 (y el test de tema centinela lo verifica); §3 estructura del paquete → Task 1; §4 theme engine → Task 2; §5 cadena de escalas → Task 3; §6 LayoutEngine y reparto → Tasks 3 y 12; §7 shell de cinco zonas → Task 11; §8 los 18 componentes → Tasks 8, 9, 10, 11; §9 renderer → Tasks 5 y 6; §10 continuidad y repintado → Tasks 4 y 7; §11 descomposición de ECGWorkspace → Tasks 12 y 13; §12 contrato de migración → Task 13; §13 testing → repartido, con el tema centinela en Task 6, la equivalencia en Task 7 y el contrato en Task 13.

**Hueco encontrado y cubierto.** El spec §6 promete un indicador de compresión pero no dice dónde vive; queda en la barra de estado (Task 13), con `Badge` + `Tooltip`.

**Discrepancia con el spec.** El `clamp(52, …, 140)` del §6 contradice el "mínimo blando" del párrafo siguiente. El plan implementa el mínimo blando —que es lo que el spec quiere— y la corrección queda anotada arriba, en su propia sección. Hay que arreglar esa línea del spec al cerrar la entrega.

**Consistencia de nombres.** `LayoutMetrics` con los mismos seis campos en Tasks 3, 5, 6, 7, 12 y 13. `LeadCanvasOptions` como `{ metrics, theme }` en Tasks 6, 7 y 12. `sweepCapacitySamples(widthPx, pixelsPerSecond, sampleRateHz)` igual en Tasks 4 y 12. `Tone` definido en `Metric` (Task 9) y reutilizado por `Badge`. `registerTrace`/`registerGrid` con la misma firma en Tasks 12 y 13.

**Riesgo identificado.** El primer test de la Task 7 (equivalencia incremental ↔ repintado) es el más frágil del plan: compara conjuntos de uniones entre dos rutas de dibujo distintas. Si falla, la instrucción es depurar la condición de levantar el lápiz del `SweepRebuilder`, no relajar el test — es la red que impide que un redimensionado deshaga el arreglo I-3.

