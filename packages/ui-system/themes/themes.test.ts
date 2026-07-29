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
