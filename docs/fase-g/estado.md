# Fase G — estado de implementación

Qué está hecho, qué falta y qué no puede hacerse desde aquí. Se actualiza al
cerrar cada sub-fase.

Última revisión: 9 de agosto de 2026 · rama `feat/ecg-desktop-fase-g`

## Resumen

| Fase | Estado | Verificado ejecutándolo |
|---|---|---|
| G1 Desktop Shell | **Hecha** | El `.exe` compila, abre ventana y monta la interfaz |
| G2 Runtime Python | **Casi** | El backend empaquetado arranca, migra y responde; falta que lo lance el shell |
| G3 Base de datos | **Hecha** | 186 tests contra Postgres y los mismos contra SQLite; arranca sin base de datos |
| G4 Instalador | **Parcial** | `tauri build` produce el NSIS; falta meter el backend dentro y probar en VM limpia |
| G5 Firma | **Bloqueada** | Necesita un certificado que hay que comprar |
| G6 Actualizaciones | **No empezada** | Necesita un servidor de versiones |
| G7 Licencia | **No empezada** | Necesita decisiones comerciales |
| G8 Release | **Parcial** | CI de tests con los dos motores; falta la pipeline de release |

## G1 — Desktop Shell · hecha

`apps/desktop/` con Tauri 2. Compila y arranca:

```
simulador-ecg.exe   5,6 MB   ventana «Simulador de ECG»   29 MB de memoria
```

- Ventana con **mínimo 1280×800**: por debajo de 1100 px el layout se reordena
  (`AppShell.module.css`) y el ECG queda inservible.
- Icono generado sin dependencias por `tools/generar_icono.py` — un latido en
  verde fósforo sobre el fondo del monitor, los colores del tema oscuro.
- **`RuntimeMode`** (`apps/web/src/simulation-runtime/runtime-mode.ts`): la
  interfaz detecta si corre en navegador o en Tauri **por la presencia del
  puente**, no por una bandera de compilación, para que el mismo `dist` sirva
  en los dos modos.
- `App.tsx` resuelve la URL del backend de forma **asíncrona**, con estado de
  arranque. Era obligatorio: `?api=` quedó restringido a desarrollo por
  seguridad y las `VITE_*` se hornean al compilar, cuando todavía no se sabe el
  puerto.

## G2 — Runtime Python · casi

El backend empaquetado funciona de extremo a extremo, probado con el ejecutable:

```
> ecg-api.exe
{"event": "listening", "host": "127.0.0.1", "port": 13106}
> GET /api/health
{"status":"ok","engine_version":"1.0.0","persistence":"ok"}
```

95 MB en `onedir`. Elige puerto efímero, lo anuncia por stdout, migra la base
SQLite él solo y responde.

**Dos defectos que solo aparecen empaquetando de verdad**, y que por eso había
que empaquetar de verdad y no solo escribir el `.spec`:

1. `migrations_path()` resolvía por `parents[...]`; dentro del bundle `__file__`
   apunta a una ruta que no existe en disco y Alembic abortaba con «Path doesn't
   exist». Se corrige mirando `sys._MEIPASS` cuando el proceso está congelado.
2. `uvicorn.run("ecg_api.main:app")` no encuentra el módulo dentro del
   ejecutable. Fallaba **después** de anunciar el puerto, que es la peor forma
   de fallar: el shell ya creía que había backend.

También entra aquí el **token de arranque** del modo escritorio: por cabecera
en REST, por subprotocolo en el WebSocket. No es autenticación de usuario, es lo
que impide que cualquier proceso del mismo equipo hable con el simulador — en
`127.0.0.1` lo alcanza cualquiera.

### Lo que falta de G2

- Que el shell **lance** el sidecar: `spawn`, leer el `{"event":"listening"}`,
  llamar a `set_ready()` y esperar a `/api/health`. La costura ya está puesta
  (`BackendHandle` en `src-tauri/src/backend.rs`).
- **Job object de Windows** para que los hijos mueran con el padre aunque el
  padre muera de forma anormal.
- El criterio de aceptación: **cien ciclos de abrir y cerrar sin procesos
  huérfanos**.

## G3 — Base de datos · hecha

Ver [g3-base-de-datos.md](g3-base-de-datos.md) para el análisis. Implementado:

- Esquema portable con `with_variant`: Postgres sigue recibiendo `JSONB` y
  `UUID` nativos, SQLite recibe `JSON` y `CHAR(32)`.
- `PRAGMA foreign_keys=ON` en cada conexión de SQLite, **con test**.
- Alembic programático, sin depender del directorio de trabajo.
- **Modo degradado**: la aplicación arranca sin base de datos, `/api/health` lo
  declara en `persistence`, y `/api/sessions` responde 503 con motivo.
- CI con `ECG_TEST_DB=postgres|sqlite`.

186 tests contra cada motor.

## G4 — Instalador · parcial

`tauri build` produce `Simulador ECG_0.1.0_x64-setup.exe` (1,5 MB, instalación
por usuario, español e inglés).

Falta lo que lo hace un instalador de verdad:

- **Meter el backend dentro** como recurso (los 95 MB de `ecg-api/`), que es lo
  que llevará el instalador a unos 100 MB.
- WebView2: decidir entre incluir el bootstrapper o descargarlo. Esta máquina
  ya lo tiene, así que **el instalador actual no prueba ese camino**.
- Datos en `%LOCALAPPDATA%`, desinstalador que pregunte por ellos, y prueba en
  una **máquina virtual limpia**. Probarlo aquí es engañarse: aquí está todo
  instalado.

## G5 — Firma · bloqueada

No es una cuestión de tiempo: **hace falta un certificado de firma de código**,
que cuesta dinero, exige validación de identidad y tarda días o semanas en
emitirse. No se puede obtener desde aquí.

Lo que sí está listo para cuando exista: `tauri.conf.json` acepta la
configuración de firma, y el workflow de release puede firmar como un paso más.

Recordatorio del plan: **iniciar el trámite ya**, no cuando toque G5. Y contar
con que un certificado nuevo no elimina los avisos de SmartScreen — la
reputación se construye con descargas.

## G6 — Actualizaciones · no empezada

Necesita un **servidor de versiones** donde publicar el manifiesto y los
paquetes, y un par de claves para el updater. Ninguna de las dos cosas existe
todavía, y ambas son decisiones de infraestructura, no de programación.

Sí conviene recordar lo que dice el plan: **la primera versión distribuida sin
updater no sabrá actualizarse nunca**. Si va a haber distribución, esto tiene
que entrar antes de la primera entrega real.

## G7 — Licencia · no empezada

Depende de decisiones que no son técnicas: qué ediciones hay, qué incluye cada
una, cuánto dura el periodo de gracia sin conexión, y qué hace exactamente la
aplicación sin licencia. Programarlo sin esas respuestas sería inventarlas.

## G8 — Release · parcial

`.github/workflows/tests.yml` corre en cada push y PR:

- API contra **Postgres y SQLite** (matriz), que era la condición de G3.
- Frontend: tipos y tests.
- `npm audit` y `pip-audit`, que **avisan sin bloquear** — en un proyecto
  pequeño, un aviso que impide mergear un viernes es un aviso que se acaba
  ignorando.

Falta la pipeline de release: tag → build → paquete → firma → smoke test →
publicación. Depende de G4 y G5.

## Cómo se prueba lo que hay

```bash
# Backend, los dos motores
cd apps/api && uv run pytest -q
cd apps/api && ECG_TEST_DB=sqlite uv run pytest -q

# Frontend
cd apps/web && npm test

# Ventana de escritorio (necesita Rust + Build Tools de MSVC)
cd apps/desktop && npx tauri dev

# Backend empaquetado
cd apps/api && uv run --with pyinstaller pyinstaller packaging/ecg-api.spec \
    --distpath packaging/dist --workpath packaging/build --noconfirm

# Instalador
cd apps/desktop && npx tauri build
```
