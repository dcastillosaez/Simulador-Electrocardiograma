import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** Doble instrumentado: el de `test-setup.ts` no observa nada ni cuenta nada,
 * que basta para que jsdom no reviente pero no permite comprobar el ciclo de
 * vida del observador. */
function spyResizeObserver() {
  const state = {
    observed: [] as Element[],
    disconnects: 0,
    notify: (rect: { width: number; height: number }) => void rect,
  };

  class SpyResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      state.notify = (contentRect) => {
        callback(
          [{ contentRect } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      };
    }
    observe(element: Element): void {
      state.observed.push(element);
    }
    unobserve(): void {}
    disconnect(): void {
      state.disconnects += 1;
    }
  }

  vi.stubGlobal("ResizeObserver", SpyResizeObserver);
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("una medida del contenedor sustituye al respaldo", () => {
    const observer = spyResizeObserver();
    render(<Probe leadCount={12} />);

    act(() => observer.notify({ width: 900, height: 640 }));

    // (640 - 11 huecos de 4px) / 12 = 49,67px: por debajo del minimo blando.
    expect(Number(screen.getByTestId("width").textContent)).toBe(900);
    expect(screen.getByTestId("compression").textContent).toBe("very-compact");
  });

  it("sigue observando tras el doble montaje de StrictMode", () => {
    // La regresion que este test existe para impedir: un `useEffect` de
    // desmontaje que desconecte el observador queda ejecutado por el ciclo
    // monta-limpia-monta de StrictMode, y como los ref callbacks NO se
    // re-ejecutan, nadie vuelve a llamar a `observe()`. El sintoma en el
    // navegador es un ECG congelado en la primera medida que ignora cualquier
    // redimensionado -- invisible para el resto de la suite.
    const observer = spyResizeObserver();
    render(
      <StrictMode>
        <Probe leadCount={6} />
      </StrictMode>
    );

    expect(observer.observed.length).toBeGreaterThan(0);
    expect(observer.disconnects).toBe(0);

    act(() => observer.notify({ width: 800, height: 600 }));
    expect(Number(screen.getByTestId("width").textContent)).toBe(800);
  });
});
