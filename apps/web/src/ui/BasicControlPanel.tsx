import { HeartRateControl } from "./HeartRateControl";
import { NOISE_PRESETS, PRESET_LABELS, matchPreset, type ConcretePresetId, type PresetId } from "./noise-presets";
import type { NoiseParamsPayload } from "../types/engine-params";

export interface BasicControlPanelProps {
  heartRateHz: number;
  heartRateRange: { minimum: number; maximum: number };
  noise: NoiseParamsPayload;
  onHeartRateChange: (hz: number) => void;
  onNoiseChange: (noise: NoiseParamsPayload) => void;
  onSwitchToAdvanced: () => void;
}

export function BasicControlPanel(props: BasicControlPanelProps) {
  const currentPreset = matchPreset(props.noise);

  const handlePresetChange = (preset: PresetId) => {
    if (preset === "personalizada") {
      props.onSwitchToAdvanced();
      return;
    }
    props.onNoiseChange(NOISE_PRESETS[preset as ConcretePresetId]);
  };

  return (
    <fieldset>
      <legend>Ritmo</legend>
      <HeartRateControl
        range={props.heartRateRange}
        valueHz={props.heartRateHz}
        onChange={props.onHeartRateChange}
      />

      <legend>Calidad de señal</legend>
      <select
        aria-label="Calidad de señal"
        value={currentPreset}
        onChange={(event) => handlePresetChange(event.target.value as PresetId)}
      >
        {(Object.keys(PRESET_LABELS) as PresetId[]).map((id) => (
          <option key={id} value={id}>
            {PRESET_LABELS[id]}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
