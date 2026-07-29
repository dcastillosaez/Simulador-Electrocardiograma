/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

const uiSystem = fileURLToPath(new URL("../../packages/ui-system", import.meta.url));
const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@ui-system": uiSystem },
  },
  server: {
    fs: {
      // Vite solo sirve/transforma ficheros bajo `server.fs.allow`, que por
      // defecto es la raiz del proyecto (`apps/web`). El repo no tiene
      // lockfile ni package.json con "workspaces" en la raiz (a proposito,
      // ver CLAUDE.md), asi que Vite no puede autodetectar el monorepo y
      // ampliar la lista el solo: sin esto, cualquier test bajo
      // `packages/ui-system` falla con "Failed to load url ... Does the file
      // exist?" aunque el fichero exista. Se listan solo los directorios que
      // hacen falta (no toda la raiz del monorepo) para no exponer el resto
      // de `Simulador_Electrocardiograma/` al servidor de desarrollo.
      allow: [webRoot, uiSystem],
    },
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
