/** Dónde se está ejecutando la interfaz, y de dónde saca el backend.
 *
 * La misma aplicación corre en dos sitios: en un navegador contra un servidor,
 * y dentro de la ventana de escritorio contra un backend que arranca el propio
 * programa. Lo ÚNICO que cambia entre ambos es quién dice en qué dirección
 * escucha el backend. La simulación, el WebSocket y el motor son idénticos, y
 * esa frontera hay que defenderla: en cuanto se duplique lógica por modo,
 * habrá dos simuladores que mantener.
 */

export type RuntimeMode = "browser" | "desktop";

export interface BackendUrls {
  apiBaseUrl: string;
  wsUrl: string;
  /** Secreto de esta sesión de escritorio. Vacío en navegador, donde el
   * backend no lo exige porque la puerta la pone otra cosa. */
  token: string;
}

/** El puente que Tauri inyecta en la ventana antes de cargar la página. */
interface TauriBridge {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function bridge(): TauriBridge | null {
  const candidato = (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  if (!candidato || typeof candidato !== "object") return null;
  const invoke = (candidato as Record<string, unknown>).invoke;
  return typeof invoke === "function" ? (candidato as unknown as TauriBridge) : null;
}

/** Se detecta por la presencia del puente, no por una variable de compilación.
 *
 * `import.meta.env` se hornea al compilar, y el mismo `dist` se sirve en los
 * dos modos: una bandera de compilación obligaría a mantener dos builds del
 * frontend para que la única diferencia fuera de dónde sale una URL. */
export function runtimeMode(): RuntimeMode {
  return bridge() ? "desktop" : "browser";
}

/** Las URL del backend en modo navegador.
 *
 * Los parámetros `?api=` y `?ws=` solo se atienden en desarrollo: publicados,
 * un enlace podría apuntar esta interfaz —la de confianza— a un backend ajeno,
 * que serviría señal falsa con nuestra propia pantalla.
 */
export function browserBackendUrls(search: string): BackendUrls {
  const params = new URLSearchParams(search);
  const override = (name: string) =>
    import.meta.env.DEV ? params.get(name) : null;
  return {
    apiBaseUrl:
      override("api") ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000",
    wsUrl:
      override("ws") ??
      import.meta.env.VITE_WS_URL ??
      "ws://localhost:8000/ws/simulation",
    token: "",
  };
}

/** Deriva la dirección del WebSocket de la de la API.
 *
 * Una sola fuente: el backend es un proceso con un puerto, y mantener dos
 * cadenas independientes es cómo se acaba con la API en un puerto y el
 * WebSocket en otro que ya no existe. */
export function wsUrlFrom(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/simulation";
  return url.toString();
}

/** Las URL del backend, vengan de donde vengan.
 *
 * En escritorio hay que preguntárselas al shell **en tiempo de ejecución**: el
 * puerto es efímero y se elige al arrancar, mucho después de que este código se
 * compilara. Por eso esta función es asíncrona aunque en navegador la respuesta
 * sea inmediata.
 */
export async function resolveBackendUrls(
  search: string = globalThis.location?.search ?? ""
): Promise<BackendUrls> {
  const tauri = bridge();
  if (!tauri) return browserBackendUrls(search);

  const apiBaseUrl = (await tauri.invoke("get_backend_url")) as string;
  const token = (await tauri.invoke("get_backend_token")) as string;
  return { apiBaseUrl, wsUrl: wsUrlFrom(apiBaseUrl), token };
}
