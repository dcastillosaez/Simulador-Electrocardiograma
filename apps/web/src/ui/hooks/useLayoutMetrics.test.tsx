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
