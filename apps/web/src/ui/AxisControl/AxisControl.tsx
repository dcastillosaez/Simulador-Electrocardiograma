import { useCallback, useRef } from "react";
import styles from "./AxisControl.module.css";
import { angleFromPoint, HEXAXIAL_LEADS, tipFor } from "./hexaxial";
import { ZONE_LABEL, ZONE_NOTE, zoneFor } from "./axis-zones";

export interface AxisControlProps {
  /** Orientación eléctrica actual, en grados. */
  valueDeg: number;
  min: number;
  max: number;
  /** Orientación de referencia a la que vuelve `Home` (50° por defecto). */
  referenceDeg: number;
  onChange: (deg: number) => void;
}

const STEP = 5;
const CENTER = 100;
const RADIUS = 80;
const VIEWBOX = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function AxisControl({ valueDeg, min, max, referenceDeg, onChange }: AxisControlProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rounded = Math.round(valueDeg);
  const zone = zoneFor(valueDeg);

  const emit = useCallback(
    (next: number) => onChange(clamp(Math.round(next), min, max)),
    [onChange, min, max]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>) => {
      switch (event.key) {
        case "ArrowUp":
        case "ArrowRight":
          event.preventDefault();
          emit(valueDeg + STEP);
          break;
        case "ArrowDown":
        case "ArrowLeft":
          event.preventDefault();
          emit(valueDeg - STEP);
          break;
        case "Home":
          event.preventDefault();
          onChange(clamp(referenceDeg, min, max));
          break;
        default:
          break;
      }
    },
    [emit, valueDeg, referenceDeg, min, max, onChange]
  );

  // Arrastrar la punta: convierte la posición del puntero, en el sistema de
  // coordenadas del SVG, a un ángulo. El teclado sigue siendo el camino
  // primario; el arrastre es una mejora encima.
  const pointerToAngle = useCallback((clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = point.matrixTransform(ctm.inverse());
    return angleFromPoint(CENTER, CENTER, local.x, local.y);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.buttons === 0) return;
      const angle = pointerToAngle(event.clientX, event.clientY);
      if (angle !== null) emit(angle);
    },
    [pointerToAngle, emit]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const angle = pointerToAngle(event.clientX, event.clientY);
      if (angle !== null) emit(angle);
    },
    [pointerToAngle, emit]
  );

  const zoneColor = `var(--axis-${zone})`;

  return (
    <div className={styles.root}>
      <svg
        ref={svgRef}
        className={styles.disk}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width="180"
        height="180"
        role="slider"
        tabIndex={0}
        aria-label="Eje eléctrico"
        aria-valuenow={rounded}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${rounded}°, ${ZONE_LABEL[zone]}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <circle
          className={styles.border}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS + 8}
          fill="none"
          stroke={zoneColor}
          strokeWidth={2}
        />
        {HEXAXIAL_LEADS.map((lead) => {
          const end = tipFor(lead.angleDeg, RADIUS);
          const label = tipFor(lead.angleDeg, RADIUS + 6);
          return (
            <g key={lead.name}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={CENTER + end.x}
                y2={CENTER + end.y}
                stroke="var(--panel-border)"
                strokeWidth={1}
              />
              <text
                className={styles.leadLabel}
                x={CENTER + label.x}
                y={CENTER + label.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {lead.name}
              </text>
            </g>
          );
        })}
        <g className={styles.vector} style={{ transform: `rotate(${valueDeg}deg)` }}>
          <line
            x1={CENTER}
            y1={CENTER}
            x2={CENTER + RADIUS}
            y2={CENTER}
            stroke="var(--ecg-trace)"
            strokeWidth={3}
          />
          <circle cx={CENTER + RADIUS} cy={CENTER} r={6} fill="var(--ecg-trace)" />
        </g>
      </svg>

      <div className={styles.readout}>
        <span className={styles.angle}>{rounded}°</span>
        <span className={styles.zone} style={{ color: zoneColor }}>
          {ZONE_LABEL[zone]}
        </span>
      </div>

      <div className={styles.stepper}>
        <button
          type="button"
          aria-label="Disminuir eje 5 grados"
          onClick={() => emit(valueDeg - STEP)}
        >
          −5°
        </button>
        <button
          type="button"
          aria-label="Aumentar eje 5 grados"
          onClick={() => emit(valueDeg + STEP)}
        >
          +5°
        </button>
      </div>

      <p className={styles.note}>{ZONE_NOTE[zone]}</p>
    </div>
  );
}
