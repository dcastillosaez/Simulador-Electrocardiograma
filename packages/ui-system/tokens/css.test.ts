// @vitest-environment node
//
// Este fichero lee tokens.css del disco con `node:fs` vía
// `new URL("./tokens.css", import.meta.url)`. Bajo el entorno "jsdom" del
// proyecto (ver vite.config.ts), Vite trata los módulos como "web" y el
// plugin `vite:asset-import-meta-url` reescribe ese patrón a una URL de
// servidor de desarrollo en vez de dejarlo como file://. Forzar "node" aquí
// hace que el módulo se cargue en modo SSR real y el patrón se resuelva de
// forma nativa. ui-system no toca el DOM, así que no pierde nada.
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
