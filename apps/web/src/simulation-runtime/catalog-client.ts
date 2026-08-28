import type { RhythmDetail, RhythmSummary } from "../types/rhythms";
import type { DrugDetail, DrugSummary } from "../types/drugs";
import type {
  CustomPatientDetail,
  CustomPatientSummary,
  PatientPayload,
} from "../types/patients";

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

  // --- pacientes personalizados --------------------------------------------
  //
  // A diferencia de ritmos y farmacos, esto SI sale de la base de datos: no
  // es catalogo versionado con el motor sino material que escribe el usuario.
  // Vive en el mismo cliente porque comparte base, token y manejo de errores;
  // separarlo habria duplicado las tres cosas.

  async listPatients(): Promise<CustomPatientSummary[]> {
    return this.json<CustomPatientSummary[]>("/api/patients");
  }

  async getPatient(patientId: string): Promise<CustomPatientDetail> {
    return this.json<CustomPatientDetail>(
      `/api/patients/${encodeURIComponent(patientId)}`
    );
  }

  async createPatient(
    name: string,
    patient: PatientPayload
  ): Promise<CustomPatientDetail> {
    return this.json<CustomPatientDetail>("/api/patients", {
      method: "POST",
      body: JSON.stringify({ name, patient }),
    });
  }

  async updatePatient(
    patientId: string,
    name: string,
    patient: PatientPayload
  ): Promise<CustomPatientDetail> {
    return this.json<CustomPatientDetail>(
      `/api/patients/${encodeURIComponent(patientId)}`,
      { method: "PUT", body: JSON.stringify({ name, patient }) }
    );
  }

  async deletePatient(patientId: string): Promise<void> {
    await this.json<void>(`/api/patients/${encodeURIComponent(patientId)}`, {
      method: "DELETE",
    });
  }

  /** Una peticion con el manejo de errores en un solo sitio.
   *
   * El mensaje del servidor viaja hasta la interfaz: cuando dice «ya existe
   * un paciente llamado X», eso es lo que el usuario necesita leer, no un
   * «error 409» que le obligue a adivinar. */
  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(await this.describe(response, path));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async describe(response: Response, path: string): Promise<string> {
    try {
      const body = await response.json();
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
    } catch {
      // Cuerpo vacio o no JSON: queda el codigo, que ya dice algo.
    }
    return `${path} devolvió ${response.status}`;
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
