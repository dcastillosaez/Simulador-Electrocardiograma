import type { LayoutId } from "../render/layout";

const LAYOUTS: LayoutId[] = ["1", "3", "6", "12"];

export interface LayoutPickerProps {
  value: LayoutId;
  onChange: (layout: LayoutId) => void;
}

export function LayoutPicker({ value, onChange }: LayoutPickerProps) {
  return (
    <div role="radiogroup" aria-label="Derivaciones visibles">
      {LAYOUTS.map((layout) => (
        <label key={layout}>
          <input
            type="radio"
            name="layout"
            value={layout}
            checked={value === layout}
            onChange={() => onChange(layout)}
          />
          {layout}
        </label>
      ))}
    </div>
  );
}
