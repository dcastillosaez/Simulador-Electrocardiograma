/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

const uiSystem = fileURLToPath(new URL("../../packages/ui-system", import.meta.url));
const webRoot = fileURLToPath(new URL(".", import.meta.url));
const webModules = fileURLToPath(new URL("./node_modules", import.meta.url));

/** Las dependencias que el ui-system comparte con la app.
 *
 * Vite resuelve un import desnudo subiendo por `node_modules` desde el fichero
 * que lo escribe, y `packages/ui-system` no tiene ninguno: el repo no usa
 * workspaces (a proposito, ver CLAUDE.md), asi que nadie ha creado ahi un
 * arbol de dependencias. Sin estos alias, cualquier componente del paquete
 * falla con "Failed to resolve import 'react'".
 *
 * Se listan una a una en vez de un comodin: el alias es una anulacion de la
 * resolucion normal, y un catch-all se tragaria tambien los imports que hoy
 * resuelven bien. La regla de @rollup/plugin-alias es prefijo con frontera de
 * `/`, asi que "react" cubre "react/jsx-runtime" sin entradas extra. */
const SHARED_DEPS = [
  "react",
  "react-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "@testing-library/jest-dom",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ui-system": uiSystem,
      ...Object.fromEntries(SHARED_DEPS.map((dep) => [dep, `${webModules}/${dep}`])),
    },
  },
  server: {
    // El 5173 por defecto de Vite cae dentro de un rango que Windows reserva
    // para si (5141-5240 en la maquina de desarrollo, via Hyper-V/WSL/Docker):
    // `npm run dev` muere con EACCES antes de llegar a escuchar, y no es algo
    // que Vite pueda esquivar solo. 5600 queda fuera de todos los rangos
    // excluidos. Para ver los de una maquina concreta:
    //   netsh interface ipv4 show excludedportrange protocol=tcp
    port: 5600,
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
