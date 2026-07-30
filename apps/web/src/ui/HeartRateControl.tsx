import { NumberField } from "@ui-system/components/controls/index";

export interface HeartRateControlProps {
  range: { minimum: number; maximum: number };
  valueHz: number;
  onChange: (valueHz: number) => void;
}

const STEP_BPM = 5;

export function HeartRateControl({ range, valueHz, onChange }: HeartRateControlProps) {
  const bpm = Math.round(valueHz * 60);
  const minBpm = Math.round(range.minimum * 60);
  const maxBpm = Math.round(range.maximum * 60);

  // El motor documenta este contrato por escrito (catalog/definitions.py):
  // los ritmos de frecuencia fija (flutter, TV, FV...) declaran
  // minimum===maximum, y ofrecer un control que no hace nada sería
  // mentirle al usuario -- hay que deshabilitarlo, no dejarlo pulsable.
  const isFixed = minBpm === maxBpm;

  return (
    <NumberField
      label="Frecuencia"
      value={bpm}
      min={minBpm}
      max={maxBpm}
      step={STEP_BPM}
      unit="lpm"
      decrementLabel="Bajar frecuencia"
      incrementLabel="Subir frecuencia"
      readOnly={isFixed}
      readOnlyText={`${bpm} lpm (fija)`}
      // El campo trabaja en latidos por minuto, que es como se piensa una
      // frecuencia; el motor en hercios. La conversión vive aquí y no en el
      // componente genérico, que no sabe de fisiología.
      onChange={(nextBpm) => onChange(nextBpm / 60)}
    />
  );
}
