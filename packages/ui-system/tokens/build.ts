import { writeFileSync } from "node:fs";
import { renderTokensCss } from "./css";

// Script, no módulo: se ejecuta con `npm run tokens` (vite-node). La lógica
// vive en css.ts para poder testearla sin efectos secundarios.
writeFileSync(new URL("./tokens.css", import.meta.url), renderTokensCss(), "utf8");
process.stdout.write("tokens.css generado\n");
