import type { RhythmDetail, RhythmSummary } from "../types/rhythms";

export interface CatalogClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class CatalogClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CatalogClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listRhythms(): Promise<RhythmSummary[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/rhythms`);
    if (!response.ok) {
      throw new Error(`GET /api/rhythms devolvió ${response.status}`);
    }
    return (await response.json()) as RhythmSummary[];
  }

  async getRhythm(rhythmId: string): Promise<RhythmDetail> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/rhythms/${encodeURIComponent(rhythmId)}`
    );
    if (!response.ok) {
      throw new Error(`GET /api/rhythms/${rhythmId} devolvió ${response.status}`);
    }
    return (await response.json()) as RhythmDetail;
  }
}
