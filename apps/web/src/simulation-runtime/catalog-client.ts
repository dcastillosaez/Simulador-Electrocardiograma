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
    // `fetch` sin enlazar pierde el `this` de `window`/`globalThis` que el
    // navegador exige (comprobación de "brand" de la spec de WebIDL): al
    // invocarlo como `this.fetchImpl(...)` (método de la instancia) lanza
    // "TypeError: Failed to execute 'fetch' on 'Window': Illegal
    // invocation". Los tests unitarios nunca lo detectaron porque siempre
    // inyectan un `fetchImpl` de prueba (sin esa comprobación) — solo un
    // navegador real, como en el benchmark de Playwright, lo revela.
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
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
