import type { NoiseParamsPayload } from "../types/engine-params";

export interface AdvancedControlPanelProps {
  noise: NoiseParamsPayload;
  onChange: (noise: NoiseParamsPayload) => void;
  onSwitchToBasic: () => void;
}

const SLIDER_MAX_V = 0.3;
const SLIDER_STEP_V = 0.005;

export function AdvancedControlPanel({ noise, onChange, onSwitchToBasic }: AdvancedControlPanelProps) {
  const setField = (field: keyof NoiseParamsPayload, value: number) => {
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
        onChange={(v) => setField("clip_v", v)}
      />
      <button type="button" onClick={onSwitchToBasic}>
        Volver a modo básico
      </button>
    </fieldset>
  );
}

function NoiseSlider(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      {props.label}
      <input
        aria-label={props.label}
        type="range"
        min={0}
        max={SLIDER_MAX_V}
        step={SLIDER_STEP_V}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
