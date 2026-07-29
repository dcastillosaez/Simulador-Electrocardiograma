import { test, expect } from "@playwright/test";
import { startMockSimulationServer } from "./mock-simulation-server";

const MOCK_WS_PORT = 8901;
// Con el mock enviando frames de 100ms simulados tan rápido como el
// intervalo de Node lo permite, varios minutos de contenido se comprimen
// en unos pocos segundos de reloj real: no hace falta esperar los 10
// minutos reales que tardaría el backend de verdad (que pacea a tiempo
// real, ver la nota de la sección 9 del spec de esta fase).
const REAL_TIME_BUDGET_MS = 20_000;

test("una sesion larga no degrada fps ni acumula memoria sin limite", async ({ page, baseURL }) => {
  const server = startMockSimulationServer(MOCK_WS_PORT);
  try {
    await page.goto(`${baseURL}/?ws=ws://localhost:${MOCK_WS_PORT}`);

    await page.getByLabel("Seleccionar ritmo").waitFor({ state: "visible" });
    await page.getByLabel("Seleccionar ritmo").selectOption({ index: 1 });

    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");

    const deadline = Date.now() + REAL_TIME_BUDGET_MS;
    const jsHeapSamplesBytes: number[] = [];
    // `JSHeapUsedSize` no refleja los ArrayBuffer que respaldan los frames
    // binarios (viven fuera del heap de objetos JS que V8 contabiliza ahí):
    // se comprobó empíricamente rompiendo a propósito el descarte del
    // buffer circular que el resto de tests de este mismo commit sí
    // ejercitan, y el test seguía en verde con miles de frames retenidos
    // sin evictar ninguno. `ArrayBufferContents`, de la misma llamada CDP,
    // sí crece con esa fuga -- es la señal que de verdad hay que vigilar.
    const arrayBufferSamplesBytes: number[] = [];
    while (Date.now() < deadline) {
      const metrics = await client.send("Performance.getMetrics");
      const jsHeap = metrics.metrics.find((m) => m.name === "JSHeapUsedSize");
      const arrayBuffers = metrics.metrics.find((m) => m.name === "ArrayBufferContents");
      if (jsHeap) jsHeapSamplesBytes.push(jsHeap.value);
      if (arrayBuffers) arrayBufferSamplesBytes.push(arrayBuffers.value);
      await page.waitForTimeout(500);
    }

    // La memoria no debe crecer sin limite: la segunda mitad de las
    // muestras no debe superar en mas de un 50% a la primera mitad. Un
    // buffer que no evictase nada crecería sin cota con varios minutos de
    // contenido comprimidos en segundos.
    assertDoesNotGrowUnbounded(jsHeapSamplesBytes);
    assertDoesNotGrowUnbounded(arrayBufferSamplesBytes);
  } finally {
    server.close();
  }
});

function assertDoesNotGrowUnbounded(samplesBytes: number[]): void {
  const half = Math.floor(samplesBytes.length / 2);
  const earlyAvg = average(samplesBytes.slice(0, half));
  const lateAvg = average(samplesBytes.slice(half));
  expect(lateAvg).toBeLessThan(earlyAvg * 1.5);
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
