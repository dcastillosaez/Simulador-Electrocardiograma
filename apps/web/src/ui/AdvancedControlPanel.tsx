import type { NoiseParamsPayload } from "../types/engine-params";
import { R_WAVE_V } from "./noise-presets";

export interface AdvancedControlPanelProps {
  noise: NoiseParamsPayload;
  onChange: (noise: NoiseParamsPayload) => void;
  onSwitchToBasic: () => void;
}

// emg_v/mains_v/baseline_v/motion_v son ruido aditivo sobre una señal cuya
// onda R mide ~R_WAVE_V (ver noise-presets.ts). Antes este slider llegaba
// hasta 0,3V (300x R_WAVE_V) con paso 0,005V (5x R_WAVE_V): el primer paso
// no nulo ya saturaba la señal, sin zona útil intermedia — el mismo bug que
// tenía `clip_v` antes de recalibrarse más abajo. Tope en 2x R_WAVE_V y paso
// en 1/100 del tope para tener recorrido útil por debajo de ese tope.
const SLIDER_MAX_V = R_WAVE_V * 2;
const SLIDER_STEP_V = SLIDER_MAX_V / 100;

// La onda R de un ECG real mide ~0,001-0,002V. `clip_v` recorta la señal a
// [-clip_v, clip_v] (ver noise.py): cuando los demás sliders todavía usaban
// una escala de 0-0,3V, clip_v=0 aplanaba la señal entera a una línea recta
// (parecía una asistolia) y cualquier valor > ~0,005V no recortaba nada — el
// slider era o catastrófico o un no-op, sin zona útil intermedia.
const CLIP_MAX_V = 0.005;
const CLIP_STEP_V = 0.0001;

export function AdvancedControlPanel({ noise, onChange, onSwitchToBasic }: AdvancedControlPanelProps) {
  const setField = (field: keyof NoiseParamsPayload, value: number | null) => {
    onChange({ ...noise, [field]: value });
  };

  return (
    <fieldset>
      <legend>Ruido (avanzado)</legend>
      <NoiseSlider label="EMG" value={noise.emg_v} onChange={(v) => setField("emg_v", v)} />
      <NoiseSlider
        label="Interferencia 50Hz"
        value={noise.mains_v}
        onChange={(v) => setField("mains_v", v)}
      />
      <NoiseSlider
        label="Línea base"
        value={noise.baseline_v}
        onChange={(v) => setField("baseline_v", v)}
      />
      <NoiseSlider
        label="Movimiento"
        value={noise.motion_v}
        onChange={(v) => setField("motion_v", v)}
      />
      <NoiseSlider
        label="Saturación"
        value={noise.clip_v ?? 0}
        max={CLIP_MAX_V}
        step={CLIP_STEP_V}
        // El extremo izquierdo (0) significa "sin saturación" (`clip_v:
        // null`), no "recortar a amplitud cero" — sin este mapeo, arrastrar
        // el slider y devolverlo a la izquierda dejaba `clip_v: 0`, que
        // aplana el trazo entero a una línea recta sin forma de deshacerlo
        // desde este mismo panel.
        onChange={(v) => setField("clip_v", v === 0 ? null : v)}
      />
      <button type="button" onClick={onSwitchToBasic}>
        Volver a modo básico
      </button>
    </fieldset>
  );
}

function NoiseSlider(props: {
  label: string;
  value: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        aria-label={props.label}
        type="range"
        min={0}
        max={props.max ?? SLIDER_MAX_V}
        step={props.step ?? SLIDER_STEP_V}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
