import type { RhythmDetail, RhythmSummary } from "../types/rhythms";
import type { DrugDetail, DrugSummary } from "../types/drugs";

export interface CatalogClientOptions {
  baseUrl: string;
  /** Token del modo escritorio, si lo hay. Viaja en cada peticion como
   * cabecera `X-ECG-Token`: en escritorio el backend escucha en 127.0.0.1 y
   * eso lo alcanza cualquier programa del equipo. */
  token?: string;
  fetchImpl?: typeof fetch;
}

export class CatalogClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CatalogClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = options.token ? { "X-ECG-Token": options.token } : {};
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
    const response = await this.fetchImpl(`${this.baseUrl}/api/rhythms`, { headers: this.headers });
    if (!response.ok) {
      throw new Error(`GET /api/rhythms devolvió ${response.status}`);
    }
    return (await response.json()) as RhythmSummary[];
  }

  async getRhythm(rhythmId: string): Promise<RhythmDetail> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/rhythms/${encodeURIComponent(rhythmId)}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`GET /api/rhythms/${rhythmId} devolvió ${response.status}`);
    }
    return (await response.json()) as RhythmDetail;
  }

  /** El catálogo de fármacos, servido igual que el de ritmos: desde el
   * motor versionado, no desde la base de datos. */
  async listDrugs(): Promise<DrugSummary[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/drugs`, { headers: this.headers });
    if (!response.ok) {
      throw new Error(`GET /api/drugs devolvió ${response.status}`);
    }
    return (await response.json()) as DrugSummary[];
  }

  async getDrug(drugId: string): Promise<DrugDetail> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/drugs/${encodeURIComponent(drugId)}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`GET /api/drugs/${drugId} devolvió ${response.status}`);
    }
    return (await response.json()) as DrugDetail;
  }
}
