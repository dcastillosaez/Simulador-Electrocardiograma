export const LEAD_ORDER = [
  "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6",
] as const;

export type LeadName = (typeof LEAD_ORDER)[number];
export type LayoutId = "1" | "3" | "6" | "12";

const LAYOUT_LEADS: Record<LayoutId, readonly LeadName[]> = {
  "1": ["II"],
  "3": ["I", "II", "III"],
  "6": ["I", "II", "III", "aVR", "aVL", "aVF"],
  "12": LEAD_ORDER,
};

export function leadsForLayout(layout: LayoutId): readonly LeadName[] {
  return LAYOUT_LEADS[layout];
}

export function leadIndex(lead: LeadName): number {
  return LEAD_ORDER.indexOf(lead);
}
