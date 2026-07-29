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

  const step = (deltaBpm: number) => {
    const next = clamp(bpm + deltaBpm, minBpm, maxBpm);
    onChange(next / 60);
  };

  return (
    <div>
      <button type="button" aria-label="Bajar frecuencia" onClick={() => step(-STEP_BPM)}>
        −5
      </button>
      <span aria-live="polite">{bpm} lpm</span>
      <button type="button" aria-label="Subir frecuencia" onClick={() => step(STEP_BPM)}>
        +5
      </button>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
