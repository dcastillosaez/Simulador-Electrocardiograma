import { useEffect, useState } from "react";
import type { CatalogClient } from "../simulation-runtime/catalog-client";
import type { RhythmDetail, RhythmSummary } from "../types/rhythms";

export interface RhythmSelectorProps {
  catalogClient: CatalogClient;
  selectedRhythmId: string | null;
  onSelect: (rhythmId: string, detail: RhythmDetail) => void;
}

export function RhythmSelector({
  catalogClient,
  selectedRhythmId,
  onSelect,
}: RhythmSelectorProps) {
  const [rhythms, setRhythms] = useState<RhythmSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    catalogClient
      .listRhythms()
      .then((list) => {
        if (!cancelled) setRhythms(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [catalogClient]);

  const handleChange = async (rhythmId: string) => {
    if (!rhythmId) return;
    const detail = await catalogClient.getRhythm(rhythmId);
    onSelect(rhythmId, detail);
  };

  if (loadError) {
    return <p role="alert">No se pudo cargar el catálogo: {loadError}</p>;
  }

  return (
    <select
      aria-label="Seleccionar ritmo"
      value={selectedRhythmId ?? ""}
      onChange={(event) => void handleChange(event.target.value)}
    >
      <option value="" disabled>
        Selecciona un ritmo
      </option>
      {rhythms.map((rhythm) => (
        <option key={rhythm.rhythm_id} value={rhythm.rhythm_id}>
          {rhythm.display_name}
        </option>
      ))}
    </select>
  );
}
