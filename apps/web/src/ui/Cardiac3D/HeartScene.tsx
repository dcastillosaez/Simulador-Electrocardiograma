import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SegmentedControl, Slider } from "@ui-system";
import { HEART_GROUPS, type HeartGroup } from "./heart-appearance";
import {
  CUT_AXIS_LABELS,
  CUT_AXIS_ORDER,
  DEFAULT_CUT_POSITION,
  MAX_CUT_POSITION,
  MIN_CUT_POSITION,
  type ActiveCut,
  type CutAxis,
} from "./heart-cut";
import {
  CAMERA_FOV_DEG,
  CAMERA_PRESETS,
  CAMERA_UP,
  DEFAULT_PRESET,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  presetPosition,
  type CameraPreset,
} from "./HeartCamera";
import { HeartModel } from "./HeartModel";
import { HEART_VALVES, VALVE_ORDER } from "./heart-valves";
import { ScaleBar } from "./ScaleBar";
import {
  NO_CYCLE_LABEL,
  ValveReadout,
  apertureLabel,
  type ValveHandles,
} from "./ValveReadout";
import { useCardiacTimeline } from "./useCardiacTimeline";
import { RESTING_APERTURE } from "../../cardiac/valve-timeline";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import styles from "./HeartScene.module.css";

const PRESET_LABELS: Record<CameraPreset, string> = {
  anterior: "Anterior",
  posterior: "Posterior",
  left: "Izq.",
  right: "Der.",
  superior: "Sup.",
  inferior: "Inf.",
};

const PRESET_OPTIONS = (Object.keys(CAMERA_PRESETS) as CameraPreset[]).map(
  (value) => ({ value, label: PRESET_LABELS[value] })
);

const GROUP_LABELS: Record<HeartGroup, string> = {
  ventricles: "Ventrículos",
  atria: "Aurículas",
  vessels: "Grandes vasos",
  myocardium: "Miocardio",
  valves: "Válvulas",
};

/** Enciende el recorte local del renderizador.
 *
 * Va aquí y no en las propiedades del `Canvas` porque es un ajuste del
 * renderizador y no del material: sin él, los `clippingPlanes` que llevan los
 * materiales se ignoran en silencio y el corte simplemente no ocurre. */
function LocalClipping() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
    return () => {
      gl.localClippingEnabled = false;
    };
  }, [gl]);
  return null;
}

export interface HeartSceneProps {
  runtime: SessionRuntime;
}

export function HeartScene({ runtime }: HeartSceneProps) {
  const { timeline, valves, heartState } = useCardiacTimeline(runtime);
  const [preset, setPreset] = useState<CameraPreset>(DEFAULT_PRESET);
  const [isolated, setIsolated] = useState<ReadonlySet<HeartGroup>>(new Set());
  const [opacity, setOpacity] = useState(1);
  const [myocardium, setMyocardium] = useState(false);
  // Un corte por eje, cada uno con su profundidad. `null` es apagado.
  const [cuts, setCuts] = useState<Record<CutAxis, number | null>>({
    coronal: null,
    transversal: null,
    sagittal: null,
  });

  const toggleCut = useCallback((axis: CutAxis) => {
    setCuts((current) => ({
      ...current,
      [axis]: current[axis] === null ? DEFAULT_CUT_POSITION : null,
    }));
  }, []);

  const moveCut = useCallback((axis: CutAxis, position: number) => {
    setCuts((current) => ({ ...current, [axis]: position }));
  }, []);

  // La lista que baja al modelo. Se memoiza porque `HeartModel` la usa como
  // dependencia para decidir si hay que recompilar los materiales.
  const activeCuts: ActiveCut[] = useMemo(
    () =>
      CUT_AXIS_ORDER.filter((axis) => cuts[axis] !== null).map((axis) => ({
        axis,
        position: cuts[axis] as number,
      })),
    [cuts]
  );
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const scaleLabelRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const valveHandles = useRef<ValveHandles>({});

  // Las devoluciones de llamada que enganchan cada fila del panel con su
  // hueco. Memoizadas por dos: React llama a una `ref` con `null` y luego con
  // el elemento cada vez que la función cambia de identidad, y con una función
  // nueva por renderizado el panel se desengancharía al mover cualquier mando.
  const registerValve = useMemo(
    () =>
      Object.fromEntries(
        VALVE_ORDER.map((valve) => [
          valve,
          {
            fill: (element: HTMLSpanElement | null) => {
              (valveHandles.current[valve] ??= { fill: null, state: null }).fill =
                element;
            },
            state: (element: HTMLSpanElement | null) => {
              (valveHandles.current[valve] ??= { fill: null, state: null }).state =
                element;
            },
          },
        ])
      ),
    []
  );

  const toggleGroup = useCallback((group: HeartGroup) => {
    setIsolated((current) => {
      const next = new Set(current);
      if (!next.delete(group)) next.add(group);
      return next;
    });
  }, []);

  return (
    <section className={styles.scene} aria-label="Corazón 3D">
      <div className={styles.presets}>
        <SegmentedControl
          label="Vista"
          value={preset}
          options={PRESET_OPTIONS}
          onChange={setPreset}
        />
      </div>

      {/* Aislamiento y opacidad. Botones de dos estados y no un
          `SegmentedControl`: los grupos se combinan —ventrículos *y*
          aurículas— y un radiogroup solo deja elegir uno.

          Ninguno pulsado enseña el corazón entero. Lo que se aparta no
          desaparece: se queda como un fantasma, porque una cámara aislada
          flotando en el vacío pierde la referencia de dónde estaba. */}
      <div className={styles.layers}>
        <div className={styles.groups} role="group" aria-label="Aislar estructuras">
          {HEART_GROUPS.map((group) => (
            <button
              key={group}
              type="button"
              className={`${styles.group} ${isolated.has(group) ? styles.groupActive : ""}`}
              aria-pressed={isolated.has(group)}
              onClick={() => toggleGroup(group)}
            >
              {GROUP_LABELS[group]}
            </button>
          ))}
        </div>
        {/* El miocardio aparte de los grupos de aislar: no es una alternativa
            a las cámaras sino una capa que las envuelve, y encenderla tiene
            que ser deliberado porque es geometría sintetizada. */}
        <div className={styles.groups}>
          <button
            type="button"
            className={`${styles.group} ${myocardium ? styles.groupActive : ""}`}
            aria-pressed={myocardium}
            onClick={() => setMyocardium((on) => !on)}
          >
            Miocardio
          </button>
        </div>
        {/* Los tres planos son combinables, no alternativas: Three.js conserva
            la geometría que está del lado bueno de todos, así que dos abren
            una esquina y tres un octante. */}
        <div className={styles.groups} role="group" aria-label="Planos de corte">
          {CUT_AXIS_ORDER.map((axis) => (
            <button
              key={axis}
              type="button"
              className={`${styles.group} ${cuts[axis] !== null ? styles.groupActive : ""}`}
              aria-pressed={cuts[axis] !== null}
              onClick={() => toggleCut(axis)}
            >
              {CUT_AXIS_LABELS[axis]}
            </button>
          ))}
        </div>
        {/* `key` en todos: estos aparecen y desaparecen, y sin clave React
            reutiliza la instancia del hermano al reconciliar. El síntoma es
            que mover un mando cambia el valor de otro. */}
        {CUT_AXIS_ORDER.filter((axis) => cuts[axis] !== null).map((axis) => (
          <Slider
            key={`cut-${axis}`}
            label={CUT_AXIS_LABELS[axis]}
            value={cuts[axis] as number}
            min={MIN_CUT_POSITION}
            max={MAX_CUT_POSITION}
            step={0.01}
            onChange={(value) => moveCut(axis, value)}
          />
        ))}
        <Slider
          key="opacity"
          label="Opacidad"
          value={opacity}
          min={0.15}
          max={1}
          step={0.05}
          onChange={setOpacity}
        />
      </div>

      <Canvas
        // `key`: cambiar de preset reposiciona la cámara. Sin remontar, los
        // OrbitControls conservan su objetivo y la vista nueva sale torcida.
        key={preset}
        camera={{
          position: presetPosition(preset),
          // `up` explícito y no el de Three.js por defecto: en las vistas
          // superior e inferior el eje Y es la dirección de mirada y no puede
          // ser además el "arriba" de la pantalla.
          up: CAMERA_UP[preset],
          fov: CAMERA_FOV_DEG,
          near: 0.01,
          far: 20,
        }}
        // `powerPreference: high-performance` pide la GPU dedicada en
        // portátiles con gráficos híbridos, donde la integrada no sostiene 60
        // fps con este número de triángulos.
        // `stencil: true` no es opcional y no es el valor por defecto: desde
        // Three.js r163 el contexto se crea sin buffer de stencil para ahorrar
        // memoria. Sin él las tapas del corte no se recortan contra nada y el
        // cuadrado entero se pinta encima de la escena — que es exactamente lo
        // que pasaba antes de añadir esta línea.
        gl={{ antialias: true, powerPreference: "high-performance", stencil: true }}
        dpr={[1, 2]}
      >
        {/* Luces suaves y nada de sombras duras: una sombra marcada sobre un
            modelo anatómico se lee como relieve que no existe.

            El spec pedía además un entorno de imagen. No se usa el
            `<Environment preset>` de drei porque descarga su HDRI de un CDN
            en tiempo de ejecución, y esta aplicación tiene que funcionar sin
            red —hay empaquetado de escritorio—. Un relleno hemisférico da un
            resultado parecido sin salir a Internet. */}
        <LocalClipping />
        <ScaleBar barRef={scaleBarRef} labelRef={scaleLabelRef} />
        <ValveReadout
          runtime={runtime}
          valves={valves}
          phaseRef={phaseRef}
          handles={valveHandles}
        />

        <hemisphereLight args={["#fff4ee", "#2b2233", 0.55]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 3, 4]} intensity={1.1} />
        <directionalLight position={[-3, 1, -2]} intensity={0.5} />

        <Suspense fallback={null}>
          <HeartModel
            runtime={runtime}
            timeline={timeline}
            valves={valves}
            heartState={heartState}
            isolated={isolated}
            opacity={opacity}
            showMyocardium={myocardium}
            cuts={activeCuts}
          />
        </Suspense>

        {/* Nunca autoRotate: el spec lo descarta, y con razón — un modelo que
            gira solo impide fijar la vista para comparar dos latidos. */}
        <OrbitControls
          enablePan
          enableZoom
          autoRotate={false}
          minDistance={MIN_ZOOM_DISTANCE}
          maxDistance={MAX_ZOOM_DISTANCE}
        />
      </Canvas>

      {/* Barra de escala. Un corte sin referencia se mira; con ella se mide,
          que es lo que distingue una herramienta docente de una ilustración. */}
      <div className={styles.scale} aria-hidden="true">
        <div ref={scaleBarRef} className={styles.scaleBar} />
        <span ref={scaleLabelRef} className={styles.scaleLabel} />
      </div>

      {/* Estado de las cuatro válvulas y fase del ciclo. En el corazón entero
          las válvulas quedan dentro de las cavidades y no se ven; esto deja
          leer desde el primer momento que la mitral se cierra con el QRS, y
          el botón «Válvulas» sirve para comprobarlo en el modelo.

          `aria-hidden`, como la barra de escala y por el mismo motivo: un
          valor que cambia sesenta veces por segundo no se puede leer en voz
          alta, y anunciarlo dejaría el lector de pantalla inservible. */}
      <div className={styles.valves} aria-hidden="true">
        {/* El contenido inicial es la posición de reposo, no un hueco: antes
            del primer latido las válvulas están donde las deja la presión, y
            un panel en blanco se lee como un fallo de carga. React no vuelve a
            tocarlo —el literal no cambia entre renderizados— así que lo que
            escriba `ValveReadout` después se queda. */}
        <span ref={phaseRef} className={styles.valvePhase}>
          {NO_CYCLE_LABEL}
        </span>
        {VALVE_ORDER.map((valve) => (
          <div key={valve} className={styles.valveRow}>
            <span className={styles.valveName}>{HEART_VALVES[valve].label}</span>
            <span className={styles.valveTrack}>
              <span
                ref={registerValve[valve].fill}
                className={styles.valveFill}
                style={{
                  width: `${RESTING_APERTURE[HEART_VALVES[valve].group] * 100}%`,
                }}
              />
            </span>
            <span ref={registerValve[valve].state} className={styles.valveState}>
              {apertureLabel(RESTING_APERTURE[HEART_VALVES[valve].group])}
            </span>
          </div>
        ))}
      </div>

      {/* La licencia del modelo es CC BY-SA: la atribución tiene que estar
          donde se ve el modelo, no solo en el repositorio. El texto es el que
          la licencia exige literalmente, abreviado a lo que cabe. */}
      <p className={styles.attribution}>
        Modelo: BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP)
      </p>
    </section>
  );
}
