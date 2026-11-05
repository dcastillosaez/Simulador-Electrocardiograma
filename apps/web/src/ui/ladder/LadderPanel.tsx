import { useEffect, useState, type MutableRefObject } from "react";
import type { ElectricalTimeline } from "../../cardiac/electrical-timeline";
import { LADDER_ROWS, ladderOf, type LadderDiagram, type LadderRow } from "../../cardiac/ladder";
import type { PlaybackClock } from "../../cardiac/playback-clock";
import styles from "./LadderPanel.module.css";

/** Segundos de historia que enseña el diagrama. Cuatro dan tres o cuatro
 * latidos a frecuencias normales: bastan para ver un Wenckebach entero. */
const WINDOW_S = 4;

/** Cada cuánto se rehace. Fuera del camino caliente: es React y SVG, y a
 * cuatro veces por segundo el diagrama sigue al trazado sin coste. */
const REFRESH_MS = 250;

const WIDTH = 300;
const ROW_Y: Record<LadderRow, [number, number]> = {
  A: [4, 18],
  AV: [22, 44],
  V: [48, 62],
};

function Diagram({ diagram, label }: { diagram: LadderDiagram; label: string }) {
  const x = (s: number) => (s / diagram.spanS) * WIDTH;
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>{label}</figcaption>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH + 18} 66`}
        role="img"
        aria-label={`Diagrama en escalera: ${label}`}
      >
        {LADDER_ROWS.map((row) => (
          <g key={row}>
            <text x={WIDTH + 4} y={(ROW_Y[row][0] + ROW_Y[row][1]) / 2 + 3} className={styles.rowLabel}>
              {row}
            </text>
            <line x1={0} x2={WIDTH} y1={ROW_Y[row][1]} y2={ROW_Y[row][1]} className={styles.rowLine} />
          </g>
        ))}
        {diagram.bars.map((bar, index) => {
          const [top, bottom] = ROW_Y[bar.row];
          const className = `${styles.bar} ${styles[bar.origin]}`;
          if (bar.row === "AV") {
            // La unión se dibuja como una línea inclinada: el retraso del nodo
            // AV se ve como pendiente. Un bloqueo se queda a media altura.
            const end = bar.blocked ? top + (bottom - top) / 2 : bottom;
            return (
              <g key={index} className={className}>
                <line x1={x(bar.startS)} y1={top} x2={x(bar.endS)} y2={end} />
                {bar.blocked && (
                  <line x1={x(bar.endS) - 3} y1={end} x2={x(bar.endS) + 3} y2={end} />
                )}
              </g>
            );
          }
          return (
            <rect
              key={index}
              className={className}
              x={x(bar.startS)}
              y={top}
              width={Math.max(1, x(bar.endS) - x(bar.startS))}
              height={bottom - top}
            />
          );
        })}
      </svg>
    </figure>
  );
}

export interface LadderPanelProps {
  electrical: MutableRefObject<ElectricalTimeline>;
  clock: PlaybackClock;
  /** Cómo se llama lo que se está viendo, para rotular el diagrama fijado. */
  label: string;
}

/** El diagrama en escalera de los últimos segundos, y uno fijado para
 * comparar.
 *
 * Comparar ritmos es fijar el diagrama de uno, cambiar de ritmo y ver los dos
 * uno encima del otro: la P que no conduce de un Mobitz junto a la conducción
 * 1:1 de un sinusal, o las dos secuencias independientes de un bloqueo
 * completo. Los dos salen de la misma cuenta sobre los tramos del servidor. */
export function LadderPanel({ electrical, clock, label }: LadderPanelProps) {
  const [live, setLive] = useState<LadderDiagram | null>(null);
  const [pinned, setPinned] = useState<{ label: string; diagram: LadderDiagram } | null>(null);

  useEffect(() => {
    const refresh = () => {
      const tS = clock.timeS;
      if (tS === null) return;
      const t0 = tS - WINDOW_S;
      setLive(ladderOf(electrical.current.impulsesBetween(t0, tS), t0, tS));
    };
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [electrical, clock]);

  return (
    <div className={styles.panel}>
      {pinned && <Diagram diagram={pinned.diagram} label={`Fijado: ${pinned.label}`} />}
      {live && <Diagram diagram={live} label={`Ahora: ${label}`} />}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() => live && setPinned({ label, diagram: live })}
          disabled={!live}
        >
          Fijar para comparar
        </button>
        {pinned && (
          <button type="button" onClick={() => setPinned(null)}>
            Quitar la comparación
          </button>
        )}
      </div>
    </div>
  );
}
