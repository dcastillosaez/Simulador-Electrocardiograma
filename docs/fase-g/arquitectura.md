# Fase G — Escritorio, empaquetado, firma y actualizaciones

> Especificación de arquitectura. Se escribe **antes** de tocar código, y su
> propósito es fijar quién arranca qué, dónde viven los datos, cómo se migran,
> cómo se firma, cómo se actualiza y qué pasa cuando algo del arranque falla.
>
> Rama: `feat/ecg-desktop-fase-g` · Base: `822d418`

## 1. Qué es esta fase y qué no es

El objetivo es que alguien reciba un `.exe`, lo ejecute, y tenga el simulador
funcionando sin haber oído hablar de Docker, Python, npm ni PostgreSQL. Nada
más. La lógica clínica, el motor, la interfaz y el contrato del WebSocket **no
cambian**: lo que se añade es una capa de distribución y de gestión del ciclo
de vida alrededor de lo que ya funciona.

Fuera de alcance, explícitamente:

- **El corazón 3D.** La fase D no existe todavía. La G no puede depender de
  ella ni reservarle hueco en el instalador: si llega después, entra como
  contenido de la aplicación, no como componente del runtime.
- **Reescribir el frontend o el motor.** Si esta fase obliga a tocar
  `ecg-engine` o `pharmacology-engine`, algo se ha diseñado mal.
- **Multiusuario.** Un escritorio es un usuario. Eso simplifica media
  arquitectura y conviene aprovecharlo, no ignorarlo.

## 2. Decisiones

| Asunto | Decisión | Nota |
|---|---|---|
| Plataforma inicial | Windows 10/11 x64 | Único objetivo de la primera versión |
| Contenedor de escritorio | Tauri | El frontend ya es React/TS; no hace falta traer Chromium entero |
| Backend | El FastAPI actual, como proceso hijo | Sin cambios de contrato |
| Frontend | `vite build` servido por Tauri | Ni Node ni Vite en la máquina del usuario |
| Puerto | Efímero, elegido en arranque | Nunca 8000 fijo |
| Base de datos | SQLite en escritorio, PostgreSQL en servidor | Revisado y medido: ver §5 y g3-base-de-datos.md |
| Instalador | NSIS (`.exe`) generado por Tauri | MSI queda como alternativa |
| Firma | Certificado de firma de código + timestamping | Nunca en el repositorio |
| Actualizaciones | Updater de Tauri, con manifiesto firmado | Infraestructura desde G1, uso desde G6 |
| Licencia | Fichero firmado, verificado en el lado Rust | Funciona sin Internet |

### Lo que hay que verificar antes de comprometerse con Tauri

Tauri usa **WebView2**, que viene de serie en Windows 11 pero puede faltar en
Windows 10. El instalador tiene que incluir el bootstrapper o descargarlo, y
eso es una decisión de tamaño y de conectividad que hay que tomar en G4, no
descubrirla en el primer equipo del aula sin Internet.

## 3. Topología: quién arranca qué

```
Simulador ECG.exe            (Tauri, proceso raíz — Rust)
      │
      ├── WebView2 ────────► React compilado (dist/)
      │
      ├── ecg-api.exe ─────► FastAPI + ECG Engine + Pharmacology
      │                       127.0.0.1:<puerto efímero>
      │
      └── [motor de base de datos]   (ver §5)
```

**El proceso raíz es Tauri, y es el único que sobrevive a los demás.** Todo lo
que arranca, lo mata. Esto no es un detalle de implementación: es la diferencia
entre cerrar la ventana y quedarse con un Python y un Postgres huérfanos
ocupando memoria y un puerto hasta el siguiente reinicio.

Consecuencias que hay que respetar en el código:

- Los hijos se lanzan con **job object** de Windows, para que mueran con el
  padre aunque el padre muera de forma anormal. Matarlos "con educación" en el
  handler de cierre no basta: un `taskkill` sobre Tauri se salta ese handler.
- El backend **no debe demonizarse ni reiniciarse solo**. Si se cae, el que
  decide qué hacer es el shell, que es quien tiene interfaz para contarlo.
- Un solo worker de uvicorn, como ya documenta `main.py`. En escritorio eso
  deja de ser una restricción y pasa a ser lo natural.

## 4. Dónde viven los datos

Hoy la aplicación no tiene el concepto de "directorio de datos": todo cuelga
del repositorio. En escritorio hay que separarlo, porque los binarios van a
`Program Files` (solo lectura para el usuario) y los datos no pueden ir ahí.

```
%PROGRAMFILES%\Simulador ECG\        binarios, solo lectura
    Simulador ECG.exe
    resources\
        api\            (FastAPI empaquetado)
        web\            (React compilado)
        migrations\     (revisiones de Alembic)

%LOCALAPPDATA%\SimuladorECG\         datos del usuario, escribible
    db\                 (cluster o fichero de base de datos)
    logs\
        launcher.log
        api.log
    license.dat
    settings.json
```

Reglas:

- **Desinstalar borra `Program Files` y deja `LOCALAPPDATA`.** Los datos del
  usuario no se tiran sin preguntar; el desinstalador ofrece borrarlos como
  paso opcional y explícito.
- **Nada escribible dentro de `Program Files`.** Si algo necesita escribir ahí,
  está mal ubicado, y además fallará en cuanto la instalación sea por máquina.
- Los logs son el primer material de soporte. Rotación simple por tamaño, y un
  botón en la aplicación que abra la carpeta.

## 5. La base de datos: la decisión cara

Aquí es donde más conviene mirar el código antes de decidir, porque el esquema
actual **no es agnóstico de motor**:

- `db/models.py` importa `JSONB` y `UUID` de `sqlalchemy.dialects.postgresql`,
  y los usa en `rhythms.spec`, `sessions.params`, `sessions.id`,
  `drug_administrations.id` y `session_id`.
- Las dos migraciones (`0001_initial`, `0002_pharmacology`) declaran esos mismos
  tipos con `postgresql.JSONB()` y `postgresql.UUID()`.
- `db/seed.py` usa el `insert` de `dialects.postgresql` para el upsert.

Y un hallazgo que cambia el peso de la decisión: **el catálogo de ritmos no sale
de la base de datos**. `routers/rhythms.py` importa `list_rhythms` y `get_rhythm`
directamente de `ecg_engine`; la tabla `rhythms` existe únicamente como ancla de
la clave foránea de `sessions`, y su propio docstring lo dice. Es decir, **la
base de datos solo guarda historial**. Simular, medir, administrar fármacos y
exportar no la necesitan para nada.

### Opción A — PostgreSQL local, gestionado por la aplicación

No como servicio de Windows, sino como **proceso hijo del shell**, con los
binarios portables, `initdb` en el primer arranque sobre `%LOCALAPPDATA%` y
escuchando solo en `127.0.0.1` con puerto efímero. Así se evita la mitad de los
problemas del servicio (permisos, arranque automático, desinstalación sucia).

- **A favor**: cero cambios en el backend. El esquema, las migraciones y el
  upsert siguen siendo los mismos, y lo que se prueba en desarrollo es
  exactamente lo que corre en casa del usuario.
- **En contra**: entre 150 y 250 MB de binarios en el instalador; `initdb`
  añade segundos al primer arranque; un corte de luz a mitad de escritura puede
  dejar el cluster tocado y hay que decidir qué hace la aplicación entonces; y
  subir de versión mayor de PostgreSQL en una actualización exige `pg_dump` y
  restauración, que es un procedimiento que hay que escribir y probar.

### Opción B — SQLite en escritorio, PostgreSQL en servidor

- **A favor**: un fichero. Sin proceso, sin puerto, sin `initdb`, sin cluster
  que reparar, y el instalador adelgaza en unos 200 MB. Para un historial de
  sesiones de un solo usuario está sobradamente dimensionado.
- **En contra**: hay que hacer el esquema agnóstico. SQLAlchemy 2.0 tiene
  `sa.Uuid` y `sa.JSON` genéricos y SQLite soporta `ON CONFLICT DO UPDATE`, así
  que es viable, pero toca modelos, las dos migraciones y el `seed`, y obliga a
  ejecutar la suite de integración contra los dos motores para que el soporte
  sea real y no teórico.

### Recomendación — revisada

La recomendación provisional era **empezar por A** por separación de riesgos.
Tras medirlo, **la decisión es B**: SQLite en escritorio, PostgreSQL en
servidor. El motivo corto es que el riesgo que justificaba A —tocar el esquema y
romper el servidor— resulta ser evitable: con `with_variant`, PostgreSQL recibe
exactamente el mismo `JSONB` y el mismo `UUID` que hoy.

El análisis completo, con las mediciones y la prueba de concepto, está en
[g3-base-de-datos.md](g3-base-de-datos.md). Los tres datos que inclinaron la
balanza: el acoplamiento a PostgreSQL son cuatro líneas en dos ficheros; 35
sesiones reales ocupan 72 KB; y hoy, sin base de datos, la aplicación **no
arranca en absoluto**.

La decisión viene con una condición que no es opcional: **la suite de
integración tiene que correr contra los dos motores**, o el soporte de SQLite se
romperá sin que nadie se entere.

## 6. Migraciones

Alembic se queda. Lo que cambia es cómo se invoca, y esto **hoy no funcionaría
empaquetado**: `alembic.ini` declara `script_location = migrations` y
`prepend_sys_path = .`, rutas relativas al directorio de trabajo, y el conftest
construye `Config("alembic.ini")` igual. Dentro de un ejecutable, el directorio
de trabajo es donde el usuario haya hecho doble clic.

Lo que hay que hacer:

1. Construir el `Config` **programáticamente**, con `script_location` absoluto
   apuntando a `resources\migrations`, y la URL de la base de datos inyectada.
2. Empaquetar el directorio de revisiones como recurso de datos, no como código
   importable.
3. Ejecutar `upgrade head` en el arranque, **antes** de levantar FastAPI, y
   tratar su fallo como un fallo de arranque con mensaje propio (§7).
4. Registrar en el log la revisión de origen y la de destino. Cuando alguien
   reporte "se me han perdido las sesiones", eso será lo primero que se mire.

Y una regla para el futuro: **una migración de la fase G nunca puede ser
destructiva sin copia previa**. En servidor hay backups; en el portátil de un
docente, no.

## 7. Arranque, y qué pasa cuando falla

Secuencia del Runtime Manager:

```
1. leer configuración y licencia
2. preparar directorio de datos (crearlo si es el primer arranque)
3. arrancar el motor de base de datos      ── puede fallar
4. aplicar migraciones                     ── puede fallar
5. elegir puerto efímero y arrancar FastAPI ── puede fallar
6. esperar a /api/health con timeout       ── puede agotarse
7. abrir la ventana con la UI
```

Cada paso que puede fallar necesita **una respuesta decidida de antemano**, y
esa es la parte que se suele dejar sin escribir:

| Falla | Qué ve el usuario | Qué hace la aplicación |
|---|---|---|
| No se puede crear el directorio de datos | Error con la ruta concreta y "ejecuta como administrador o reinstala" | No arranca |
| El motor de base de datos no levanta | Aviso: "el historial de sesiones no estará disponible" | **Arranca igualmente** (ver abajo) |
| Las migraciones fallan | Aviso con la revisión y la ruta del log | Arranca en modo sin historial |
| FastAPI no levanta | Error de arranque, con el log a un clic | No arranca |
| `/api/health` no responde en N segundos | Error de arranque | Mata lo que haya arrancado y no arranca |

**El modo degradado es la decisión importante de esta sección.** Como el
catálogo sale del motor y no de la base de datos, el simulador puede simular,
medir, administrar fármacos y exportar sin base de datos: lo único que se pierde
es guardar y consultar sesiones. Para un docente delante de una clase, "el
historial no está disponible" es un problema muy pequeño y "el simulador no
arranca" es un desastre.

Esto exige un cambio concreto en el backend, que hoy no lo permite: el
`lifespan` de `main.py` llama a `seed_catalog` contra Postgres, y si falla, la
aplicación entera no arranca. Hay que introducir un estado "sin persistencia" y
que los endpoints de sesiones respondan un error claro en vez de reventar.

El apagado, en orden inverso: parar la simulación, cerrar el WebSocket, apagar
FastAPI, apagar la base de datos, salir. Con un plazo por paso y matar por las
bravas al vencerlo — un apagado que se cuelga es peor que uno brusco, porque el
usuario acaba matando el proceso igual pero después de esperar.

## 8. Cómo llega el puerto a la interfaz

Este punto tiene una trampa que ya está en el código. `App.tsx` resuelve el
backend así:

```ts
const override = (name: string) => (import.meta.env.DEV ? params.get(name) : null);
const API_BASE_URL = override("api") ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
```

Los parámetros `?api=` y `?ws=` **solo funcionan en desarrollo**: se restringieron
a propósito, porque publicados permitían que un enlace apuntara la interfaz de
confianza a un backend ajeno. En escritorio, el frontend está compilado
(`DEV === false`), así que ese camino está cerrado — y las variables `VITE_*` se
hornean en tiempo de compilación, cuando todavía no se sabe qué puerto tocará.

La vía correcta es que **el shell se lo diga a la interfaz en tiempo de
ejecución**: Tauri expone un comando (`get_backend_url`) que el frontend invoca
al arrancar, antes de crear el `SessionRuntime`. Requiere:

- Un `RuntimeMode = "browser" | "desktop"` detectado por la presencia del puente
  de Tauri, no por una variable de compilación.
- Que `ECGWorkspace` acepte la URL de forma asíncrona (hoy llega como prop desde
  `App.tsx`, que la resuelve de forma síncrona en el módulo).

No se toca `simulation-runtime`: sigue recibiendo una URL y hablando el mismo
protocolo. Cambia quién se la da.

## 9. Seguridad en modo escritorio

El endurecimiento de la fase anterior se diseñó para un servidor en red, y en
escritorio algunas piezas cambian de sentido:

- **Origen.** El WebSocket comprueba `Origin` contra `CORS_ORIGINS`. Tauri sirve
  la interfaz desde un esquema propio (`tauri://localhost` o
  `https://tauri.localhost` en Windows), que hoy sería rechazado. Hay que
  añadirlo a la lista **en modo escritorio únicamente**, no aflojar la
  comprobación.
- **Aforo.** `MAX_WS_CONNECTIONS=50` es un número de aula. En escritorio bastan
  2 o 3: sobra para la ventana y una recarga, y cierra el paso a cualquier otro
  proceso local que quiera abrir sockets contra el backend.
- **`TRUST_PROXY` siempre `false`.** No hay proxy.
- **El backend escucha solo en `127.0.0.1`.** Nunca `0.0.0.0`, aunque sea
  tentador para "poder verlo desde otro equipo": eso convierte cada instalación
  en un servidor sin autenticar.
- **Token de arranque.** El shell genera un secreto por sesión y lo pasa al
  backend y a la interfaz; el backend rechaza lo que no lo traiga. Cierra el
  hueco de que cualquier proceso local del mismo equipo hable con el simulador.
  Es barato aquí y reutilizable como base del login de la Etapa 1 del análisis
  de seguridad.

## 10. Firma

Dos cosas distintas, ambas necesarias: firmar **los binarios** que se
distribuyen y firmar **el instalador**.

- Timestamping siempre. Sin él, la firma deja de validar cuando el certificado
  caduca, y eso convierte una versión antigua perfectamente buena en una alerta
  de seguridad.
- La clave privada **no entra en el repositorio ni en las variables de un
  workflow como fichero**. La firma ocurre en un paso de la pipeline que habla
  con un servicio de firma o con un HSM; el repositorio solo conoce el
  identificador del certificado.
- Conviene saberlo de antemano: un certificado nuevo, incluido EV, **no elimina
  automáticamente los avisos de SmartScreen**. La reputación se construye con
  descargas e instalaciones a lo largo del tiempo. Los primeros usuarios verán
  el aviso, y merece la pena tener escrito qué contarles.

## 11. Actualizaciones

La infraestructura se deja preparada desde G1 aunque no se use hasta G6, porque
retrofitar un updater exige que la versión ya instalada sepa actualizarse — y la
primera que se distribuye sin él no lo sabrá nunca.

```
arranque → consultar manifiesto → ¿hay versión nueva?
                                        │
                              no ──► seguir arrancando
                              sí ──► descargar → verificar firma → instalar → reiniciar
```

Reglas:

- **La verificación de firma del paquete descargado no es opcional.** Un updater
  que descarga por HTTP y ejecuta lo que le llega es un mecanismo de instalación
  remota de malware con nuestro nombre encima.
- **Nunca actualizar a mitad de una clase.** Se comprueba al arrancar, no
  durante el uso, y siempre se puede posponer.
- **Rollback.** Si la versión nueva no arranca dos veces seguidas, volver a la
  anterior. Esto obliga a conservar la instalación previa y a que las
  migraciones de base de datos sean compatibles hacia atrás dentro de una misma
  serie, o a hacer copia antes de migrar.
- Sin Internet, la aplicación arranca igual. La comprobación falla en silencio
  y se registra en el log.

## 12. Licencia

Fichero firmado criptográficamente, con la clave pública en la aplicación y la
privada fuera de ella:

```json
{ "product": "SimuladorECG", "edition": "Professional",
  "customer": "…", "expires": "2027-12-31",
  "features": ["ecg", "pharmacology", "heart3d"] }
```

Tres decisiones que conviene fijar ahora:

1. **La verificación va en el lado Rust, no en Python.** Un `.pyc` se sustituye
   con un editor de texto y un intérprete embebido carga lo que le pongas
   delante; el binario de Tauri es bastante más caro de parchear. Ninguna de las
   dos es inviolable, y ese no es el objetivo.
2. **Funciona sin Internet.** Un hospital sin conexión no puede quedarse sin
   simulador. La comprobación en línea, si existe, es para renovar y para
   revocar, con un periodo de gracia generoso.
3. **Ser honesto sobre el alcance.** Esto detiene la copia casual —pasarse el
   `.exe` entre compañeros— y nada más. Un programa que se ejecuta en la máquina
   del usuario se puede copiar; lo que se puede subir es el coste, no bajarlo a
   cero.

## 13. Aviso de uso previsto

El CLAUDE.md del proyecto lo dice: el uso previsto es **docencia**. Distribuir
esto como producto instalable en hospitales cambia el contexto lo suficiente
como para que el aviso deje de vivir solo en un fichero del repositorio.

En la fase G el aviso tiene que estar **en la aplicación**: en el instalador, en
la ventana de "Acerca de", y en la exportación PNG. No es burocracia — es la
diferencia entre un simulador docente y algo que alguien podría acabar mirando
al lado de una cama. Y si el producto se acerca a herramienta de apoyo clínico,
las implicaciones regulatorias son otras y deben decidirse explícitamente, no
por deriva.

## 14. Plan por sub-fases

Resumen. El detalle de cada una —alcance, tareas, entregables, criterios de
aceptación, riesgos y estimación— está en [plan-de-fases.md](plan-de-fases.md).

| Fase | Contenido | Se considera hecha cuando |
|---|---|---|
| **G1** Shell | Tauri, React compilado, ventana, icono, splash | La ventana abre y muestra la interfaz sin backend, con un error decente |
| **G2** Runtime Python | Empaquetado de FastAPI y los dos motores, arranque, health check, apagado limpio | Se abre y se cierra cien veces sin dejar procesos huérfanos |
| **G3** Base de datos | Esquema portable, SQLite en escritorio, migraciones programáticas, **modo degradado** (ver [g3-base-de-datos.md](g3-base-de-datos.md)) | Arranca, simula y mide con la base de datos borrada, y lo dice |
| **G4** Instalador | NSIS, accesos directos, desinstalador, WebView2, datos separados | Instala y desinstala limpio en una máquina virgen |
| **G5** Firma | Certificado, binarios, instalador, timestamping, CI | Una descarga desde otra máquina no muestra "editor desconocido" |
| **G6** Actualizaciones | Manifiesto, descarga, verificación, instalación, rollback | Una versión rota vuelve sola a la anterior |
| **G7** Licencia | Verificación en Rust, activación, gracia offline, features | Sin licencia se degrada como está especificado, sin Internet funciona |
| **G8** Release | `git tag` → build → test → paquete → firma → smoke test → release | Un tag produce un instalador firmado sin intervención manual |

El orden importa: **G2 antes que G3** (un backend que arranca sin base de datos
es más fácil de depurar que los dos a la vez), y **G4 antes que G5** (firmar algo
que todavía cambia de forma es tirar el tiempo).

## 15. Riesgos

- **Tamaño del instalador.** Python + numpy + PostgreSQL se va fácil a 400 MB.
  Es aceptable si se sabe de antemano; es un problema si se descubre en G4.
- **Antivirus.** Los ejecutables empaquetados con PyInstaller son un clásico de
  los falsos positivos. La firma ayuda; conviene probar contra varios motores
  antes de distribuir, no después del primer cliente asustado.
- **Primer arranque lento.** `initdb` más migraciones más el arranque de Python
  pueden ser diez segundos largos. Necesita splash con texto real de lo que está
  pasando, no una barra que sube sola.
- **Procesos huérfanos.** El riesgo más probable de toda la fase, y el más
  molesto para el usuario. Es el criterio de aceptación de G2 por algo.
- **El motor sigue evolucionando.** Empaquetar no puede congelar el desarrollo:
  hay que poder seguir trabajando con `arrancar.bat` mientras existe el
  instalador, y eso significa que **Docker no desaparece del repositorio**, solo
  de la máquina del usuario final.
