# Fase C — Frontend del simulador de ECG — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la interfaz web (`apps/web`) que consume la API de streaming de la fase B: seleccionar un ritmo, arrancar la sesión, ver el trazado de las 12 derivaciones en tiempo real, y ajustar frecuencia cardíaca y ruido en caliente.

**Architecture:** Cuatro capas desacopladas — `simulation-runtime` (WS, decodificador binario, buffer circular, máquina de estados, expuesto como `EventEmitter`, sin dependencia de React) → `state` (Zustand, solo estado de interfaz derivado) → `render` (Canvas 2D en capas: rejilla estática, trazo por derivación, overlay reservado) → `ui` (componentes React). El bucle de dibujo lee el buffer directamente en cada `requestAnimationFrame`, sin pasar por React ni por Zustand.

**Tech Stack:** React 18 + TypeScript + Vite, Zustand, Canvas 2D, Vitest + Testing Library (unit/componente), Playwright (rendimiento, nivel 3).

## Global Constraints

- El motor recibe únicamente `heart_rate_hz` y los 5 parámetros de ruido (`emg_v`, `mains_v`, `baseline_v`, `motion_v`, `clip_v`). Velocidad de papel, ganancia, calibración y layout son parámetros de render, **nunca** generan tráfico de red.
- Contrato binario: cabecera de 40 bytes little-endian (`version` u16, `sample_rate_hz` u16, `n_channels` u8, reservado u8, `n_samples_per_channel` u16, `sequence_number` u32, reservado2 u32, `t_start_s` f64, `session_id` 16 bytes en orden de red), payload `float32` channel-major en voltios. Orden canónico de derivaciones: I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6.
- `sequence_number`: un valor menor o igual al último recibido se descarta (fuera de orden); un salto hacia delante indica frames perdidos (se registra, no se interpola); un `session_id` distinto reinicia el seguimiento.
- Buffer objetivo 500ms, rango sano 300-700ms. Underrun (vacío): congelar el trazo en la última muestra, nunca interpolar. Overrun (>700ms): descartar lo más antiguo.
- Sin reconexión automática del WebSocket.
- `pausar` (mensaje `pause`/`resume` al servidor, detiene el reloj de simulación) y `congelar` (acción de cliente sobre el buffer) son conceptos distintos.
- Los tipos que reflejan el contrato JSON (`EngineParamsPayload`, mensajes WS, esquemas REST) usan los nombres de campo `snake_case` exactos del backend — sin capa de traducción a `camelCase` que pueda desincronizarse.
- Fuera de alcance de esta fase: historial de sesiones, corazón 3D, farmacología, monitor de constantes vitales, reconexión automática.

---

## Mapa de ficheros

```
Simulador_Electrocardiograma/apps/web/
├── package.json, tsconfig.json, vite.config.ts, index.html, .env.example
├── src/
│   ├── main.tsx, App.tsx, test-setup.ts
│   ├── types/
│   │   ├── engine-params.ts     EngineParamsPayload, NoiseParamsPayload, VariabilityParamsPayload
│   │   ├── rhythms.ts           RhythmSummary, RhythmDetail, ParameterRange
│   │   └── ws-messages.ts       ClientMessage/ServerMessage y sus variantes
│   ├── simulation-runtime/
│   │   ├── event-emitter.ts     TypedEventEmitter genérico
│   │   ├── frame-decoder.ts     decodeFrame() — espejo de frames.py
│   │   ├── frame-buffer.ts      FrameBuffer — jitter buffer con avance determinista
│   │   ├── websocket-client.ts  envoltorio fino sobre WebSocket, inyectable para tests
│   │   ├── session-runtime.ts   máquina de estados + EventEmitter, compone lo anterior
│   │   └── catalog-client.ts    GET /api/rhythms, GET /api/rhythms/{id}
│   ├── state/
│   │   └── session-store.ts     Zustand, escucha eventos de SessionRuntime
│   ├── render/
│   │   ├── layout.ts            LEAD_ORDER, layouts 1/3/6/12, leadIndex()
│   │   ├── grid-layer.ts        rejilla clínica prerenderizada
│   │   └── lead-canvas.ts       trazo por derivación + OverlayLayer reservado
│   └── ui/
│       ├── RhythmSelector.tsx
│       ├── LayoutPicker.tsx
│       ├── noise-presets.ts     presets de calidad de señal
│       ├── HeartRateControl.tsx
│       ├── BasicControlPanel.tsx
│       ├── AdvancedControlPanel.tsx
│       └── ECGWorkspace.tsx     componente raíz, conecta todo
└── tests/e2e/
    └── streaming-performance.spec.ts   Playwright, nivel 3
```

---

### Task 1: CORS en `apps/api`

El backend no tiene `CORSMiddleware` — hallazgo pendiente de la revisión final de la fase B, resuelto ahora que por fin hace falta (el dev server de Vite corre en un origen distinto al de la API).

**Files:**
- Modify: `apps/api/src/ecg_api/config.py`
- Modify: `apps/api/src/ecg_api/main.py`
- Test: `apps/api/tests/unit/test_config.py`
- Test: `apps/api/tests/unit/test_cors.py`

**Interfaces:**
- Produces: `Settings.cors_origins: str` (variable de entorno `CORS_ORIGINS`, coma-separada), `Settings.cors_origins_list -> list[str]`.

- [ ] **Step 1: Write the failing test**

Añadir a `apps/api/tests/unit/test_config.py`:

```python
from ecg_api.config import Settings


def test_settings_have_sane_defaults(monkeypatch):
    # `tests/integration/conftest.py` fija `DATABASE_URL`/`ENGINE_COMMIT` en
    # el entorno del proceso de pytest para que `lifespan` apunte siempre a
    # la base de test (ver su comentario). `_env_file=None` solo desactiva
    # la lectura de `.env`, no la del entorno, así que hace falta limpiarlas
    # aquí explícitamente para probar los valores por defecto reales cuando
    # los tests de esta tarea y los de integración corren en la misma sesión.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ENGINE_COMMIT", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    settings = Settings(_env_file=None)
    assert settings.engine_commit == "dev"
    assert "postgresql+asyncpg://" in settings.database_url
    assert settings.cors_origins_list == ["http://localhost:5173"]


def test_settings_read_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:x@host/db")
    monkeypatch.setenv("ENGINE_COMMIT", "8c4b92f")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173,https://ecg.example.org")
    settings = Settings(_env_file=None)
    assert settings.database_url == "postgresql+asyncpg://x:x@host/db"
    assert settings.engine_commit == "8c4b92f"
    assert settings.cors_origins_list == [
        "http://localhost:5173",
        "https://ecg.example.org",
    ]


def test_cors_origins_list_ignores_blank_entries(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, ,https://ecg.example.org,")
    settings = Settings(_env_file=None)
    assert settings.cors_origins_list == [
        "http://localhost:5173",
        "https://ecg.example.org",
    ]
```

Crear `apps/api/tests/unit/test_cors.py`:

```python
from fastapi.testclient import TestClient

from ecg_api.main import app


def test_cors_allows_the_configured_origin():
    # Sin `with`: no dispara el `lifespan` (que sembraría el catálogo contra
    # Postgres), igual que test_health.py. CORSMiddleware ya está montado
    # en el momento en que se construye `app`, no en el lifespan.
    client = TestClient(app)
    response = client.get(
        "/api/health", headers={"Origin": "http://localhost:5173"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_an_unlisted_origin():
    client = TestClient(app)
    response = client.get(
        "/api/health", headers={"Origin": "https://otro-origen.example"}
    )
    assert "access-control-allow-origin" not in response.headers
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/unit/test_config.py tests/unit/test_cors.py -v`
Expected: FAIL — `cors_origins_list` no existe todavía en `Settings`; `test_cors_allows_the_configured_origin` falla porque no hay cabecera CORS en la respuesta.

- [ ] **Step 3: Write minimal implementation**

En `apps/api/src/ecg_api/config.py`, añadir el campo y la propiedad:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://ecg:ecg@localhost:5432/ecg_simulator"
    engine_commit: str = "dev"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]
```

En `apps/api/src/ecg_api/main.py`, registrar el middleware justo tras construir `app` (antes de los routers, aunque el orden de `include_router` no importa para middleware):

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import async_sessionmaker

from .config import get_settings
from .db.base import get_engine
from .db.seed import seed_catalog
from .routers.health import router as health_router
from .routers.rhythms import router as rhythms_router
from .routers.sessions import router as sessions_router
from .routers.simulation_ws import router as simulation_ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    engine = get_engine(settings.database_url)
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with app.state.session_factory() as session:
        await seed_catalog(session, settings)
    yield
    await engine.dispose()


app = FastAPI(title="Simulador de ECG — API", lifespan=lifespan)

# El WebSocket no pasa por CORSMiddleware — Starlette solo lo aplica a
# peticiones HTTP normales, y los navegadores no bloquean conexiones WS
# entre orígenes distintos por CORS (solo por la cabecera Origin, que el
# servidor tendría que comprobar él mismo si quisiera restringirlo). Esto
# cubre las rutas REST: catálogo, sesiones, salud.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(rhythms_router)
app.include_router(sessions_router)
app.include_router(simulation_ws_router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/unit/test_config.py tests/unit/test_cors.py -v`
Expected: PASS, 5 passed

Y la suite completa para confirmar que no hay regresiones:

Run: `cd apps/api && uv run pytest -v`
Expected: PASS, toda la suite en verde (72 tests: los 71 previos + 1 nuevo test de config; `test_cors.py` añade 2 más = 73 en total)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ecg_api/config.py apps/api/src/ecg_api/main.py apps/api/tests/unit/test_config.py apps/api/tests/unit/test_cors.py
git commit -m "Anadir CORS a la API para el dev server del frontend"
```

---

### Task 2: Scaffold de `apps/web`

Sin lógica todavía — solo el esqueleto de Vite + React + TypeScript + Vitest que las tareas siguientes van a llenar. Verificación por compilación, no por TDD (no hay comportamiento que testear aún).

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/.env.example`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/test-setup.ts`
- Create: `apps/web/src/vite-env.d.ts`

**Interfaces:**
- Produces: el proyecto compila (`npm run build`) y `npm run test` ejecuta sin fallos (todavía sin tests).

- [ ] **Step 1: Crear los ficheros de configuración**

`apps/web/package.json`:

```json
{
  "name": "ecg-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^3.2.6"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simulador de ECG</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/.env.example`:

```
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws/simulation
```

`apps/web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`apps/web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`apps/web/src/App.tsx` (placeholder mínimo — las tareas siguientes lo completan):

```tsx
export function App() {
  return <div>Simulador de ECG</div>;
}
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 2: Instalar dependencias**

Run: `cd apps/web && npm install`
Expected: instala sin errores, crea `package-lock.json`

- [ ] **Step 3: Verificar que compila y que Vitest arranca**

Run: `cd apps/web && npm run build`
Expected: compila sin errores, genera `dist/`

Run: `cd apps/web && npm run test`
Expected: `No test files found` (todavía no hay tests) — código de salida 1 es aceptable aquí porque Vitest lo trata como fallo por defecto; confírmalo con `npm run test -- --passWithNoTests` si el comando anterior no sale limpio.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/.env.example apps/web/src/main.tsx apps/web/src/App.tsx apps/web/src/test-setup.ts apps/web/src/vite-env.d.ts
git commit -m "Scaffold de apps/web: Vite, React, TypeScript, Vitest"
```

---

### Task 3: Tipos compartidos

Espejo exacto de los esquemas de `apps/api/src/ecg_api/schemas.py` — nombres de campo `snake_case` idénticos al backend, sin capa de traducción.

**Files:**
- Create: `apps/web/src/types/engine-params.ts`
- Create: `apps/web/src/types/rhythms.ts`
- Create: `apps/web/src/types/ws-messages.ts`

**Interfaces:**
- Produces: `EngineParamsPayload`, `NoiseParamsPayload`, `VariabilityParamsPayload`, `RhythmSummary`, `RhythmDetail`, `ParameterRange`, `ClientMessage` (unión de `StartMessage | UpdateMessage | PauseMessage | ResumeMessage | StopMessage | PingMessage`), `ServerMessage` (unión de `StartedMessage | UpdatedMessage | PausedMessage | ResumedMessage | StoppedMessage | ErrorMessage`).

Sin tests: son solo declaraciones de tipo, el compilador de TypeScript es la única verificación (las tareas siguientes los importan y el `tsc -b` de `npm run build` falla si algo no encaja).

- [ ] **Step 1: Crear los tipos**

`apps/web/src/types/engine-params.ts`:

```ts
export interface NoiseParamsPayload {
  emg_v: number;
  mains_v: number;
  baseline_v: number;
  motion_v: number;
  clip_v: number | null;
}

export interface VariabilityParamsPayload {
  respiration_hz: number;
  rsa_fraction: number;
  amplitude_fraction: number;
  rr_jitter_fraction: number;
}

export interface EngineParamsPayload {
  heart_rate_hz: number;
  noise: NoiseParamsPayload;
  variability: VariabilityParamsPayload;
}
```

`apps/web/src/types/rhythms.ts`:

```ts
export interface ParameterRange {
  minimum: number;
  maximum: number;
  default: number;
}

export interface RhythmSummary {
  rhythm_id: string;
  display_name: string;
  category: string;
  ventricular_rate_hz: number;
  pr_is_measurable: boolean;
}

export interface RhythmDetail extends RhythmSummary {
  default_parameters: Record<string, number>;
  editable_parameters: Record<string, ParameterRange>;
  clinical_description: string;
  references: string[];
  allowed_overlays: string[];
}
```

`apps/web/src/types/ws-messages.ts`:

```ts
import type { EngineParamsPayload } from "./engine-params";

export interface StartMessage {
  type: "start";
  rhythm_id: string;
  params?: EngineParamsPayload;
  seed?: number;
}

export interface UpdateMessage {
  type: "update";
  params: EngineParamsPayload;
}

export interface PauseMessage {
  type: "pause";
}

export interface ResumeMessage {
  type: "resume";
}

export interface StopMessage {
  type: "stop";
}

export interface PingMessage {
  // Reservado: el backend lo reconoce pero no lo despacha en fase 1 (mide
  // latencia de ida y vuelta, hará falta en fase 2). No hay UI que lo
  // envíe todavía, pero el tipo existe para no romper el contrato cuando
  // se implemente.
  type: "ping";
}

export type ClientMessage =
  | StartMessage
  | UpdateMessage
  | PauseMessage
  | ResumeMessage
  | StopMessage
  | PingMessage;

export interface StartedMessage {
  type: "started";
  session_id: string;
  seed: number;
  sample_rate_hz: number;
  channels: number;
}

export interface UpdatedMessage {
  type: "updated";
  params: EngineParamsPayload;
}

export interface PausedMessage {
  type: "paused";
}

export interface ResumedMessage {
  type: "resumed";
}

export interface StoppedMessage {
  type: "stopped";
  duration_s: number;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  detail: string;
}

export type ServerMessage =
  | StartedMessage
  | UpdatedMessage
  | PausedMessage
  | ResumedMessage
  | StoppedMessage
  | ErrorMessage;
```

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/web && npm run build`
Expected: compila sin errores (los tipos no se usan todavía en ningún sitio, pero deben ser sintácticamente válidos)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/
git commit -m "Anadir los tipos compartidos del contrato REST/WS"
```

---

### Task 4: `frame-decoder.ts`

Decodifica la cabecera binaria de 40 bytes, espejo exacto de `decode_frame` en `apps/api/src/ecg_api/frames.py`. El cliente nunca codifica frames (solo el servidor los produce), así que no hace falta `encodeFrame`.

**Files:**
- Create: `apps/web/src/simulation-runtime/frame-decoder.ts`
- Test: `apps/web/src/simulation-runtime/frame-decoder.test.ts`

**Interfaces:**
- Produces: `DecodedFrame` (interfaz), `decodeFrame(buffer: ArrayBuffer): DecodedFrame`, `HEADER_SIZE_BYTES = 40`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { decodeFrame, HEADER_SIZE_BYTES } from "./frame-decoder";

// Construye un frame de prueba con los mismos offsets que `frames.py`
// (HEADER_FORMAT = "<HHBBHIId16s"): version u16, sample_rate_hz u16,
// n_channels u8, reservado u8, n_samples_per_channel u16,
// sequence_number u32, reservado2 u32, t_start_s f64, session_id 16 bytes.
function buildFrame(options: {
  version?: number;
  sampleRateHz?: number;
  nChannels?: number;
  nSamplesPerChannel?: number;
  sequenceNumber?: number;
  tStartS?: number;
  sessionIdBytes?: number[];
  samples?: number[][]; // [canal][muestra], channel-major
}): ArrayBuffer {
  const nChannels = options.nChannels ?? 2;
  const nSamplesPerChannel = options.nSamplesPerChannel ?? 3;
  const samples =
    options.samples ??
    Array.from({ length: nChannels }, (_, ch) =>
      Array.from({ length: nSamplesPerChannel }, (_, i) => ch * 10 + i)
    );
  const payloadBytes = nChannels * nSamplesPerChannel * 4;
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES + payloadBytes);
  const view = new DataView(buffer);

  view.setUint16(0, options.version ?? 1, true);
  view.setUint16(2, options.sampleRateHz ?? 500, true);
  view.setUint8(4, nChannels);
  view.setUint8(5, 0);
  view.setUint16(6, nSamplesPerChannel, true);
  view.setUint32(8, options.sequenceNumber ?? 0, true);
  view.setUint32(12, 0, true);
  view.setFloat64(16, options.tStartS ?? 0, true);

  const sessionIdBytes =
    options.sessionIdBytes ??
    // UUID "12345678-1234-5678-1234-567812345678" sin guiones, por pares
    [0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78];
  new Uint8Array(buffer, 24, 16).set(sessionIdBytes);

  let offset = HEADER_SIZE_BYTES;
  for (const channel of samples) {
    for (const value of channel) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }

  return buffer;
}

describe("decodeFrame", () => {
  it("decodifica la cabecera con los offsets exactos del contrato", () => {
    const buffer = buildFrame({
      version: 1,
      sampleRateHz: 500,
      nChannels: 2,
      nSamplesPerChannel: 3,
      sequenceNumber: 42,
      tStartS: 1.5,
    });

    const frame = decodeFrame(buffer);

    expect(frame.version).toBe(1);
    expect(frame.sampleRateHz).toBe(500);
    expect(frame.nChannels).toBe(2);
    expect(frame.nSamplesPerChannel).toBe(3);
    expect(frame.sequenceNumber).toBe(42);
    expect(frame.tStartS).toBeCloseTo(1.5);
    expect(frame.sessionId).toBe("12345678-1234-5678-1234-567812345678");
  });

  it("interpreta el payload como float32 channel-major", () => {
    const buffer = buildFrame({
      nChannels: 2,
      nSamplesPerChannel: 3,
      samples: [
        [1, 2, 3],
        [10, 20, 30],
      ],
    });

    const frame = decodeFrame(buffer);

    expect(Array.from(frame.channelsV)).toEqual([1, 2, 3, 10, 20, 30]);
  });

  it("rechaza un buffer más corto que la cabecera", () => {
    const buffer = new ArrayBuffer(HEADER_SIZE_BYTES - 1);
    expect(() => decodeFrame(buffer)).toThrow(/demasiado corto/);
  });

  it("rechaza un payload incompleto", () => {
    const buffer = buildFrame({ nChannels: 2, nSamplesPerChannel: 3 });
    const truncated = buffer.slice(0, HEADER_SIZE_BYTES + 4);
    expect(() => decodeFrame(truncated)).toThrow(/payload incompleto/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/simulation-runtime/frame-decoder.test.ts`
Expected: FAIL — el módulo `./frame-decoder` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
export const HEADER_SIZE_BYTES = 40;

export interface DecodedFrame {
  version: number;
  sampleRateHz: number;
  nChannels: number;
  nSamplesPerChannel: number;
  sequenceNumber: number;
  tStartS: number;
  sessionId: string;
  channelsV: Float32Array;
}

export function decodeFrame(buffer: ArrayBuffer): DecodedFrame {
  if (buffer.byteLength < HEADER_SIZE_BYTES) {
    throw new Error(`frame demasiado corto: ${buffer.byteLength} bytes`);
  }

  const view = new DataView(buffer);
  const version = view.getUint16(0, true);
  const sampleRateHz = view.getUint16(2, true);
  const nChannels = view.getUint8(4);
  // byte 5: reservado
  const nSamplesPerChannel = view.getUint16(6, true);
  const sequenceNumber = view.getUint32(8, true);
  // bytes 12-15: reservado2
  const tStartS = view.getFloat64(16, true);
  const sessionId = formatSessionId(new Uint8Array(buffer, 24, 16));

  const expectedPayloadBytes = nChannels * nSamplesPerChannel * 4;
  if (buffer.byteLength < HEADER_SIZE_BYTES + expectedPayloadBytes) {
    const actualPayloadBytes = buffer.byteLength - HEADER_SIZE_BYTES;
    throw new Error(
      `payload incompleto: esperados ${expectedPayloadBytes} bytes, recibidos ${actualPayloadBytes}`
    );
  }

  // La cabecera de 40 bytes deja el payload alineado a 4 — requisito de
  // `Float32Array` sobre un `ArrayBuffer` compartido, no un tamaño arbitrario.
  const channelsV = new Float32Array(
    buffer,
    HEADER_SIZE_BYTES,
    nChannels * nSamplesPerChannel
  );

  return {
    version,
    sampleRateHz,
    nChannels,
    nSamplesPerChannel,
    sequenceNumber,
    tStartS,
    sessionId,
    channelsV,
  };
}

function formatSessionId(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/simulation-runtime/frame-decoder.test.ts`
Expected: PASS, 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/frame-decoder.ts apps/web/src/simulation-runtime/frame-decoder.test.ts
git commit -m "Anadir el decodificador del frame binario"
```

---

### Task 5: `frame-buffer.ts`

El buffer circular con la política de underrun/overrun. Determinista: `advance(elapsedS)` simula el paso del tiempo de reproducción sin depender de temporizadores reales, así que es testeable sin `sleep`.

**Files:**
- Create: `apps/web/src/simulation-runtime/frame-buffer.ts`
- Test: `apps/web/src/simulation-runtime/frame-buffer.test.ts`

**Interfaces:**
- Consumes: `DecodedFrame` de `./frame-decoder`.
- Produces: `FrameBuffer` con `push(frame)`, `advance(elapsedS)`, `getVisibleSamples(leadIndex)`, `bufferedDurationS` (getter), `isUnderrun` (getter), `clear()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { FrameBuffer } from "./frame-buffer";
import type { DecodedFrame } from "./frame-decoder";

function makeFrame(overrides: Partial<DecodedFrame> = {}): DecodedFrame {
  const nSamplesPerChannel = overrides.nSamplesPerChannel ?? 50;
  const nChannels = overrides.nChannels ?? 2;
  return {
    version: 1,
    sampleRateHz: 500,
    nChannels,
    nSamplesPerChannel,
    sequenceNumber: 0,
    tStartS: 0,
    sessionId: "00000000-0000-0000-0000-000000000000",
    channelsV: new Float32Array(nChannels * nSamplesPerChannel),
    ...overrides,
  };
}

describe("FrameBuffer", () => {
  it("empieza vacío y en underrun", () => {
    const buffer = new FrameBuffer();
    expect(buffer.isUnderrun).toBe(true);
    expect(buffer.bufferedDurationS).toBe(0);
  });

  it("acumula duración al empujar trozos de 100ms (50 muestras a 500Hz)", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
    expect(buffer.isUnderrun).toBe(false);
  });

  it("descarta lo mas antiguo al superar el maximo (overrun)", () => {
    const buffer = new FrameBuffer({ targetS: 0.5, minS: 0.3, maxS: 0.7 });
    for (let i = 0; i < 10; i++) {
      buffer.push(makeFrame({ sequenceNumber: i }));
    }
    expect(buffer.bufferedDurationS).toBeLessThanOrEqual(0.7);
  });

  it("advance() consume trozos completos y respeta los parciales", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame({ sequenceNumber: 0 }));
    buffer.push(makeFrame({ sequenceNumber: 1 }));
    expect(buffer.bufferedDurationS).toBeCloseTo(0.2);

    buffer.advance(0.05); // menos que un trozo (0.1s): no descarta nada
    expect(buffer.bufferedDurationS).toBeCloseTo(0.2);

    buffer.advance(0.1); // consume el primer trozo entero
    expect(buffer.bufferedDurationS).toBeCloseTo(0.1);
  });

  it("advance() mas alla de lo disponible deja el buffer vacio (underrun)", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    buffer.advance(10);
    expect(buffer.bufferedDurationS).toBe(0);
    expect(buffer.isUnderrun).toBe(true);
  });

  it("getVisibleSamples concatena las muestras del canal pedido, en orden de llegada", () => {
    const buffer = new FrameBuffer();
    buffer.push(
      makeFrame({
        nChannels: 2,
        nSamplesPerChannel: 2,
        channelsV: new Float32Array([1, 2, 10, 20]), // canal 0: [1,2], canal 1: [10,20]
      })
    );
    buffer.push(
      makeFrame({
        nChannels: 2,
        nSamplesPerChannel: 2,
        channelsV: new Float32Array([3, 4, 30, 40]),
      })
    );

    expect(Array.from(buffer.getVisibleSamples(0))).toEqual([1, 2, 3, 4]);
    expect(Array.from(buffer.getVisibleSamples(1))).toEqual([10, 20, 30, 40]);
  });

  it("clear() vacia el buffer", () => {
    const buffer = new FrameBuffer();
    buffer.push(makeFrame());
    buffer.clear();
    expect(buffer.isUnderrun).toBe(true);
  });

  it("el coste de push()+advance() no crece con el numero de operaciones", () => {
    // Mismo patrón que el benchmark del motor Python (fase A, tarea 17):
    // medianas de N operaciones antes y después de una ventana larga,
    // umbral relativo en vez de un suelo fijo que un jitter cualquiera
    // dejaría siempre por debajo.
    const buffer = new FrameBuffer();
    const median = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const timeNOperations = (n: number): number[] => {
      const durations: number[] = [];
      for (let i = 0; i < n; i++) {
        const start = performance.now();
        buffer.push(makeFrame({ sequenceNumber: i }));
        buffer.advance(0.1);
        durations.push(performance.now() - start);
      }
      return durations;
    };

    const early = median(timeNOperations(25));
    for (let i = 0; i < 5000; i++) {
      buffer.push(makeFrame({ sequenceNumber: i }));
      buffer.advance(0.1);
    }
    const late = median(timeNOperations(25));

    expect(late).toBeLessThan(Math.max(early * 4, 1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/simulation-runtime/frame-buffer.test.ts`
Expected: FAIL — el módulo `./frame-buffer` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DecodedFrame } from "./frame-decoder";

export interface FrameBufferOptions {
  targetS?: number;
  minS?: number;
  maxS?: number;
}

export class FrameBuffer {
  readonly targetS: number;
  readonly minS: number;
  readonly maxS: number;

  private frames: DecodedFrame[] = [];

  constructor(options: FrameBufferOptions = {}) {
    this.targetS = options.targetS ?? 0.5;
    this.minS = options.minS ?? 0.3;
    this.maxS = options.maxS ?? 0.7;
  }

  private frameDurationS(frame: DecodedFrame): number {
    return frame.nSamplesPerChannel / frame.sampleRateHz;
  }

  get bufferedDurationS(): number {
    return this.frames.reduce((sum, frame) => sum + this.frameDurationS(frame), 0);
  }

  get isUnderrun(): boolean {
    return this.frames.length === 0;
  }

  push(frame: DecodedFrame): void {
    this.frames.push(frame);
    while (this.bufferedDurationS > this.maxS && this.frames.length > 1) {
      this.frames.shift();
    }
  }

  /** Simula el paso de `elapsedS` segundos de reproducción, descartando los
   * trozos ya consumidos por completo. Determinista: no depende del reloj
   * real, así que se puede testear sin temporizadores. */
  advance(elapsedS: number): void {
    let remaining = elapsedS;
    while (remaining > 0 && this.frames.length > 0) {
      const oldest = this.frames[0];
      const duration = this.frameDurationS(oldest);
      if (duration > remaining) {
        break;
      }
      this.frames.shift();
      remaining -= duration;
    }
  }

  getVisibleSamples(leadIndex: number): Float32Array {
    const totalSamples = this.frames.reduce(
      (sum, frame) => sum + frame.nSamplesPerChannel,
      0
    );
    const result = new Float32Array(totalSamples);
    let offset = 0;
    for (const frame of this.frames) {
      const start = leadIndex * frame.nSamplesPerChannel;
      result.set(
        frame.channelsV.subarray(start, start + frame.nSamplesPerChannel),
        offset
      );
      offset += frame.nSamplesPerChannel;
    }
    return result;
  }

  clear(): void {
    this.frames = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/simulation-runtime/frame-buffer.test.ts`
Expected: PASS, 8 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/frame-buffer.ts apps/web/src/simulation-runtime/frame-buffer.test.ts
git commit -m "Anadir el buffer circular con la politica de underrun/overrun"
```

---

### Task 6: `event-emitter.ts`

Un `EventEmitter` genérico y tipado, sin dependencias externas — lo suficiente para que `SessionRuntime` (tarea 8) emita eventos y React se suscriba sin dirigir el runtime.

**Files:**
- Create: `apps/web/src/simulation-runtime/event-emitter.ts`
- Test: `apps/web/src/simulation-runtime/event-emitter.test.ts`

**Interfaces:**
- Produces: `TypedEventEmitter<Events extends Record<string, unknown>>` con `on(event, listener)`, `off(event, listener)`, `emit(event, payload)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./event-emitter";

interface TestEvents {
  greeting: { message: string };
  count: number;
}

describe("TypedEventEmitter", () => {
  it("llama a los listeners suscritos con el payload emitido", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("greeting", listener);

    emitter.emit("greeting", { message: "hola" });

    expect(listener).toHaveBeenCalledWith({ message: "hola" });
  });

  it("soporta varios listeners para el mismo evento", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();
    emitter.on("count", first);
    emitter.on("count", second);

    emitter.emit("count", 5);

    expect(first).toHaveBeenCalledWith(5);
    expect(second).toHaveBeenCalledWith(5);
  });

  it("off() deja de llamar al listener retirado", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("count", listener);
    emitter.off("count", listener);

    emitter.emit("count", 1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("emitir un evento sin listeners no lanza", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    expect(() => emitter.emit("count", 1)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/simulation-runtime/event-emitter.test.ts`
Expected: FAIL — el módulo `./event-emitter` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
type Listener<T> = (payload: T) => void;

export class TypedEventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const set = this.listeners.get(event) ?? new Set<Listener<unknown>>();
    set.add(listener as Listener<unknown>);
    this.listeners.set(event, set);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/simulation-runtime/event-emitter.test.ts`
Expected: PASS, 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/event-emitter.ts apps/web/src/simulation-runtime/event-emitter.test.ts
git commit -m "Anadir un EventEmitter tipado generico"
```

---

### Task 7: `websocket-client.ts`

Envoltorio fino sobre `WebSocket`, con una fábrica inyectable para poder testear sin abrir un socket real.

**Files:**
- Create: `apps/web/src/simulation-runtime/websocket-client.ts`
- Test: `apps/web/src/simulation-runtime/websocket-client.test.ts`

**Interfaces:**
- Produces: `WebSocketClient` con `connect()`, `sendJson(message: unknown)`, `close()`, y los callbacks `onOpen`, `onTextMessage`, `onBinaryMessage`, `onClose`, `onError`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { WebSocketClient } from "./websocket-client";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sentMessages: unknown[] = [];
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(data: unknown): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code: 1000, reason: "cierre normal" });
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("WebSocketClient", () => {
  it("conecta usando la fabrica inyectada y fija binaryType a arraybuffer", () => {
    const fake = new FakeWebSocket();
    const factory = vi.fn().mockReturnValue(fake);
    const client = new WebSocketClient({ url: "ws://test", webSocketFactory: factory });

    client.connect();

    expect(factory).toHaveBeenCalledWith("ws://test");
    expect(fake.binaryType).toBe("arraybuffer");
  });

  it("llama a onOpen cuando el socket abre", () => {
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onOpen = vi.fn();
    client.onOpen = onOpen;

    client.connect();
    fake.dispatch("open", {});

    expect(onOpen).toHaveBeenCalled();
  });

  it("dirige mensajes de texto y binarios a sus callbacks respectivos", () => {
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onText = vi.fn();
    const onBinary = vi.fn();
    client.onTextMessage = onText;
    client.onBinaryMessage = onBinary;

    client.connect();
    fake.dispatch("message", { data: '{"type":"started"}' });
    const buffer = new ArrayBuffer(4);
    fake.dispatch("message", { data: buffer });

    expect(onText).toHaveBeenCalledWith('{"type":"started"}');
    expect(onBinary).toHaveBeenCalledWith(buffer);
  });

  it("sendJson serializa el mensaje cuando el socket esta abierto", () => {
    const fake = new FakeWebSocket();
    fake.readyState = FakeWebSocket.OPEN;
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });

    client.connect();
    client.sendJson({ type: "stop" });

    expect(fake.sentMessages).toEqual(['{"type":"stop"}']);
  });

  it("sendJson lanza si el socket no esta abierto", () => {
    const fake = new FakeWebSocket();
    fake.readyState = FakeWebSocket.CONNECTING;
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });

    client.connect();

    expect(() => client.sendJson({ type: "stop" })).toThrow(/sin conexión abierta/);
  });

  it("llama a onClose con el codigo y la razon", () => {
    const fake = new FakeWebSocket();
    const client = new WebSocketClient({
      url: "ws://test",
      webSocketFactory: () => fake as unknown as WebSocket,
    });
    const onClose = vi.fn();
    client.onClose = onClose;

    client.connect();
    fake.close();

    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: "cierre normal" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/simulation-runtime/websocket-client.test.ts`
Expected: FAIL — el módulo `./websocket-client` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
export interface WebSocketClientOptions {
  url: string;
  webSocketFactory?: (url: string) => WebSocket;
}

export type BinaryMessageHandler = (data: ArrayBuffer) => void;
export type TextMessageHandler = (data: string) => void;
export type CloseHandler = (event: { code: number; reason: string }) => void;

export class WebSocketClient {
  onOpen: (() => void) | null = null;
  onTextMessage: TextMessageHandler | null = null;
  onBinaryMessage: BinaryMessageHandler | null = null;
  onClose: CloseHandler | null = null;
  onError: ((error: unknown) => void) | null = null;

  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly factory: (url: string) => WebSocket;

  constructor(options: WebSocketClientOptions) {
    this.url = options.url;
    this.factory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  connect(): void {
    const socket = this.factory(this.url);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => this.onOpen?.());
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") {
        this.onTextMessage?.(event.data);
      } else {
        this.onBinaryMessage?.(event.data as ArrayBuffer);
      }
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      this.onClose?.({ code: event.code, reason: event.reason });
    });
    socket.addEventListener("error", (event: Event) => {
      this.onError?.(event);
    });
    this.socket = socket;
  }

  sendJson(message: unknown): void {
    if (!this.socket || this.socket.readyState !== 1 /* WebSocket.OPEN */) {
      throw new Error("WebSocketClient: intento de enviar sin conexión abierta");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/simulation-runtime/websocket-client.test.ts`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/websocket-client.ts apps/web/src/simulation-runtime/websocket-client.test.ts
git commit -m "Anadir el envoltorio de WebSocket inyectable"
```

---

### Task 8: `session-runtime.ts`

La máquina de estados que compone `WebSocketClient`, `decodeFrame`, `FrameBuffer` y `TypedEventEmitter`. El corazón de `simulation-runtime`.

**Files:**
- Create: `apps/web/src/simulation-runtime/session-runtime.ts`
- Test: `apps/web/src/simulation-runtime/session-runtime.test.ts`

**Interfaces:**
- Consumes: `WebSocketClient` (tarea 7), `decodeFrame` (tarea 4), `FrameBuffer` (tarea 5), `TypedEventEmitter` (tarea 6), tipos de `../types/ws-messages` y `../types/engine-params` (tarea 3).
- Produces: `SessionRuntime` (extiende `TypedEventEmitter<SessionRuntimeEvents>`) con `connect()`, `disconnect()`, `start(rhythmId, params?, seed?)`, `update(params)`, `pause()`, `resume()`, `stop()`, la propiedad `buffer: FrameBuffer`, y `state: SessionState`. Eventos: `connected`, `disconnected`, `started`, `updated`, `paused`, `resumed`, `stopped`, `error`, `frameMeta`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "./session-runtime";
import { HEADER_SIZE_BYTES } from "./frame-decoder";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
  sentMessages: string[] = [];
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.dispatch("close", { code: 1000, reason: "" });
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }

  lastSentMessage(): unknown {
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]);
  }
}

function buildFrameBytes(options: {
  sequenceNumber: number;
  sessionIdBytes?: number[];
}): ArrayBuffer {
  const nChannels = 1;
  const nSamplesPerChannel = 2;
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES + nChannels * nSamplesPerChannel * 4);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 500, true);
  view.setUint8(4, nChannels);
  view.setUint8(5, 0);
  view.setUint16(6, nSamplesPerChannel, true);
  view.setUint32(8, options.sequenceNumber, true);
  view.setUint32(12, 0, true);
  view.setFloat64(16, 0, true);
  const sessionIdBytes = options.sessionIdBytes ?? new Array(16).fill(0xab);
  new Uint8Array(buffer, 24, 16).set(sessionIdBytes);
  view.setFloat32(HEADER_SIZE_BYTES, 0.1, true);
  view.setFloat32(HEADER_SIZE_BYTES + 4, 0.2, true);
  return buffer;
}

describe("SessionRuntime", () => {
  it("emite 'connected' y pasa a estado connected cuando el socket abre", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onConnected = vi.fn();
    runtime.on("connected", onConnected);

    runtime.connect();
    fake.dispatch("open", {});

    expect(onConnected).toHaveBeenCalled();
    expect(runtime.state).toBe("connected");
  });

  it("start() envia el mensaje 'start' con los campos documentados", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();

    runtime.start("sinus_normal", { heart_rate_hz: 70 / 60, noise: { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null }, variability: { respiration_hz: 0.25, rsa_fraction: 0.04, amplitude_fraction: 0.03, rr_jitter_fraction: 0.015 } }, 123);

    expect(fake.lastSentMessage()).toMatchObject({
      type: "start",
      rhythm_id: "sinus_normal",
      seed: 123,
    });
  });

  it("al recibir 'started' pasa a running y limpia el buffer", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onStarted = vi.fn();
    runtime.on("started", onStarted);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "11111111-1111-1111-1111-111111111111",
        seed: 1,
        sample_rate_hz: 500,
        channels: 12,
      }),
    });

    expect(runtime.state).toBe("running");
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "11111111-1111-1111-1111-111111111111" })
    );
    expect(runtime.buffer.isUnderrun).toBe(true);
  });

  it("decodifica frames binarios y los empuja al buffer", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();

    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 0 }) });

    expect(runtime.buffer.isUnderrun).toBe(false);
    expect(Array.from(runtime.buffer.getVisibleSamples(0))).toEqual([0.1, 0.2]);
  });

  it("descarta un frame fuera de orden sin empujarlo al buffer", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    runtime.connect();

    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 5 }) });
    const durationAfterFirst = runtime.buffer.bufferedDurationS;
    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 3 }) }); // fuera de orden

    expect(runtime.buffer.bufferedDurationS).toBe(durationAfterFirst);
  });

  it("marca frameMeta.lost=true cuando sequence_number salta hacia delante", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onFrameMeta = vi.fn();
    runtime.on("frameMeta", onFrameMeta);
    runtime.connect();

    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 0 }) });
    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 2 }) }); // se perdió el 1

    expect(onFrameMeta).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequenceNumber: 2, lost: true })
    );
  });

  it("emite 'error' al recibir un mensaje error del servidor", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onError = vi.fn();
    runtime.on("error", onError);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({ type: "error", code: "NOT_FOUND", detail: "ritmo desconocido" }),
    });

    expect(onError).toHaveBeenCalledWith({ code: "NOT_FOUND", detail: "ritmo desconocido" });
  });

  it("al desconectar limpia el buffer y vuelve a idle, sin reconectar", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    const onDisconnected = vi.fn();
    runtime.on("disconnected", onDisconnected);
    runtime.connect();
    fake.dispatch("message", { data: buildFrameBytes({ sequenceNumber: 0 }) });

    fake.close();

    expect(runtime.state).toBe("idle");
    expect(runtime.buffer.isUnderrun).toBe(true);
    expect(onDisconnected).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/simulation-runtime/session-runtime.test.ts`
Expected: FAIL — el módulo `./session-runtime` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
import { TypedEventEmitter } from "./event-emitter";
import { WebSocketClient } from "./websocket-client";
import { decodeFrame } from "./frame-decoder";
import { FrameBuffer } from "./frame-buffer";
import type {
  ClientMessage,
  ErrorMessage,
  PausedMessage,
  ResumedMessage,
  ServerMessage,
  StartedMessage,
  StoppedMessage,
  UpdatedMessage,
} from "../types/ws-messages";
import type { EngineParamsPayload } from "../types/engine-params";

export type SessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "running"
  | "paused"
  | "stopped";

export interface SessionRuntimeEvents {
  connected: Record<string, never>;
  disconnected: { code: number; reason: string };
  started: StartedMessage;
  updated: UpdatedMessage;
  paused: PausedMessage;
  resumed: ResumedMessage;
  stopped: StoppedMessage;
  error: ErrorMessage;
  frameMeta: { sequenceNumber: number; lost: boolean; sessionId: string };
}

export class SessionRuntime extends TypedEventEmitter<SessionRuntimeEvents> {
  readonly buffer = new FrameBuffer();
  state: SessionState = "idle";

  private readonly ws: WebSocketClient;
  private lastSequenceNumber: number | null = null;
  private lastSessionId: string | null = null;

  constructor(wsUrl: string, webSocketFactory?: (url: string) => WebSocket) {
    super();
    this.ws = new WebSocketClient({ url: wsUrl, webSocketFactory });
    this.ws.onOpen = () => {
      this.state = "connected";
      this.emit("connected", {});
    };
    this.ws.onTextMessage = (raw) => {
      this.handleServerMessage(JSON.parse(raw) as ServerMessage);
    };
    this.ws.onBinaryMessage = (data) => this.handleFrame(data);
    this.ws.onClose = ({ code, reason }) => {
      this.state = "idle";
      this.buffer.clear();
      this.lastSequenceNumber = null;
      this.lastSessionId = null;
      this.emit("disconnected", { code, reason });
    };
  }

  connect(): void {
    this.state = "connecting";
    this.ws.connect();
  }

  disconnect(): void {
    this.ws.close();
  }

  start(rhythmId: string, params?: EngineParamsPayload, seed?: number): void {
    this.send({ type: "start", rhythm_id: rhythmId, params, seed });
  }

  update(params: EngineParamsPayload): void {
    this.send({ type: "update", params });
  }

  pause(): void {
    this.send({ type: "pause" });
  }

  resume(): void {
    this.send({ type: "resume" });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  private send(message: ClientMessage): void {
    this.ws.sendJson(message);
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "started":
        this.state = "running";
        this.lastSequenceNumber = null;
        this.lastSessionId = message.session_id;
        this.buffer.clear();
        this.emit("started", message);
        break;
      case "updated":
        this.emit("updated", message);
        break;
      case "paused":
        this.state = "paused";
        this.emit("paused", message);
        break;
      case "resumed":
        this.state = "running";
        this.emit("resumed", message);
        break;
      case "stopped":
        this.state = "stopped";
        this.emit("stopped", message);
        break;
      case "error":
        this.emit("error", message);
        break;
    }
  }

  private handleFrame(data: ArrayBuffer): void {
    const frame = decodeFrame(data);

    if (frame.sessionId !== this.lastSessionId) {
      this.lastSequenceNumber = null;
      this.lastSessionId = frame.sessionId;
    }

    if (this.lastSequenceNumber !== null && frame.sequenceNumber <= this.lastSequenceNumber) {
      // Fuera de orden: se descarta, no se añade al buffer ni se cuenta
      // como pérdida (podría ser un duplicado de red, no un hueco real).
      return;
    }

    const lost =
      this.lastSequenceNumber !== null &&
      frame.sequenceNumber > this.lastSequenceNumber + 1;

    this.lastSequenceNumber = frame.sequenceNumber;
    this.buffer.push(frame);
    this.emit("frameMeta", {
      sequenceNumber: frame.sequenceNumber,
      lost,
      sessionId: frame.sessionId,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/simulation-runtime/session-runtime.test.ts`
Expected: PASS, 8 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/session-runtime.ts apps/web/src/simulation-runtime/session-runtime.test.ts
git commit -m "Anadir la maquina de estados del runtime de simulacion"
```

---

### Task 9: `catalog-client.ts`

Cliente REST para `GET /api/rhythms` y `GET /api/rhythms/{id}`.

**Files:**
- Create: `apps/web/src/simulation-runtime/catalog-client.ts`
- Test: `apps/web/src/simulation-runtime/catalog-client.test.ts`

**Interfaces:**
- Consumes: `RhythmSummary`, `RhythmDetail` de `../types/rhythms` (tarea 3).
- Produces: `CatalogClient` con `listRhythms(): Promise<RhythmSummary[]>`, `getRhythm(rhythmId: string): Promise<RhythmDetail>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { CatalogClient } from "./catalog-client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("CatalogClient", () => {
  it("listRhythms llama a GET /api/rhythms y devuelve el JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ rhythm_id: "sinus_normal", display_name: "Sinusal", category: "sinus", ventricular_rate_hz: 1.1667, pr_is_measurable: true }])
    );
    const client = new CatalogClient({ baseUrl: "http://api.test", fetchImpl });

    const rhythms = await client.listRhythms();

    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/rhythms");
    expect(rhythms).toHaveLength(1);
    expect(rhythms[0].rhythm_id).toBe("sinus_normal");
  });

  it("getRhythm llama a GET /api/rhythms/{id} codificando el id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        rhythm_id: "sinus_normal",
        display_name: "Sinusal",
        category: "sinus",
        ventricular_rate_hz: 1.1667,
        pr_is_measurable: true,
        default_parameters: { heart_rate_hz: 1.1667 },
        editable_parameters: { heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 } },
        clinical_description: "...",
        references: [],
        allowed_overlays: [],
      })
    );
    const client = new CatalogClient({ baseUrl: "http://api.test/", fetchImpl });

    const detail = await client.getRhythm("sinus_normal");

    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/rhythms/sinus_normal");
    expect(detail.editable_parameters.heart_rate_hz.maximum).toBeCloseTo(1.6667);
  });

  it("lanza si la respuesta no es ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 404));
    const client = new CatalogClient({ baseUrl: "http://api.test", fetchImpl });

    await expect(client.getRhythm("no_existe")).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/simulation-runtime/catalog-client.test.ts`
Expected: FAIL — el módulo `./catalog-client` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/simulation-runtime/catalog-client.test.ts`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/simulation-runtime/catalog-client.ts apps/web/src/simulation-runtime/catalog-client.test.ts
git commit -m "Anadir el cliente REST del catalogo de ritmos"
```

---

### Task 10: `state/session-store.ts`

Zustand, escucha los eventos de un `SessionRuntime` y guarda solo estado de interfaz derivado — nunca el buffer de muestras.

**Files:**
- Create: `apps/web/src/state/session-store.ts`
- Test: `apps/web/src/state/session-store.test.ts`

**Interfaces:**
- Consumes: `SessionRuntime`, `SessionState` de `../simulation-runtime/session-runtime` (tarea 8); `EngineParamsPayload` de `../types/engine-params` (tarea 3).
- Produces: hook `useSessionStore` con el estado `connectionState`, `sessionId`, `seed`, `sampleRateHz`, `selectedRhythmId`, `params`, `lastError`, `framesLost`, y las acciones `selectRhythm(rhythmId)`, `attachRuntime(runtime)`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "./session-store";
import { SessionRuntime } from "../simulation-runtime/session-runtime";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(): void {}
  close(): void {
    this.dispatch("close", { code: 1000, reason: "" });
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      connectionState: "idle",
      sessionId: null,
      seed: null,
      sampleRateHz: null,
      selectedRhythmId: null,
      params: null,
      lastError: null,
      framesLost: 0,
    });
  });

  it("selectRhythm fija el ritmo seleccionado", () => {
    useSessionStore.getState().selectRhythm("sinus_normal");
    expect(useSessionStore.getState().selectedRhythmId).toBe("sinus_normal");
  });

  it("refleja los eventos del runtime adjunto", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);

    runtime.connect();
    fake.dispatch("open", {});
    expect(useSessionStore.getState().connectionState).toBe("connected");

    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started",
        session_id: "22222222-2222-2222-2222-222222222222",
        seed: 42,
        sample_rate_hz: 500,
        channels: 12,
      }),
    });

    const state = useSessionStore.getState();
    expect(state.connectionState).toBe("running");
    expect(state.sessionId).toBe("22222222-2222-2222-2222-222222222222");
    expect(state.seed).toBe(42);
    expect(state.sampleRateHz).toBe(500);
  });

  it("cuenta framesLost cuando el runtime reporta perdida", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();

    runtime.emit("frameMeta", { sequenceNumber: 5, lost: true, sessionId: "x" });
    runtime.emit("frameMeta", { sequenceNumber: 6, lost: false, sessionId: "x" });

    expect(useSessionStore.getState().framesLost).toBe(1);
  });

  it("guarda el error del servidor", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();

    fake.dispatch("message", {
      data: JSON.stringify({ type: "error", code: "NOT_FOUND", detail: "ritmo desconocido" }),
    });

    expect(useSessionStore.getState().lastError).toEqual({
      code: "NOT_FOUND",
      detail: "ritmo desconocido",
    });
  });

  it("al desconectar limpia session_id/seed pero conserva selectedRhythmId", () => {
    const fake = new FakeWebSocket();
    const runtime = new SessionRuntime("ws://test", () => fake as unknown as WebSocket);
    useSessionStore.getState().selectRhythm("sinus_normal");
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    fake.dispatch("message", {
      data: JSON.stringify({
        type: "started", session_id: "s", seed: 1, sample_rate_hz: 500, channels: 12,
      }),
    });

    fake.close();

    const state = useSessionStore.getState();
    expect(state.connectionState).toBe("idle");
    expect(state.sessionId).toBeNull();
    expect(state.selectedRhythmId).toBe("sinus_normal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/state/session-store.test.ts`
Expected: FAIL — el módulo `./session-store` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
import { create } from "zustand";
import type { SessionRuntime, SessionState } from "../simulation-runtime/session-runtime";
import type { EngineParamsPayload } from "../types/engine-params";

export interface SessionStoreState {
  connectionState: SessionState;
  sessionId: string | null;
  seed: number | null;
  sampleRateHz: number | null;
  selectedRhythmId: string | null;
  params: EngineParamsPayload | null;
  lastError: { code: string; detail: string } | null;
  framesLost: number;

  selectRhythm: (rhythmId: string) => void;
  attachRuntime: (runtime: SessionRuntime) => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  connectionState: "idle",
  sessionId: null,
  seed: null,
  sampleRateHz: null,
  selectedRhythmId: null,
  params: null,
  lastError: null,
  framesLost: 0,

  selectRhythm: (rhythmId) => set({ selectedRhythmId: rhythmId }),

  attachRuntime: (runtime) => {
    runtime.on("connected", () => set({ connectionState: "connected" }));
    runtime.on("disconnected", () =>
      set({ connectionState: "idle", sessionId: null, seed: null, sampleRateHz: null })
    );
    runtime.on("started", (message) =>
      set({
        connectionState: "running",
        sessionId: message.session_id,
        seed: message.seed,
        sampleRateHz: message.sample_rate_hz,
        lastError: null,
        framesLost: 0,
      })
    );
    runtime.on("updated", (message) => set({ params: message.params }));
    runtime.on("paused", () => set({ connectionState: "paused" }));
    runtime.on("resumed", () => set({ connectionState: "running" }));
    runtime.on("stopped", () => set({ connectionState: "stopped" }));
    runtime.on("error", (message) =>
      set({ lastError: { code: message.code, detail: message.detail } })
    );
    runtime.on("frameMeta", (meta) => {
      if (meta.lost) {
        set((state) => ({ framesLost: state.framesLost + 1 }));
      }
    });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/state/session-store.test.ts`
Expected: PASS, 5 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/session-store.ts apps/web/src/state/session-store.test.ts
git commit -m "Anadir el store de Zustand con el estado de interfaz"
```

---

### Task 11: `render/layout.ts`

Orden canónico de derivaciones y los layouts de 1/3/6/12.

**Files:**
- Create: `apps/web/src/render/layout.ts`
- Test: `apps/web/src/render/layout.test.ts`

**Interfaces:**
- Produces: `LEAD_ORDER` (tupla de 12 nombres), `LeadName`, `LayoutId` (`"1" | "3" | "6" | "12"`), `leadsForLayout(layout)`, `leadIndex(lead)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { LEAD_ORDER, leadIndex, leadsForLayout } from "./layout";

describe("layout", () => {
  it("LEAD_ORDER tiene las 12 derivaciones en el orden canonico del contrato", () => {
    expect(LEAD_ORDER).toEqual([
      "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6",
    ]);
  });

  it("leadIndex devuelve la posicion en LEAD_ORDER", () => {
    expect(leadIndex("I")).toBe(0);
    expect(leadIndex("V6")).toBe(11);
  });

  it("layout 1 muestra solo II", () => {
    expect(leadsForLayout("1")).toEqual(["II"]);
  });

  it("layout 12 muestra las 12 en orden canonico", () => {
    expect(leadsForLayout("12")).toEqual(LEAD_ORDER);
  });

  it("layout 3 y 6 son subconjuntos que empiezan por I, II, III", () => {
    expect(leadsForLayout("3")).toEqual(["I", "II", "III"]);
    expect(leadsForLayout("6").slice(0, 3)).toEqual(["I", "II", "III"]);
    expect(leadsForLayout("6")).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/render/layout.test.ts`
Expected: FAIL — el módulo `./layout` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/render/layout.test.ts`
Expected: PASS, 5 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render/layout.ts apps/web/src/render/layout.test.ts
git commit -m "Anadir el orden canonico de derivaciones y los layouts"
```

---

### Task 12: `render/grid-layer.ts`

La rejilla clínica: menor de 1mm, mayor de 5mm. Se separa el cálculo puro (`computeGridLines`, testeado a fondo) del dibujo sobre `CanvasRenderingContext2D` (`drawGrid`, testeado con un contexto simulado).

**Files:**
- Create: `apps/web/src/render/grid-layer.ts`
- Test: `apps/web/src/render/grid-layer.test.ts`

**Interfaces:**
- Produces: `PX_PER_MM`, `timeToPx(tS, paperSpeedMmS)`, `voltageToPx(vVolts, gainMmPerMv)`, `computeGridLines(widthPx, heightPx)`, `drawGrid(ctx, widthPx, heightPx)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { PX_PER_MM, computeGridLines, drawGrid, timeToPx, voltageToPx } from "./grid-layer";

describe("timeToPx / voltageToPx", () => {
  it("a 25mm/s, 1mm equivale a 40ms (seccion 9 del spec)", () => {
    const pxPerMm = PX_PER_MM;
    const px40ms = timeToPx(0.04, 25);
    expect(px40ms).toBeCloseTo(pxPerMm, 5);
  });

  it("voltageToPx convierte voltios a mm con la calibracion 10mm/mV", () => {
    // 1 mV con ganancia 10mm/mV -> 10mm
    const px = voltageToPx(0.001, 10);
    expect(px).toBeCloseTo(10 * PX_PER_MM, 5);
  });
});

describe("computeGridLines", () => {
  it("coloca una linea mayor cada 5 menores", () => {
    const widthPx = PX_PER_MM * 10; // 10mm de ancho -> 11 lineas menores (0..10mm)
    const lines = computeGridLines(widthPx, widthPx);

    expect(lines.verticalMinor.length).toBeGreaterThan(lines.verticalMajor.length);
    // la primera linea mayor coincide con la primera menor (x=0)
    expect(lines.verticalMajor[0]).toBeCloseTo(0);
    // la segunda linea mayor esta 5mm mas alla
    expect(lines.verticalMajor[1]).toBeCloseTo(5 * PX_PER_MM, 5);
  });
});

describe("drawGrid", () => {
  it("dibuja tantos segmentos como lineas devuelve computeGridLines", () => {
    const widthPx = PX_PER_MM * 10;
    const heightPx = PX_PER_MM * 10;
    const lines = computeGridLines(widthPx, heightPx);
    const expectedSegments =
      lines.verticalMinor.length + lines.horizontalMinor.length +
      lines.verticalMajor.length + lines.horizontalMajor.length;

    const ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, widthPx, heightPx);

    expect(ctx.moveTo).toHaveBeenCalledTimes(expectedSegments);
    expect(ctx.lineTo).toHaveBeenCalledTimes(expectedSegments);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/render/grid-layer.test.ts`
Expected: FAIL — el módulo `./grid-layer` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
// Asume 96 CSS px por pulgada (estándar del navegador para `px`), como
// unidad de referencia para pasar de milímetros de papel a píxeles.
export const PX_PER_MM = 96 / 25.4;

export function timeToPx(tS: number, paperSpeedMmS: number): number {
  return tS * paperSpeedMmS * PX_PER_MM;
}

export function voltageToPx(vVolts: number, gainMmPerMv: number): number {
  const mv = vVolts * 1000;
  return mv * gainMmPerMv * PX_PER_MM;
}

export interface GridLines {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
}

const MINOR_SPACING_MM = 1;
const MAJOR_EVERY_N_MINOR = 5;

export function computeGridLines(widthPx: number, heightPx: number): GridLines {
  const spacingPx = MINOR_SPACING_MM * PX_PER_MM;

  const verticalMinor: number[] = [];
  const verticalMajor: number[] = [];
  for (let i = 0; i * spacingPx <= widthPx; i++) {
    const x = i * spacingPx;
    verticalMinor.push(x);
    if (i % MAJOR_EVERY_N_MINOR === 0) verticalMajor.push(x);
  }

  const horizontalMinor: number[] = [];
  const horizontalMajor: number[] = [];
  for (let i = 0; i * spacingPx <= heightPx; i++) {
    const y = i * spacingPx;
    horizontalMinor.push(y);
    if (i % MAJOR_EVERY_N_MINOR === 0) horizontalMajor.push(y);
  }

  return { verticalMinor, verticalMajor, horizontalMinor, horizontalMajor };
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number
): void {
  const lines = computeGridLines(widthPx, heightPx);
  ctx.clearRect(0, 0, widthPx, heightPx);

  ctx.strokeStyle = "#f4c6c6";
  ctx.lineWidth = 0.5;
  for (const x of lines.verticalMinor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMinor) drawLine(ctx, 0, y, widthPx, y);

  ctx.strokeStyle = "#e08080";
  ctx.lineWidth = 1;
  for (const x of lines.verticalMajor) drawLine(ctx, x, 0, x, heightPx);
  for (const y of lines.horizontalMajor) drawLine(ctx, 0, y, widthPx, y);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/render/grid-layer.test.ts`
Expected: PASS, 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render/grid-layer.ts apps/web/src/render/grid-layer.test.ts
git commit -m "Anadir la rejilla clinica prerenderizable"
```

---

### Task 13: `render/lead-canvas.ts`

El trazo por derivación, más `OverlayLayer` (reservado, sin funcionalidad esta fase).

**Files:**
- Create: `apps/web/src/render/lead-canvas.ts`
- Test: `apps/web/src/render/lead-canvas.test.ts`

**Interfaces:**
- Consumes: `timeToPx`, `voltageToPx` de `./grid-layer` (tarea 12).
- Produces: `drawLeadTrace(ctx, samples, sampleRateHz, options, heightPx)`, `OverlayLayer` con `draw(ctx, widthPx, heightPx)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { OverlayLayer, drawLeadTrace } from "./lead-canvas";
import { timeToPx, voltageToPx } from "./grid-layer";

function makeCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
    canvas: { width: 800 },
  } as unknown as CanvasRenderingContext2D;
}

describe("drawLeadTrace", () => {
  it("mueve al primer punto y traza una linea al resto, con las coordenadas esperadas", () => {
    const ctx = makeCtx();
    const samples = new Float32Array([0, 0.001, -0.001]); // voltios
    const heightPx = 100;
    const options = { paperSpeedMmS: 25, gainMmPerMv: 10 };

    drawLeadTrace(ctx, samples, 500, options, heightPx);

    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);

    const baselineY = heightPx / 2;
    const [x0, y0] = (ctx.moveTo as any).mock.calls[0];
    expect(x0).toBeCloseTo(timeToPx(0, 25));
    expect(y0).toBeCloseTo(baselineY - voltageToPx(0, 10));

    const [x1, y1] = (ctx.lineTo as any).mock.calls[0];
    expect(x1).toBeCloseTo(timeToPx(1 / 500, 25));
    expect(y1).toBeCloseTo(baselineY - voltageToPx(0.001, 10));
  });

  it("no dibuja nada con un array vacio", () => {
    const ctx = makeCtx();
    drawLeadTrace(ctx, new Float32Array([]), 500, { paperSpeedMmS: 25, gainMmPerMv: 10 }, 100);
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });
});

describe("OverlayLayer", () => {
  it("draw() es inerte: no lanza y no dibuja nada (reservado para esta fase)", () => {
    const ctx = makeCtx();
    const overlay = new OverlayLayer();

    expect(() => overlay.draw(ctx, 800, 100)).not.toThrow();
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/render/lead-canvas.test.ts`
Expected: FAIL — el módulo `./lead-canvas` no existe

- [ ] **Step 3: Write minimal implementation**

```ts
import { timeToPx, voltageToPx } from "./grid-layer";

export interface LeadCanvasOptions {
  paperSpeedMmS: number;
  gainMmPerMv: number;
}

export function drawLeadTrace(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  sampleRateHz: number,
  options: LeadCanvasOptions,
  heightPx: number
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, heightPx);
  if (samples.length === 0) {
    return;
  }

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.beginPath();

  const dtS = 1 / sampleRateHz;
  const baselineY = heightPx / 2;

  for (let i = 0; i < samples.length; i++) {
    const x = timeToPx(i * dtS, options.paperSpeedMmS);
    const y = baselineY - voltageToPx(samples[i], options.gainMmPerMv);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

/** Capa superior para medidas e interacción (cursores, calipers). Sin
 * funcionalidad en esta fase — el hueco existe en la arquitectura para no
 * tener que replanificar el layout cuando se implemente. */
export class OverlayLayer {
  draw(_ctx: CanvasRenderingContext2D, _widthPx: number, _heightPx: number): void {
    // Reservado.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/render/lead-canvas.test.ts`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render/lead-canvas.ts apps/web/src/render/lead-canvas.test.ts
git commit -m "Anadir el trazado por derivacion y el overlay reservado"
```

---

### Task 14: `ui/RhythmSelector.tsx`

**Files:**
- Create: `apps/web/src/ui/RhythmSelector.tsx`
- Test: `apps/web/src/ui/RhythmSelector.test.tsx`

**Interfaces:**
- Consumes: `CatalogClient` (tarea 9), `RhythmSummary`/`RhythmDetail` (tarea 3).
- Produces: componente `RhythmSelector({ catalogClient, selectedRhythmId, onSelect })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RhythmSelector } from "./RhythmSelector";
import type { CatalogClient } from "../simulation-runtime/catalog-client";
import type { RhythmDetail, RhythmSummary } from "../types/rhythms";

const summaries: RhythmSummary[] = [
  { rhythm_id: "sinus_normal", display_name: "Sinusal normal", category: "sinus", ventricular_rate_hz: 1.1667, pr_is_measurable: true },
  { rhythm_id: "atrial_fibrillation", display_name: "Fibrilación auricular", category: "supraventricular", ventricular_rate_hz: 1.5, pr_is_measurable: false },
];

const detail: RhythmDetail = {
  ...summaries[0],
  default_parameters: { heart_rate_hz: 1.1667 },
  editable_parameters: { heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 } },
  clinical_description: "...",
  references: [],
  allowed_overlays: [],
};

function makeCatalogClient(overrides: Partial<CatalogClient> = {}): CatalogClient {
  return {
    listRhythms: vi.fn().mockResolvedValue(summaries),
    getRhythm: vi.fn().mockResolvedValue(detail),
    ...overrides,
  } as unknown as CatalogClient;
}

describe("RhythmSelector", () => {
  it("carga el catalogo y muestra una opcion por ritmo", async () => {
    const catalogClient = makeCatalogClient();
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("Sinusal normal")).toBeInTheDocument();
      expect(screen.getByText("Fibrilación auricular")).toBeInTheDocument();
    });
  });

  it("al elegir un ritmo pide el detalle y llama a onSelect", async () => {
    const catalogClient = makeCatalogClient();
    const onSelect = vi.fn();
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={onSelect} />
    );
    await waitFor(() => screen.getByText("Sinusal normal"));

    await userEvent.selectOptions(
      screen.getByLabelText("Seleccionar ritmo"),
      "sinus_normal"
    );

    await waitFor(() => {
      expect(catalogClient.getRhythm).toHaveBeenCalledWith("sinus_normal");
      expect(onSelect).toHaveBeenCalledWith("sinus_normal", detail);
    });
  });

  it("muestra un error si el catalogo no carga", async () => {
    const catalogClient = makeCatalogClient({
      listRhythms: vi.fn().mockRejectedValue(new Error("500")),
    });
    render(
      <RhythmSelector catalogClient={catalogClient} selectedRhythmId={null} onSelect={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("500");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm install --save-dev @testing-library/user-event && npx vitest run src/ui/RhythmSelector.test.tsx`
Expected: FAIL — el módulo `./RhythmSelector` no existe

- [ ] **Step 3: Write minimal implementation**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/ui/RhythmSelector.test.tsx`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/ui/RhythmSelector.tsx apps/web/src/ui/RhythmSelector.test.tsx
git commit -m "Anadir el selector de ritmo"
```

---

### Task 15: `ui/LayoutPicker.tsx`

**Files:**
- Create: `apps/web/src/ui/LayoutPicker.tsx`
- Test: `apps/web/src/ui/LayoutPicker.test.tsx`

**Interfaces:**
- Consumes: `LayoutId` de `../render/layout` (tarea 11).
- Produces: componente `LayoutPicker({ value, onChange })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayoutPicker } from "./LayoutPicker";

describe("LayoutPicker", () => {
  it("muestra las cuatro opciones de layout", () => {
    render(<LayoutPicker value="6" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Derivaciones visibles" });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(4);
  });

  it("marca la opcion activa segun value", () => {
    render(<LayoutPicker value="3" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "3" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "12" })).not.toBeChecked();
  });

  it("llama a onChange con el layout elegido", async () => {
    const onChange = vi.fn();
    render(<LayoutPicker value="6" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "12" }));

    expect(onChange).toHaveBeenCalledWith("12");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/ui/LayoutPicker.test.tsx`
Expected: FAIL — el módulo `./LayoutPicker` no existe

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { LayoutId } from "../render/layout";

const LAYOUTS: LayoutId[] = ["1", "3", "6", "12"];

export interface LayoutPickerProps {
  value: LayoutId;
  onChange: (layout: LayoutId) => void;
}

export function LayoutPicker({ value, onChange }: LayoutPickerProps) {
  return (
    <div role="radiogroup" aria-label="Derivaciones visibles">
      {LAYOUTS.map((layout) => (
        <label key={layout}>
          <input
            type="radio"
            name="layout"
            value={layout}
            checked={value === layout}
            onChange={() => onChange(layout)}
          />
          {layout}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/ui/LayoutPicker.test.tsx`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/LayoutPicker.tsx apps/web/src/ui/LayoutPicker.test.tsx
git commit -m "Anadir el selector de layout"
```

---

### Task 16: Presets de ruido + `HeartRateControl` + `BasicControlPanel`

Modo básico del panel de control: presets de calidad de señal y el stepper de frecuencia cardíaca.

**Files:**
- Create: `apps/web/src/ui/noise-presets.ts`
- Create: `apps/web/src/ui/HeartRateControl.tsx`
- Create: `apps/web/src/ui/BasicControlPanel.tsx`
- Test: `apps/web/src/ui/noise-presets.test.ts`
- Test: `apps/web/src/ui/HeartRateControl.test.tsx`
- Test: `apps/web/src/ui/BasicControlPanel.test.tsx`

**Interfaces:**
- Consumes: `NoiseParamsPayload` de `../types/engine-params` (tarea 3).
- Produces: `PresetId`, `NOISE_PRESETS`, `PRESET_LABELS`, `matchPreset(noise)`; componentes `HeartRateControl` y `BasicControlPanel`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/ui/noise-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NOISE_PRESETS, matchPreset } from "./noise-presets";

describe("noise-presets", () => {
  it("matchPreset reconoce un preset exacto", () => {
    expect(matchPreset(NOISE_PRESETS.buena)).toBe("buena");
    expect(matchPreset(NOISE_PRESETS.perfecta)).toBe("perfecta");
  });

  it("matchPreset devuelve 'personalizada' para una combinacion que no coincide con ningun preset", () => {
    const noise = { ...NOISE_PRESETS.buena, emg_v: 0.123 };
    expect(matchPreset(noise)).toBe("personalizada");
  });
});
```

`apps/web/src/ui/HeartRateControl.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeartRateControl } from "./HeartRateControl";

describe("HeartRateControl", () => {
  it("muestra la frecuencia en lpm", () => {
    render(
      <HeartRateControl
        range={{ minimum: 1.0, maximum: 1.6667 }}
        valueHz={70 / 60}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("70 lpm")).toBeInTheDocument();
  });

  it("+5 sube la frecuencia en 5 lpm", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 1.6667 }} valueHz={70 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Subir frecuencia"));

    expect(onChange).toHaveBeenCalledWith(75 / 60);
  });

  it("no supera el maximo del rango", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 1.0, maximum: 100 / 60 }} valueHz={100 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Subir frecuencia"));

    expect(onChange).toHaveBeenCalledWith(100 / 60);
  });

  it("no baja del minimo del rango", async () => {
    const onChange = vi.fn();
    render(
      <HeartRateControl range={{ minimum: 60 / 60, maximum: 1.6667 }} valueHz={60 / 60} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText("Bajar frecuencia"));

    expect(onChange).toHaveBeenCalledWith(60 / 60);
  });
});
```

`apps/web/src/ui/BasicControlPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BasicControlPanel } from "./BasicControlPanel";
import { NOISE_PRESETS } from "./noise-presets";

describe("BasicControlPanel", () => {
  it("muestra el preset actual segun el ruido vigente", () => {
    render(
      <BasicControlPanel
        heartRateHz={70 / 60}
        heartRateRange={{ minimum: 1.0, maximum: 1.6667 }}
        noise={NOISE_PRESETS.buena}
        onHeartRateChange={vi.fn()}
        onNoiseChange={vi.fn()}
        onSwitchToAdvanced={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Calidad de señal")).toHaveValue("buena");
  });

  it("cambiar de preset llama a onNoiseChange con los valores del preset", async () => {
    const onNoiseChange = vi.fn();
    render(
      <BasicControlPanel
        heartRateHz={70 / 60}
        heartRateRange={{ minimum: 1.0, maximum: 1.6667 }}
        noise={NOISE_PRESETS.perfecta}
        onHeartRateChange={vi.fn()}
        onNoiseChange={onNoiseChange}
        onSwitchToAdvanced={vi.fn()}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Calidad de señal"), "urgencias");

    expect(onNoiseChange).toHaveBeenCalledWith(NOISE_PRESETS.urgencias);
  });

  it("elegir 'Personalizada' cambia a modo avanzado en vez de aplicar un preset", async () => {
    const onSwitchToAdvanced = vi.fn();
    const onNoiseChange = vi.fn();
    render(
      <BasicControlPanel
        heartRateHz={70 / 60}
        heartRateRange={{ minimum: 1.0, maximum: 1.6667 }}
        noise={NOISE_PRESETS.perfecta}
        onHeartRateChange={vi.fn()}
        onNoiseChange={onNoiseChange}
        onSwitchToAdvanced={onSwitchToAdvanced}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Calidad de señal"), "personalizada");

    expect(onSwitchToAdvanced).toHaveBeenCalled();
    expect(onNoiseChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/ui/noise-presets.test.ts src/ui/HeartRateControl.test.tsx src/ui/BasicControlPanel.test.tsx`
Expected: FAIL — los módulos no existen

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/ui/noise-presets.ts`:

```ts
import type { NoiseParamsPayload } from "../types/engine-params";

export type ConcretePresetId =
  | "perfecta" | "buena" | "urgencias" | "ambulancia" | "uci" | "muy_mala";
export type PresetId = ConcretePresetId | "personalizada";

// Valores de primer trazo, calibrables tras la revision clinica (criterio
// de aceptacion 7): el orden de magnitud es lo que importa aqui, no el
// numero exacto de cada campo.
export const NOISE_PRESETS: Record<ConcretePresetId, NoiseParamsPayload> = {
  perfecta:   { emg_v: 0.0,   mains_v: 0.0,   baseline_v: 0.0,  motion_v: 0.0,  clip_v: null },
  buena:      { emg_v: 0.005, mains_v: 0.01,  baseline_v: 0.02, motion_v: 0.0,  clip_v: null },
  urgencias:  { emg_v: 0.02,  mains_v: 0.02,  baseline_v: 0.05, motion_v: 0.03, clip_v: null },
  ambulancia: { emg_v: 0.05,  mains_v: 0.03,  baseline_v: 0.1,  motion_v: 0.15, clip_v: null },
  uci:        { emg_v: 0.015, mains_v: 0.015, baseline_v: 0.03, motion_v: 0.02, clip_v: null },
  muy_mala:   { emg_v: 0.1,   mains_v: 0.05,  baseline_v: 0.2,  motion_v: 0.3,  clip_v: 0.5 },
};

export const PRESET_LABELS: Record<PresetId, string> = {
  perfecta: "Perfecta",
  buena: "Buena",
  urgencias: "Urgencias",
  ambulancia: "Ambulancia",
  uci: "UCI",
  muy_mala: "Muy mala",
  personalizada: "Personalizada",
};

export function matchPreset(noise: NoiseParamsPayload): PresetId {
  const entry = (Object.entries(NOISE_PRESETS) as [ConcretePresetId, NoiseParamsPayload][]).find(
    ([, preset]) => sameNoise(preset, noise)
  );
  return entry ? entry[0] : "personalizada";
}

function sameNoise(a: NoiseParamsPayload, b: NoiseParamsPayload): boolean {
  return (
    a.emg_v === b.emg_v &&
    a.mains_v === b.mains_v &&
    a.baseline_v === b.baseline_v &&
    a.motion_v === b.motion_v &&
    a.clip_v === b.clip_v
  );
}
```

`apps/web/src/ui/HeartRateControl.tsx`:

```tsx
export interface HeartRateControlProps {
  range: { minimum: number; maximum: number };
  valueHz: number;
  onChange: (valueHz: number) => void;
}

const STEP_BPM = 5;

export function HeartRateControl({ range, valueHz, onChange }: HeartRateControlProps) {
  const bpm = Math.round(valueHz * 60);
  const minBpm = Math.round(range.minimum * 60);
  const maxBpm = Math.round(range.maximum * 60);

  const step = (deltaBpm: number) => {
    const next = clamp(bpm + deltaBpm, minBpm, maxBpm);
    onChange(next / 60);
  };

  return (
    <div>
      <button type="button" aria-label="Bajar frecuencia" onClick={() => step(-STEP_BPM)}>
        −5
      </button>
      <span aria-live="polite">{bpm} lpm</span>
      <button type="button" aria-label="Subir frecuencia" onClick={() => step(STEP_BPM)}>
        +5
      </button>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
```

`apps/web/src/ui/BasicControlPanel.tsx`:

```tsx
import { HeartRateControl } from "./HeartRateControl";
import { NOISE_PRESETS, PRESET_LABELS, matchPreset, type ConcretePresetId, type PresetId } from "./noise-presets";
import type { NoiseParamsPayload } from "../types/engine-params";

export interface BasicControlPanelProps {
  heartRateHz: number;
  heartRateRange: { minimum: number; maximum: number };
  noise: NoiseParamsPayload;
  onHeartRateChange: (hz: number) => void;
  onNoiseChange: (noise: NoiseParamsPayload) => void;
  onSwitchToAdvanced: () => void;
}

export function BasicControlPanel(props: BasicControlPanelProps) {
  const currentPreset = matchPreset(props.noise);

  const handlePresetChange = (preset: PresetId) => {
    if (preset === "personalizada") {
      props.onSwitchToAdvanced();
      return;
    }
    props.onNoiseChange(NOISE_PRESETS[preset as ConcretePresetId]);
  };

  return (
    <fieldset>
      <legend>Ritmo</legend>
      <HeartRateControl
        range={props.heartRateRange}
        valueHz={props.heartRateHz}
        onChange={props.onHeartRateChange}
      />

      <legend>Calidad de señal</legend>
      <select
        aria-label="Calidad de señal"
        value={currentPreset}
        onChange={(event) => handlePresetChange(event.target.value as PresetId)}
      >
        {(Object.keys(PRESET_LABELS) as PresetId[]).map((id) => (
          <option key={id} value={id}>
            {PRESET_LABELS[id]}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/ui/noise-presets.test.ts src/ui/HeartRateControl.test.tsx src/ui/BasicControlPanel.test.tsx`
Expected: PASS, 9 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/noise-presets.ts apps/web/src/ui/noise-presets.test.ts apps/web/src/ui/HeartRateControl.tsx apps/web/src/ui/HeartRateControl.test.tsx apps/web/src/ui/BasicControlPanel.tsx apps/web/src/ui/BasicControlPanel.test.tsx
git commit -m "Anadir el modo basico del panel de control: presets y frecuencia cardiaca"
```

---

### Task 17: `ui/AdvancedControlPanel.tsx`

Modo avanzado: los 5 sliders de ruido individuales.

**Files:**
- Create: `apps/web/src/ui/AdvancedControlPanel.tsx`
- Test: `apps/web/src/ui/AdvancedControlPanel.test.tsx`

**Interfaces:**
- Consumes: `NoiseParamsPayload` de `../types/engine-params` (tarea 3).
- Produces: componente `AdvancedControlPanel({ noise, onChange, onSwitchToBasic })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import type { NoiseParamsPayload } from "../types/engine-params";

const noise: NoiseParamsPayload = {
  emg_v: 0.02, mains_v: 0.01, baseline_v: 0.05, motion_v: 0.0, clip_v: null,
};

describe("AdvancedControlPanel", () => {
  it("renderiza los cinco sliders con sus valores iniciales", () => {
    render(<AdvancedControlPanel noise={noise} onChange={vi.fn()} onSwitchToBasic={vi.fn()} />);

    expect(screen.getByLabelText("EMG")).toHaveValue("0.02");
    expect(screen.getByLabelText("Interferencia 50Hz")).toHaveValue("0.01");
    expect(screen.getByLabelText("Línea base")).toHaveValue("0.05");
    expect(screen.getByLabelText("Movimiento")).toHaveValue("0");
    expect(screen.getByLabelText("Saturación")).toHaveValue("0");
  });

  it("mover un slider llama a onChange conservando el resto de campos", () => {
    const onChange = vi.fn();
    render(<AdvancedControlPanel noise={noise} onChange={onChange} onSwitchToBasic={vi.fn()} />);

    fireEventChange(screen.getByLabelText("EMG"), "0.08");

    expect(onChange).toHaveBeenCalledWith({ ...noise, emg_v: 0.08 });
  });

  it("volver a modo basico llama a onSwitchToBasic", async () => {
    const onSwitchToBasic = vi.fn();
    render(<AdvancedControlPanel noise={noise} onChange={vi.fn()} onSwitchToBasic={onSwitchToBasic} />);

    await userEvent.click(screen.getByRole("button", { name: "Volver a modo básico" }));

    expect(onSwitchToBasic).toHaveBeenCalled();
  });
});

// `userEvent` no simula bien los sliders de rango en jsdom; se dispara el
// evento `change` directamente, que es lo que React escucha en un
// `<input type="range">`.
function fireEventChange(element: HTMLElement, value: string): void {
  const input = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/ui/AdvancedControlPanel.test.tsx`
Expected: FAIL — el módulo `./AdvancedControlPanel` no existe

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { NoiseParamsPayload } from "../types/engine-params";

export interface AdvancedControlPanelProps {
  noise: NoiseParamsPayload;
  onChange: (noise: NoiseParamsPayload) => void;
  onSwitchToBasic: () => void;
}

const SLIDER_MAX_V = 0.3;
const SLIDER_STEP_V = 0.005;

export function AdvancedControlPanel({ noise, onChange, onSwitchToBasic }: AdvancedControlPanelProps) {
  const setField = (field: keyof NoiseParamsPayload, value: number) => {
    onChange({ ...noise, [field]: value });
  };

  return (
    <fieldset>
      <legend>Ruido (avanzado)</legend>
      <NoiseSlider label="EMG" value={noise.emg_v} onChange={(v) => setField("emg_v", v)} />
      <NoiseSlider
        label="Interferencia 50Hz"
        value={noise.mains_v}
        onChange={(v) => setField("mains_v", v)}
      />
      <NoiseSlider
        label="Línea base"
        value={noise.baseline_v}
        onChange={(v) => setField("baseline_v", v)}
      />
      <NoiseSlider
        label="Movimiento"
        value={noise.motion_v}
        onChange={(v) => setField("motion_v", v)}
      />
      <NoiseSlider
        label="Saturación"
        value={noise.clip_v ?? 0}
        onChange={(v) => setField("clip_v", v)}
      />
      <button type="button" onClick={onSwitchToBasic}>
        Volver a modo básico
      </button>
    </fieldset>
  );
}

function NoiseSlider(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      {props.label}
      <input
        aria-label={props.label}
        type="range"
        min={0}
        max={SLIDER_MAX_V}
        step={SLIDER_STEP_V}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/ui/AdvancedControlPanel.test.tsx`
Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/AdvancedControlPanel.tsx apps/web/src/ui/AdvancedControlPanel.test.tsx
git commit -m "Anadir el modo avanzado del panel de control: los cinco sliders de ruido"
```

---

### Task 18: `ui/ECGWorkspace.tsx` y `App.tsx`

El componente raíz: conecta `SessionRuntime`, el store, los selectores/paneles, y el bucle `requestAnimationFrame` que dibuja directamente desde el buffer.

**Files:**
- Create: `apps/web/src/ui/ECGWorkspace.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/ui/ECGWorkspace.test.tsx`

**Interfaces:**
- Consumes: `SessionRuntime` (tarea 8), `CatalogClient` (tarea 9), `useSessionStore` (tarea 10), `leadsForLayout`/`leadIndex`/`LayoutId` (tarea 11), `drawGrid` (tarea 12), `drawLeadTrace` (tarea 13), `RhythmSelector` (tarea 14), `LayoutPicker` (tarea 15), `BasicControlPanel` (tarea 16), `AdvancedControlPanel` (tarea 17).
- Produces: componente `ECGWorkspace({ wsUrl, apiBaseUrl })`; `App` lo monta con las URLs de entorno.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ECGWorkspace } from "./ECGWorkspace";

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  binaryType = "blob";
  closed = false;
  private handlers = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(): void {}

  close(): void {
    this.closed = true;
  }

  dispatch(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }
}

describe("ECGWorkspace", () => {
  let fakeSocket: FakeWebSocket;
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeSocket = new FakeWebSocket();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      })
    );
    // jsdom no implementa el contexto 2D de Canvas: se sustituye por un
    // stub inerte para que el bucle de dibujo no falle al montar.
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      canvas: { width: 800 },
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("conecta el runtime al montar y lo desconecta al desmontar", async () => {
    const { unmount } = render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => expect(fakeSocket.closed).toBe(false));

    unmount();

    expect(fakeSocket.closed).toBe(true);
  });

  it("muestra el selector de ritmo", async () => {
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seleccionar ritmo")).toBeInTheDocument();
    });
  });

  it("no muestra 'esperando señal' antes de arrancar una sesion", async () => {
    render(
      <ECGWorkspace
        wsUrl="ws://test"
        apiBaseUrl="http://api.test"
        webSocketFactory={() => fakeSocket as unknown as WebSocket}
      />
    );

    await waitFor(() => screen.getByLabelText("Seleccionar ritmo"));

    // El buffer está vacío (isUnderrun=true) desde el primer render, pero
    // el indicador solo debe aparecer con una sesión en curso — mostrarlo
    // antes de pulsar "start" confundiría al usuario con un mensaje sobre
    // una señal que nunca se pidió.
    expect(screen.queryByText("Esperando señal…")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/ui/ECGWorkspace.test.tsx`
Expected: FAIL — el módulo `./ECGWorkspace` no existe

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { SessionRuntime } from "../simulation-runtime/session-runtime";
import { CatalogClient } from "../simulation-runtime/catalog-client";
import { useSessionStore } from "../state/session-store";
import { RhythmSelector } from "./RhythmSelector";
import { LayoutPicker } from "./LayoutPicker";
import { BasicControlPanel } from "./BasicControlPanel";
import { AdvancedControlPanel } from "./AdvancedControlPanel";
import { leadsForLayout, leadIndex, type LayoutId } from "../render/layout";
import { drawGrid } from "../render/grid-layer";
import { drawLeadTrace } from "../render/lead-canvas";
import type { RhythmDetail } from "../types/rhythms";

const DEFAULT_VARIABILITY = {
  respiration_hz: 0.25,
  rsa_fraction: 0.04,
  amplitude_fraction: 0.03,
  rr_jitter_fraction: 0.015,
};
const SILENT_NOISE = { emg_v: 0, mains_v: 0, baseline_v: 0, motion_v: 0, clip_v: null };
const DEFAULT_SAMPLE_RATE_HZ = 500;
const PAPER_SPEED_MM_S = 25;
const GAIN_MM_PER_MV = 10;

export interface ECGWorkspaceProps {
  wsUrl: string;
  apiBaseUrl: string;
  webSocketFactory?: (url: string) => WebSocket;
}

export function ECGWorkspace({ wsUrl, apiBaseUrl, webSocketFactory }: ECGWorkspaceProps) {
  const runtime = useMemo(
    () => new SessionRuntime(wsUrl, webSocketFactory),
    [wsUrl, webSocketFactory]
  );
  const catalogClient = useMemo(() => new CatalogClient({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  const store = useSessionStore();

  const [selectedRhythm, setSelectedRhythm] = useState<RhythmDetail | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [layout, setLayout] = useState<LayoutId>("6");
  const [isUnderrun, setIsUnderrun] = useState(false);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    return () => runtime.disconnect();
  }, [runtime]);

  useEffect(() => {
    let frameId: number;
    let lastS: number | undefined;
    const tick = (nowMs: number) => {
      const nowS = nowMs / 1000;
      const elapsedS = lastS === undefined ? 0 : nowS - lastS;
      lastS = nowS;

      runtime.buffer.advance(elapsedS);
      // Underrun: el trazo se congela (no se redibuja con muestras nuevas,
      // simplemente no hay ninguna que dibujar) y se muestra el indicador.
      // Nunca se interpola — es justo lo que "congelar en la última
      // muestra" significa: no tocar el canvas en absoluto este tick.
      setIsUnderrun(runtime.buffer.isUnderrun);
      if (runtime.buffer.isUnderrun) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      const sampleRateHz = store.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
      for (const lead of leadsForLayout(layout)) {
        const canvas = canvasRefs.current[lead];
        const ctx = canvas?.getContext("2d");
        if (ctx && canvas) {
          const samples = runtime.buffer.getVisibleSamples(leadIndex(lead));
          drawLeadTrace(
            ctx,
            samples,
            sampleRateHz,
            { paperSpeedMmS: PAPER_SPEED_MM_S, gainMmPerMv: GAIN_MM_PER_MV },
            canvas.height
          );
        }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [runtime, layout, store.sampleRateHz]);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) drawGrid(ctx, canvas.width, canvas.height);
  }, [layout]);

  const handleRhythmSelect = (rhythmId: string, detail: RhythmDetail) => {
    setSelectedRhythm(detail);
    store.selectRhythm(rhythmId);
    runtime.start(rhythmId, {
      heart_rate_hz: detail.default_parameters.heart_rate_hz,
      noise: SILENT_NOISE,
      variability: DEFAULT_VARIABILITY,
    });
  };

  const currentParams = store.params ?? (selectedRhythm
    ? { heart_rate_hz: selectedRhythm.default_parameters.heart_rate_hz, noise: SILENT_NOISE, variability: DEFAULT_VARIABILITY }
    : null);

  return (
    <div>
      <RhythmSelector
        catalogClient={catalogClient}
        selectedRhythmId={store.selectedRhythmId}
        onSelect={handleRhythmSelect}
      />
      <LayoutPicker value={layout} onChange={setLayout} />

      {store.lastError && (
        <p role="alert">
          {store.lastError.code}: {store.lastError.detail}
        </p>
      )}
      {isUnderrun && store.connectionState === "running" && (
        <p role="status">Esperando señal…</p>
      )}

      {selectedRhythm && currentParams && (
        advancedMode ? (
          <AdvancedControlPanel
            noise={currentParams.noise}
            onChange={(noise) => runtime.update({ ...currentParams, noise })}
            onSwitchToBasic={() => setAdvancedMode(false)}
          />
        ) : (
          <BasicControlPanel
            heartRateHz={currentParams.heart_rate_hz}
            heartRateRange={selectedRhythm.editable_parameters.heart_rate_hz}
            noise={currentParams.noise}
            onHeartRateChange={(hz) => runtime.update({ ...currentParams, heart_rate_hz: hz })}
            onNoiseChange={(noise) => runtime.update({ ...currentParams, noise })}
            onSwitchToAdvanced={() => setAdvancedMode(true)}
          />
        )
      )}

      <div style={{ position: "relative" }}>
        <canvas ref={gridCanvasRef} width={800} height={600} style={{ position: "absolute" }} />
        {leadsForLayout(layout).map((lead) => (
          <canvas
            key={lead}
            ref={(el) => {
              canvasRefs.current[lead] = el;
            }}
            width={800}
            height={100}
          />
        ))}
      </div>
    </div>
  );
}
```

Modificar `apps/web/src/App.tsx`:

```tsx
import { ECGWorkspace } from "./ui/ECGWorkspace";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws/simulation";

export function App() {
  return <ECGWorkspace wsUrl={WS_URL} apiBaseUrl={API_BASE_URL} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/ui/ECGWorkspace.test.tsx`
Expected: PASS, 3 passed

Y la suite completa de `apps/web`:

Run: `cd apps/web && npm run test`
Expected: PASS, toda la suite en verde

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/ECGWorkspace.tsx apps/web/src/ui/ECGWorkspace.test.tsx apps/web/src/App.tsx
git commit -m "Anadir el componente raiz que conecta runtime, estado y render"
```

---

### Task 19: Benchmark de rendimiento con Playwright (nivel 3)

Verifica de verdad el criterio de aceptación 2 (60fps, 10 minutos, sin fugas): memoria de heap JS, fps y frames descartados, usando un servidor WebSocket de prueba que no pacea a tiempo real (ver sección 9 del spec de esta fase).

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/e2e/mock-simulation-server.ts`
- Create: `apps/web/tests/e2e/streaming-performance.spec.ts`

**Interfaces:**
- Consumes: `HEADER_SIZE_BYTES` (tarea 4), la app completa montada (tarea 18).
- Produces: un test de Playwright ejecutable con `npx playwright test`.

- [ ] **Step 1: Instalar Playwright**

Run: `cd apps/web && npm install --save-dev @playwright/test && npx playwright install --with-deps chromium`
Expected: instala Playwright y el navegador Chromium

- [ ] **Step 2: Write the failing test**

`apps/web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  webServer: {
    command: "npm run dev -- --port 5183",
    port: 5183,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:5183",
  },
});
```

`apps/web/tests/e2e/mock-simulation-server.ts` — servidor WS mínimo que produce frames válidos sin pacear a tiempo real (a diferencia de `apps/api`, que hace `asyncio.sleep(0.1)` por trozo):

```ts
import { WebSocketServer, type WebSocket } from "ws";

const HEADER_SIZE_BYTES = 40;
const N_CHANNELS = 12;
const N_SAMPLES_PER_CHUNK = 50;
const SAMPLE_RATE_HZ = 500;
const SESSION_ID_BYTES = new Array(16).fill(0x11);

function encodeFrame(sequenceNumber: number, tStartS: number): Buffer {
  const payloadBytes = N_CHANNELS * N_SAMPLES_PER_CHUNK * 4;
  const buffer = Buffer.alloc(HEADER_SIZE_BYTES + payloadBytes);
  buffer.writeUInt16LE(1, 0); // version
  buffer.writeUInt16LE(SAMPLE_RATE_HZ, 2);
  buffer.writeUInt8(N_CHANNELS, 4);
  buffer.writeUInt8(0, 5);
  buffer.writeUInt16LE(N_SAMPLES_PER_CHUNK, 6);
  buffer.writeUInt32LE(sequenceNumber, 8);
  buffer.writeUInt32LE(0, 12);
  buffer.writeDoubleLE(tStartS, 16);
  Buffer.from(SESSION_ID_BYTES).copy(buffer, 24);

  let offset = HEADER_SIZE_BYTES;
  for (let ch = 0; ch < N_CHANNELS; ch++) {
    for (let i = 0; i < N_SAMPLES_PER_CHUNK; i++) {
      const t = tStartS + i / SAMPLE_RATE_HZ;
      buffer.writeFloatLE(0.001 * Math.sin(2 * Math.PI * 1.2 * t + ch), offset);
      offset += 4;
    }
  }
  return buffer;
}

export function startMockSimulationServer(port: number): { close: () => void } {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    let sequenceNumber = 0;
    let intervalHandle: NodeJS.Timeout | null = null;

    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "start") {
        ws.send(
          JSON.stringify({
            type: "started",
            session_id: "11111111-1111-1111-1111-111111111111",
            seed: message.seed ?? 1,
            sample_rate_hz: SAMPLE_RATE_HZ,
            channels: N_CHANNELS,
          })
        );
        // Sin `setTimeout` pausado a 100ms: envía tan rápido como el event
        // loop lo permita, para comprimir muchos minutos de contenido en
        // pocos segundos de reloj real (ver sección 9 del spec de esta fase).
        intervalHandle = setInterval(() => {
          const tStartS = sequenceNumber * (N_SAMPLES_PER_CHUNK / SAMPLE_RATE_HZ);
          ws.send(encodeFrame(sequenceNumber, tStartS));
          sequenceNumber++;
        }, 0);
      } else if (message.type === "stop") {
        if (intervalHandle) clearInterval(intervalHandle);
        ws.send(JSON.stringify({ type: "stopped", duration_s: sequenceNumber * 0.1 }));
      }
    });

    ws.on("close", () => {
      if (intervalHandle) clearInterval(intervalHandle);
    });
  });

  return { close: () => wss.close() };
}
```

`apps/web/tests/e2e/streaming-performance.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { startMockSimulationServer } from "./mock-simulation-server";

const MOCK_WS_PORT = 8901;
// Con el mock enviando frames de 100ms simulados tan rápido como el
// intervalo de Node lo permite, varios minutos de contenido se comprimen
// en unos pocos segundos de reloj real: no hace falta esperar los 10
// minutos reales que tardaría el backend de verdad (que pacea a tiempo
// real, ver la nota de la sección 9 del spec de esta fase).
const REAL_TIME_BUDGET_MS = 20_000;

test("una sesion larga no degrada fps ni acumula memoria sin limite", async ({ page, baseURL }) => {
  const server = startMockSimulationServer(MOCK_WS_PORT);
  try {
    await page.goto(`${baseURL}/?ws=ws://localhost:${MOCK_WS_PORT}`);

    await page.getByLabel("Seleccionar ritmo").waitFor({ state: "visible" });
    await page.getByLabel("Seleccionar ritmo").selectOption({ index: 1 });

    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");

    const deadline = Date.now() + REAL_TIME_BUDGET_MS;
    const memorySamplesBytes: number[] = [];
    while (Date.now() < deadline) {
      const metrics = await client.send("Performance.getMetrics");
      const jsHeap = metrics.metrics.find((m) => m.name === "JSHeapUsedSize");
      if (jsHeap) memorySamplesBytes.push(jsHeap.value);
      await page.waitForTimeout(500);
    }

    // La memoria no debe crecer sin limite: la segunda mitad de las
    // muestras no debe superar en mas de un 50% a la primera mitad. Un
    // buffer que no evictase nada crecería sin cota con varios minutos de
    // contenido comprimidos en segundos.
    const half = Math.floor(memorySamplesBytes.length / 2);
    const earlyAvg = average(memorySamplesBytes.slice(0, half));
    const lateAvg = average(memorySamplesBytes.slice(half));
    expect(lateAvg).toBeLessThan(earlyAvg * 1.5);
  } finally {
    server.close();
  }
});

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
```

Esta prueba requiere que la app acepte un parámetro `?ws=` para apuntar al servidor mock en vez de a `VITE_WS_URL`. Como paso previo a este test, añade ese soporte a `App.tsx` (ya en la tarea 18 se lee `import.meta.env`; aquí se añade la lectura de `URLSearchParams` como override, solo relevante para este test de rendimiento):

Modificar `apps/web/src/App.tsx`:

```tsx
import { ECGWorkspace } from "./ui/ECGWorkspace";

const params = new URLSearchParams(window.location.search);

const API_BASE_URL =
  params.get("api") ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_URL =
  params.get("ws") ?? import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws/simulation";

export function App() {
  return <ECGWorkspace wsUrl={WS_URL} apiBaseUrl={API_BASE_URL} />;
}
```

- [ ] **Step 3: Instalar `ws` para el servidor mock**

Run: `cd apps/web && npm install --save-dev ws @types/ws`

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/web && npx playwright test`
Expected: FAIL en el primer intento — probablemente por el parámetro `?ws=` aún no soportado en `App.tsx` de la tarea 18 (antes de aplicar el cambio del Step 2), o por el propio servidor mock si algo en el contrato binario no encaja. Confirma el motivo exacto antes de continuar.

- [ ] **Step 5: Run test to verify it passes**

Tras aplicar el cambio de `App.tsx` de este mismo Step 2:

Run: `cd apps/web && npx playwright test`
Expected: PASS, 1 passed (tarda hasta ~20s de reloj real, por el presupuesto de tiempo fijado)

- [ ] **Step 6: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/tests/e2e/ apps/web/src/App.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "Anadir el benchmark de rendimiento con Playwright (nivel 3)"
```

---

## Cierre del plan

Al terminar la tarea 19, `apps/web` cumple la parte de los criterios de aceptación de la fase 1 que le corresponde:

| Criterio | Cubierto por |
|---|---|
| 1. Los doce ritmos se ven correctamente en las doce derivaciones | Tareas 11-13, 18 (trazado); pendiente la revisión clínica (criterio 7, independiente) |
| 2. 60fps/10min sin fugas ni deriva | Arquitectura de capas (tareas 4-13) + benchmark Playwright (tarea 19) |
| 3. FC y ruido modificables en caliente, sin cortes | Tareas 16-18, sobre `update`, ya soportado por la API |
| 4. Sesión reproducible desde `seed`/`params`/`engine_semver`/`engine_commit` | Ya cubierto por la fase B; esta fase no lo modifica |

Quedan fuera de este plan, por diseño (sección 1 del spec de esta fase): historial de sesiones, corazón 3D, farmacología, monitor de constantes vitales, reconexión automática.

**Siguiente paso tras ejecutar este plan:** la revisión clínica formal de los doce trazados (criterio de aceptación 7, no negociable) — con esta fase completa, se puede hacer directamente sobre la interfaz real en vez de sobre el visualizador matplotlib de la fase A.
