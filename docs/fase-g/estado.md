# Fase G — estado de implementación

Qué está hecho, qué falta y qué no puede hacerse desde aquí. Se actualiza al
cerrar cada sub-fase.

Última revisión: 9 de agosto de 2026 · rama `feat/ecg-desktop-fase-g`

## Resumen

| Fase | Estado | Verificado ejecutándolo |
|---|---|---|
| G1 Desktop Shell | **Hecha** | El `.exe` compila, abre ventana y monta la interfaz |
| G2 Runtime Python | **Hecha** | 100 ciclos abrir/cerrar sin un solo proceso huérfano |
| G3 Base de datos | **Hecha** | 186 tests contra Postgres y los mismos contra SQLite; arranca sin base de datos |
| G4 Instalador | **Hecha** | Instalar → arrancar → cerrar → desinstalar, con el backend dentro |
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

## G2 — Runtime Python · hecha

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

### El shell arranca y mata el backend

`BackendHandle::spawn` lanza `ecg-api.exe`, lee su anuncio de puerto y entrega
a la interfaz la URL y el token. El apagado tiene **dos capas**, y las dos hacen
falta:

- `shutdown()` al cerrar la ventana: el caso normal, y libera puerto y memoria
  de inmediato.
- **Job object** con `KILL_ON_JOB_CLOSE` (`src-tauri/src/job.rs`): cubre el caso
  que de verdad ensucia la máquina de alguien — que el shell muera sin ejecutar
  su código de cierre. Windows mata todo el job cuando se cierra el último
  handle, y los handles de un proceso se cierran cuando el proceso muere, pase
  lo que pase.

Verificado ejecutándolo:

```
Stop-Process -Force sobre el shell  ->  el backend murió con él
100 ciclos de abrir y cerrar        ->  0 huérfanos, 0 arranques fallidos
                                        0 procesos vivos al terminar
```

El token llega hasta el final: cabecera `X-ECG-Token` en REST y subprotocolo
`ecg-token.<token>` en el WebSocket. En navegador es cadena vacía y no se manda
nada, así que el camino de siempre no cambia.

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

## G4 — Instalador · hecha, salvo la VM limpia

`tauri build` produce `Simulador ECG_0.1.0_x64-setup.exe` con **el backend
dentro**: el directorio de PyInstaller entra como recurso
(`bundle.resources`), así que el instalador lleva la aplicación completa y no
solo el shell.

Instalación por usuario (sin permisos de administrador), selector de idioma
entre español e inglés.

### WebView2: `embedBootstrapper`

Tres opciones y un compromiso:

| Modo | Instalador | Sin Internet |
|---|---|---|
| `downloadBootstrapper` (por defecto) | +0 MB | No funciona |
| **`embedBootstrapper`** (elegido) | +~2 MB | Solo si WebView2 ya está |
| `offlineInstaller` | **+127 MB** | Funciona siempre |

Se elige el intermedio porque Windows 11 trae WebView2 de serie y la mayoría de
los Windows 10 actualizados también. **Para un aula sin Internet y con equipos
antiguos hay que cambiar a `offlineInstaller`** y asumir los 127 MB — es una
línea en `tauri.conf.json`, y la decisión depende de dónde se vaya a instalar.

### Datos del usuario

No se borran al desinstalar. `%LOCALAPPDATA%\SimuladorECG` sobrevive, con la
base de datos y los logs dentro; quien quiera borrarlos lo hace a mano. Tirar
el historial de sesiones de alguien sin preguntar es lo que no se puede
deshacer.

### Verificado

`apps/desktop/tools/probar_instalador.ps1` hace el ciclo entero sin
intervención:

```
Instalador: 32 MB   (los 95 MB del backend, comprimidos por NSIS)
instalado en: %LOCALAPPDATA%\Simulador ECG
backend dentro de la instalación: True
ventana: 'Simulador de ECG'
backend arrancado por la aplicación: True (111 MB)
sin procesos huérfanos
binarios borrados: True
base de datos del usuario conservada: True
```

El script **deduce** la ruta de instalación del registro y el nombre del
ejecutable del directorio, en vez de suponerlos: la primera versión daba por
fallida una instalación que había funcionado, solo porque el binario se llama
`simulador-ecg.exe` (el nombre del crate) y no `Simulador ECG.exe`.

### Lo que sigue sin probarse

**La máquina virtual limpia.** Aquí ya están Python, Node, Rust y WebView2:
probar la instalación en este equipo no demuestra que funcione en uno virgen, y
el camino de «Windows 10 sin WebView2» sigue sin ejercitarse.

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
