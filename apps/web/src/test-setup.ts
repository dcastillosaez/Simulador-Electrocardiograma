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
