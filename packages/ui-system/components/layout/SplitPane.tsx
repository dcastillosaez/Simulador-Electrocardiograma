import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./SplitPane.module.css";

export interface SplitPaneProps {
  top: ReactNode;
  bottom: ReactNode;
  /** Nombre del separador para lectores de pantalla. Sin él, el divisor se
   * anuncia como "separador" a secas y no hay forma de saber qué separa. */
  label: string;
  defaultTopFraction?: number;
  minTopFraction?: number;
  maxTopFraction?: number;
}

const KEYBOARD_STEP = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Dos zonas apiladas con un divisor arrastrable.
 *
 * Vive en el `ui-system` y no en la app porque no sabe nada de ECG ni de
 * corazones: reparte el alto de su contenedor entre dos hijos, y eso vale
 * igual para el día que haya que partir el inspector.
 *
 * El reparto es una fracción, no píxeles: al redimensionar la ventana, la
 * proporción se conserva sin necesidad de recalcular nada. */
export function SplitPane({
  top,
  bottom,
  label,
  defaultTopFraction = 0.65,
  minTopFraction = 0.3,
  maxTopFraction = 0.85,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(defaultTopFraction);
  const [isDragging, setIsDragging] = useState(false);

  const apply = useCallback(
    (next: number) => setFraction(clamp(next, minTopFraction, maxTopFraction)),
    [minTopFraction, maxTopFraction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height === 0) return;
      apply((event.clientY - rect.top) / rect.height);
    };
    const onUp = () => setIsDragging(false);

    // En `window` y no en el divisor: al arrastrar deprisa el puntero se sale
    // del elemento, y con los listeners colgados de él el arrastre se
    // interrumpiría a mitad.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, apply]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      apply(fraction - KEYBOARD_STEP);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      apply(fraction + KEYBOARD_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      apply(defaultTopFraction);
    }
  };

  const percent = Math.round(fraction * 100);

  return (
    <div
      ref={containerRef}
      className={`${styles.split} ${isDragging ? styles.dragging : ""}`}
    >
      <div className={styles.pane} style={{ flex: `${fraction} 1 0` }}>
        {top}
      </div>

      <div
        className={styles.divider}
        role="separator"
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuenow={percent}
        aria-valuemin={Math.round(minTopFraction * 100)}
        aria-valuemax={Math.round(maxTopFraction * 100)}
        tabIndex={0}
        onPointerDown={() => setIsDragging(true)}
        onKeyDown={onKeyDown}
      />

      <div className={styles.pane} style={{ flex: `${1 - fraction} 1 0` }}>
        {bottom}
      </div>
    </div>
  );
}
