export const LEAD_ORDER = [
  "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6",
] as const;

export type LeadName = (typeof LEAD_ORDER)[number];

/** Formatos de pantalla. `"6x2"` son las doce derivaciones en dos columnas de
 * seis, el formato en que se imprime un ECG completo en papel. */
export type LayoutId = "1" | "3" | "6" | "12" | "6x2";

const LAYOUT_LEADS: Record<LayoutId, readonly LeadName[]> = {
  "1": ["II"],
  "3": ["I", "II", "III"],
  "6": ["I", "II", "III", "aVR", "aVL", "aVF"],
  "12": LEAD_ORDER,
  "6x2": LEAD_ORDER,
};

/** En cuántas columnas se reparten las derivaciones.
 *
 * Solo `"6x2"` usa dos. Es un formato cerrado y no un interruptor que parta
 * cualquier layout: «split con tres derivaciones» no significa nada
 * clínicamente, y admitirlo obligaría a inventar un reparto para los impares. */
export function columnsForLayout(layout: LayoutId): number {
  return layout === "6x2" ? 2 : 1;
}

/** Las derivaciones de cada columna, en orden de lectura.
 *
 * Las dos columnas van sincronizadas: muestran el mismo instante con
 * derivaciones distintas, como un monitor de cabecera. No es el papel, donde
 * cada bloque es un tramo de tiempo consecutivo — aquí la señal está viva y
 * comparar morfologías del mismo latido entre derivaciones es justo lo que
 * se quiere poder hacer. */
export function leadColumnsForLayout(layout: LayoutId): readonly (readonly LeadName[])[] {
  const leads = leadsForLayout(layout);
  const columns = columnsForLayout(layout);
  if (columns === 1) return [leads];

  const perColumn = Math.ceil(leads.length / columns);
  return Array.from({ length: columns }, (_, index) =>
    leads.slice(index * perColumn, (index + 1) * perColumn)
  );
}

/** Filas visibles, que es lo que reparte el alto disponible. En `"6x2"` son
 * seis aunque haya doce derivaciones: por eso las tiras son el doble de altas
 * que en `"12"`. */
export function rowsForLayout(layout: LayoutId): number {
  return Math.ceil(leadsForLayout(layout).length / columnsForLayout(layout));
}

export function leadsForLayout(layout: LayoutId): readonly LeadName[] {
  return LAYOUT_LEADS[layout];
}

export function leadIndex(lead: LeadName): number {
  return LEAD_ORDER.indexOf(lead);
}
