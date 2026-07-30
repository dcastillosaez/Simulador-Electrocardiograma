import { ControlGroup } from "@ui-system/components/surface/index";
import { Select } from "@ui-system/components/controls/index";
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
    <>
      <ControlGroup label="Ritmo">
        <HeartRateControl
          range={props.heartRateRange}
          valueHz={props.heartRateHz}
          onChange={props.onHeartRateChange}
        />
      </ControlGroup>
      <ControlGroup label="Señal">
        <Select
          label="Calidad de señal"
          value={currentPreset}
          options={(Object.keys(PRESET_LABELS) as PresetId[]).map((id) => ({
            value: id,
            label: PRESET_LABELS[id],
          }))}
          onChange={(value) => handlePresetChange(value as PresetId)}
        />
      </ControlGroup>
    </>
  );
}
