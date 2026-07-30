import { SegmentedControl } from "@ui-system/components/controls/index";
import type { LayoutId } from "../render/layout";

const OPTIONS: Array<{ value: LayoutId; label: string }> = [
  { value: "1", label: "1" },
  { value: "3", label: "3" },
  { value: "6", label: "6" },
  { value: "12", label: "12" },
];

export interface LayoutPickerProps {
  value: LayoutId;
  onChange: (layout: LayoutId) => void;
}

export function LayoutPicker({ value, onChange }: LayoutPickerProps) {
  return (
    <SegmentedControl
      label="Derivaciones visibles"
      value={value}
      options={OPTIONS}
      onChange={onChange}
    />
  );
}
