/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Sin esto, el include por defecto de Vitest (**/*.{test,spec}.*)
    // también recoge tests/e2e/*.spec.ts — las specs de Playwright, que
    // llaman a `test()` de @playwright/test, no de Vitest, y rompen la
    // recolección de tests con "Playwright Test did not expect test() to
    // be called here".
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
