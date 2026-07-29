import type { NoiseParamsPayload } from "../types/engine-params";

export interface AdvancedControlPanelProps {
  noise: NoiseParamsPayload;
  onChange: (noise: NoiseParamsPayload) => void;
  onSwitchToBasic: () => void;
}

const SLIDER_MAX_V = 0.3;
const SLIDER_STEP_V = 0.005;

// La onda R de un ECG real mide ~0,001-0,002V. `clip_v` recorta la señal a
// [-clip_v, clip_v] (ver noise.py): con la escala de los demás sliders
// (0-0,3V), clip_v=0 aplana la señal entera a una línea recta (parece una
// asistolia) y cualquier valor > ~0,005V no recorta nada — el slider era o
// catastrófico o un no-op, sin zona útil intermedia.
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
