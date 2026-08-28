import { ControlGroup } from "@ui-system/components/surface/index";
import { Select } from "@ui-system/components/controls/index";
import { HeartRateControl } from "./HeartRateControl";
import { RhythmControls } from "./RhythmControls";
import { NOISE_PRESETS, PRESET_LABELS, matchPreset, type ConcretePresetId, type PresetId } from "./noise-presets";
import type { NoiseParamsPayload } from "../types/engine-params";
import type { ParameterRange } from "../types/rhythms";

export interface BasicControlPanelProps {
  heartRateHz: number;
  heartRateRange: { minimum: number; maximum: number };
  /** Los mandos propios del ritmo, si los tiene. Cuando existen sustituyen al
   * control de frecuencia: en un flutter lo que se mueve es la aurícula y el
   * grado de bloqueo, y el pulso es la consecuencia. */
  rhythmParameters: Record<string, ParameterRange>;
  rhythmValues: Record<string, number>;
  onRhythmParameterChange: (name: string, value: number) => void;
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
        {Object.keys(props.rhythmParameters).length > 0 ? (
          <RhythmControls
            ranges={props.rhythmParameters}
            values={props.rhythmValues}
            onChange={props.onRhythmParameterChange}
            pulseBpm={props.heartRateHz * 60}
          />
        ) : (
          <HeartRateControl
            range={props.heartRateRange}
            valueHz={props.heartRateHz}
            onChange={props.onHeartRateChange}
          />
        )}
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
