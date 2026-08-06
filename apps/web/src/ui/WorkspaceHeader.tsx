import { Header, IconButton, SegmentedControl, Tooltip } from "@ui-system";
import type { ThemeName } from "@ui-system/themes/index";
import { LayoutPicker } from "./LayoutPicker";
import type { LayoutId } from "../render/layout";
import { GAIN_STEPS_MM_PER_MV, type GainSetting } from "../render/layout-engine";

const THEME_OPTIONS: Array<{ value: ThemeName; label: string }> = [
  { value: "dark", label: "Monitor" },
  { value: "light", label: "Papel" },
];

/** El valor viaja como texto porque un `SegmentedControl` es un grupo de
 * radios y el `value` de un radio siempre es una cadena. Se traduce en el
 * unico sitio donde se lee. */
const GAIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto" },
  ...GAIN_STEPS_MM_PER_MV.map((gain) => ({
    value: String(gain),
    label: String(gain),
  })),
];

function parseGain(value: string): GainSetting {
  return value === "auto" ? "auto" : Number(value);
}

const GAIN_HINT =
  "Ganancia vertical en mm/mV. En automatico se elige la mayor que quepa, " +
  "igual que en un electrocardiografo. La velocidad del papel no cambia nunca.";

export interface WorkspaceHeaderProps {
  layout: LayoutId;
  onLayoutChange: (layout: LayoutId) => void;
  themeName: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  gain: GainSetting;
  onGainChange: (gain: GainSetting) => void;
  isFrozen: boolean;
  onToggleFreeze: () => void;
  freezeDisabled: boolean;
  magnifier: boolean;
  onToggleMagnifier: () => void;
  onExportPng: () => void;
  isRecording: boolean;
  onToggleRecording: () => void;
}

/** Los controles de la cabecera del puesto de simulación.
 *
 * Separado de `ECGWorkspace` porque ese fichero es donde se cablea todo —
 * runtime, métricas, renderer, medición— y mezclarlo con el detalle de qué
 * opciones tiene el selector de ganancia lo hacía crecer sin límite. */
export function WorkspaceHeader({
  layout,
  onLayoutChange,
  themeName,
  onThemeChange,
  gain,
  onGainChange,
  isFrozen,
  onToggleFreeze,
  freezeDisabled,
  magnifier,
  onToggleMagnifier,
  onExportPng,
  isRecording,
  onToggleRecording,
}: WorkspaceHeaderProps) {
  return (
    <Header title="Simulador de electrocardiograma">
      {/* LayoutPicker y no un SegmentedControl inline: el array de opciones
          vive en un solo sitio y el componente sigue teniendo su test. */}
      <LayoutPicker value={layout} onChange={onLayoutChange} />
      <SegmentedControl
        label="Aspecto"
        value={themeName}
        options={THEME_OPTIONS}
        onChange={onThemeChange}
      />
      <Tooltip content={GAIN_HINT}>
        <SegmentedControl
          label="Ganancia"
          value={gain === "auto" ? "auto" : String(gain)}
          options={GAIN_OPTIONS}
          onChange={(value) => onGainChange(parseGain(value))}
        />
      </Tooltip>
      {/* "Congelar" y no "Pausa": lo que el usuario quiere no es detener
          un vídeo, es parar el barrido para poder leer el trazado. El
          texto del botón dice lo que hace, no cómo está implementado. */}
      <IconButton
        icon={isFrozen ? "play" : "pause"}
        label={isFrozen ? "Reanudar" : "Congelar"}
        onClick={onToggleFreeze}
        disabled={freezeDisabled}
        active={isFrozen}
      />
      {/* Solo congelado: la lupa dibuja desde el anillo, y con el barrido en
          marcha lo que hay bajo el cursor cambia 500 veces por segundo. */}
      <IconButton
        icon="zoom"
        label="Lupa"
        onClick={onToggleMagnifier}
        disabled={!isFrozen}
        active={magnifier}
      />
      <IconButton icon="download" label="PNG" onClick={onExportPng} />
      <IconButton
        icon={isRecording ? "stop" : "ecg"}
        label={isRecording ? "Detener" : "Grabar"}
        onClick={onToggleRecording}
        active={isRecording}
      />
    </Header>
  );
}
