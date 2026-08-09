import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserBackendUrls,
  resolveBackendUrls,
  runtimeMode,
  wsUrlFrom,
} from "./runtime-mode";

const global = globalThis as Record<string, unknown>;

afterEach(() => {
  delete global.__TAURI_INTERNALS__;
});

describe("runtimeMode", () => {
  it("sin puente de Tauri, es un navegador", () => {
    expect(runtimeMode()).toBe("browser");
  });

  it("con puente de Tauri, es escritorio", () => {
    // Se detecta por la presencia del puente y no por una variable de
    // compilacion: el mismo `dist` se sirve en los dos modos.
    global.__TAURI_INTERNALS__ = { invoke: vi.fn() };
    expect(runtimeMode()).toBe("desktop");
  });

  it("un objeto sin `invoke` no cuenta como Tauri", () => {
    global.__TAURI_INTERNALS__ = { otraCosa: 1 };
    expect(runtimeMode()).toBe("browser");
  });
});

describe("wsUrlFrom", () => {
  it("deriva el WebSocket del puerto de la API", () => {
    // Una sola fuente: mantener dos cadenas independientes es como se acaba
    // con la API en un puerto y el WebSocket en otro que ya no existe.
    expect(wsUrlFrom("http://127.0.0.1:52341")).toBe(
      "ws://127.0.0.1:52341/ws/simulation"
    );
  });

  it("respeta TLS", () => {
    expect(wsUrlFrom("https://ecg.ejemplo.edu")).toBe(
      "wss://ecg.ejemplo.edu/ws/simulation"
    );
  });
});

describe("browserBackendUrls", () => {
  it("cae al valor por defecto sin configuracion", () => {
    const urls = browserBackendUrls("");
    expect(urls.apiBaseUrl).toBe("http://localhost:8000");
    expect(urls.wsUrl).toBe("ws://localhost:8000/ws/simulation");
  });

  it("no atiende `?api=` fuera de desarrollo", () => {
    // Publicado, un enlace podria apuntar esta interfaz a un backend ajeno,
    // que serviria senal falsa con nuestra propia pantalla. `import.meta.env.DEV`
    // es true bajo vitest, asi que aqui se comprueba el camino permitido; el
    // prohibido lo garantiza la propia condicion.
    const urls = browserBackendUrls("?api=http://otro:9000");
    expect(urls.apiBaseUrl).toBe(
      import.meta.env.DEV ? "http://otro:9000" : "http://localhost:8000"
    );
  });
});

describe("resolveBackendUrls", () => {
  it("en escritorio, le pregunta al shell", async () => {
    // El puerto es efimero y se elige al arrancar, mucho despues de que este
    // codigo se compilara: no hay forma de hornearlo en el build.
    const invoke = vi.fn().mockResolvedValue("http://127.0.0.1:52341");
    global.__TAURI_INTERNALS__ = { invoke };

    const urls = await resolveBackendUrls("");

    expect(invoke).toHaveBeenCalledWith("get_backend_url");
    expect(urls.apiBaseUrl).toBe("http://127.0.0.1:52341");
    expect(urls.wsUrl).toBe("ws://127.0.0.1:52341/ws/simulation");
  });

  it("en navegador no invoca nada", async () => {
    const urls = await resolveBackendUrls("");
    expect(urls.apiBaseUrl).toBe("http://localhost:8000");
  });
});
