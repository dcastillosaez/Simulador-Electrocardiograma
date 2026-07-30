import { ControlGroup } from "@ui-system/components/surface/index";
import { Slider } from "@ui-system/components/controls/index";
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
    <ControlGroup label="Ruido (avanzado)">
      <Slider label="EMG" value={noise.emg_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("emg_v", v)} />
      <Slider label="Interferencia 50Hz" value={noise.mains_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("mains_v", v)} />
      <Slider label="Línea base" value={noise.baseline_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("baseline_v", v)} />
      <Slider label="Movimiento" value={noise.motion_v} min={0} max={SLIDER_MAX_V} step={SLIDER_STEP_V}
        onChange={(v) => setField("motion_v", v)} />
      {/* El extremo izquierdo (0) significa "sin saturación" (`clip_v: null`),
          no "recortar a amplitud cero" — sin este mapeo, arrastrar el slider y
          devolverlo a la izquierda dejaba `clip_v: 0`, que aplana el trazo
          entero a una línea recta sin forma de deshacerlo desde este panel. */}
      <Slider label="Saturación" value={noise.clip_v ?? 0} min={0} max={CLIP_MAX_V} step={CLIP_STEP_V}
        onChange={(v) => setField("clip_v", v === 0 ? null : v)} />
      <button type="button" onClick={onSwitchToBasic}>
        Volver a modo básico
      </button>
    </ControlGroup>
  );
}
