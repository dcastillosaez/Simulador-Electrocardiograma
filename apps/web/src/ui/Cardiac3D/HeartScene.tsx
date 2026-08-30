import { Suspense, useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SegmentedControl, Slider } from "@ui-system";
import { HEART_GROUPS, type HeartGroup } from "./heart-appearance";
import {
  CAMERA_FOV_DEG,
  CAMERA_PRESETS,
  DEFAULT_PRESET,
  MAX_ZOOM_DISTANCE,
  MIN_ZOOM_DISTANCE,
  presetPosition,
  type CameraPreset,
} from "./HeartCamera";
import { HeartModel } from "./HeartModel";
import { useCardiacTimeline } from "./useCardiacTimeline";
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
};

export interface HeartSceneProps {
  runtime: SessionRuntime;
}

export function HeartScene({ runtime }: HeartSceneProps) {
  const { timeline, heartState } = useCardiacTimeline(runtime);
  const [preset, setPreset] = useState<CameraPreset>(DEFAULT_PRESET);
  const [isolated, setIsolated] = useState<ReadonlySet<HeartGroup>>(new Set());
  const [opacity, setOpacity] = useState(1);

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
        <Slider
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
          fov: CAMERA_FOV_DEG,
          near: 0.01,
          far: 20,
        }}
        // `powerPreference: high-performance` pide la GPU dedicada en
        // portátiles con gráficos híbridos, donde la integrada no sostiene 60
        // fps con este número de triángulos.
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        {/* Luces suaves y nada de sombras duras: una sombra marcada sobre un
            modelo anatómico se lee como relieve que no existe.

            El spec pedía además un entorno de imagen. No se usa el
            `<Environment preset>` de drei porque descarga su HDRI de un CDN
            en tiempo de ejecución, y esta aplicación tiene que funcionar sin
            red —hay empaquetado de escritorio—. Un relleno hemisférico da un
            resultado parecido sin salir a Internet. */}
        <hemisphereLight args={["#fff4ee", "#2b2233", 0.55]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 3, 4]} intensity={1.1} />
        <directionalLight position={[-3, 1, -2]} intensity={0.5} />

        <Suspense fallback={null}>
          <HeartModel
            runtime={runtime}
            timeline={timeline}
            heartState={heartState}
            isolated={isolated}
            opacity={opacity}
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

      {/* La licencia del modelo es CC BY-SA: la atribución tiene que estar
          donde se ve el modelo, no solo en el repositorio. El texto es el que
          la licencia exige literalmente, abreviado a lo que cabe. */}
      <p className={styles.attribution}>
        Modelo: BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP)
      </p>
    </section>
  );
}
