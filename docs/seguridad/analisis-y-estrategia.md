# Seguridad: análisis del estado actual y estrategia

Fecha: 8 de agosto de 2026 · Rama: `feat/ecg-seguridad` · Commit analizado: `5127a76`

Este documento no propone endurecer todo a la vez. Propone decidir **contra qué
escenario de despliegue** se protege, porque el mismo código es razonablemente
seguro en un portátil y claramente insuficiente en internet, y las medidas de un
caso son ruido en el otro.

## 1. Qué hay que proteger aquí

El simulador no trata datos clínicos de personas reales: el paciente es
sintético y la señal la genera el motor. Eso descarta de entrada la parte más
cara del cumplimiento sanitario. Lo que sí hay que proteger son tres cosas:

**Disponibilidad en clase.** Si el servidor se cae a mitad de una sesión con
treinta alumnos delante, el daño es real aunque no haya datos comprometidos. Es
el activo más expuesto hoy, porque un solo cliente puede saturar el proceso.

**Integridad del contenido docente.** Un ECG manipulado enseña medicina
incorrecta. El proyecto ya tiene aquí una defensa que no se construyó pensando
en seguridad pero funciona como tal: la señal es determinista, cada sesión
guarda `seed`, `engine_semver` y `engine_commit`, y hay golden signals en tres
niveles. Eso permite demostrar que un trazado es el que dice ser. Conviene
tratarlo explícitamente como control de integridad y no solo como test.

**Datos personales de quien usa el sistema.** Hoy son pocos pero existen:
`drug_administrations.operator` y `.notes` son texto libre donde acabará
escribiéndose el nombre de un residente. En cuanto haya evaluación del alumno
—fase 2 del roadmap— habrá calificaciones, que son datos personales con
consecuencias académicas. Ahí entra el RGPD, no antes.

## 2. Tres escenarios, tres niveles de exigencia

| | E1 · Portátil del docente | E2 · LAN del aula o del departamento | E3 · Internet / LMS |
|---|---|---|---|
| Quién llega al puerto | solo quien está sentado delante | cualquier equipo de la red | cualquiera |
| Riesgo dominante | ninguno serio | disponibilidad, curioseo de sesiones | todo lo anterior + suplantación y fuga |
| Autenticación | innecesaria | mínima (SSO o clave común) | obligatoria, con roles |
| Coste de ponerse al día | horas | días | semanas, y toca el modelo de datos |

Hoy el proyecto está construido para **E1** y arranca en E1 (`arrancar.bat` deja
todo en `localhost`). El salto peligroso es el que se da sin querer: alguien
levanta la API en el portátil, la conecta a la wifi del hospital y ya está en E2
sin haber cambiado nada.

## 3. Hallazgos sobre el código actual

Ordenados por lo que cambiarían si el despliegue pasa de E1 a E2. La referencia
OWASP es la del Top 10:2025.

### Alta prioridad al salir de localhost

**H1 · No hay autenticación ni autorización en ninguna ruta** (A01, A07).
`GET /api/sessions` ([sessions.py](../../apps/api/src/ecg_api/routers/sessions.py))
devuelve las cincuenta últimas sesiones de cualquiera, y el detalle incluye
`operator` y `notes`. El WebSocket acepta toda conexión que llegue. En E1 es una
decisión de fase correcta; en E2 significa que cualquier equipo de la red lee el
historial completo y arranca simulaciones.

**H2 · Un cliente puede tumbar el servicio** (A06). Cada conexión a
`/ws/simulation` lanza cuatro tareas de fondo y genera doce canales a 500 Hz.
No hay límite de conexiones por IP, ni de sesiones simultáneas, ni de tamaño de
mensaje. Y el despliegue es de **un solo worker por diseño** —el estado de
simulación vive en memoria del proceso que sostiene el socket, documentado en
[main.py](../../apps/api/src/ecg_api/main.py)—, así que no hay otro proceso que
absorba la carga. Abrir cincuenta sockets desde un script satura la clase.

**H3 · El WebSocket no comprueba `Origin`** (A01). Está reconocido en el
comentario de `main.py`: CORS no cubre WS. La consecuencia práctica es que
cualquier página web que un alumno abra puede conectarse al servidor del aula y
consumir recursos. Sin autenticación no hay robo de sesión, pero el día que la
haya, esto se convierte en *cross-site WebSocket hijacking*.

**H4 · Postgres con credenciales por defecto y puerto abierto a todas las
interfaces** (A02). `docker-compose.yml` publica `5432:5432` con `ecg:ecg`. En
un portátil conectado a la red del centro, eso es una base de datos accesible
con una contraseña que está escrita en el repositorio.

### Media prioridad, arreglo barato

**H5 · `NaN` e `Infinity` atraviesan la validación** (A05). Verificado: Python
`json.loads` acepta los literales `NaN`, `Infinity` y `-Infinity`; Pydantic los
admite en un `float` salvo que se le diga lo contrario; y el `clamp` del motor
—`min(max(value, minimum), maximum)` en
[definitions.py:61](../../packages/ecg-engine/src/ecg_engine/catalog/definitions.py)—
devuelve `nan` cuando entra `nan`, porque las comparaciones con NaN son siempre
falsas. Es decir, el clamp protege de un `heart_rate_hz` de mil millones pero no
de un `NaN`. Lo que ocurre aguas abajo (motor, frames binarios, canvas) no lo he
ejecutado, pero un NaN propagándose a la señal no tiene ninguna interpretación
válida. Se corrige declarando rangos en los payloads de
[schemas.py](../../apps/api/src/ecg_api/schemas.py): `Field(gt=0, le=…)` y
`allow_inf_nan=False`.

**H6 · Los campos de texto no tienen longitud máxima** (A05). `operator`,
`notes`, `rhythm_id` y `drug_id` llegan como `str` sin `max_length` y se
persisten. Un cliente puede escribir megabytes en la base de datos. Y aunque
React escapa hoy la salida, un `notes` sin acotar es exactamente el material del
que se hace un XSS almacenado el día que alguien lo pinte en un informe HTML o
en un PDF.

**H7 · El detalle de la excepción viaja al cliente** (A10). En
[simulation_ws.py](../../apps/api/src/ecg_api/routers/simulation_ws.py), el
`except Exception` final llama a `_close_after_engine_failure(websocket,
str(exc))`, y ese texto acaba en el campo `detail` del mensaje de error. Un
error de SQLAlchemy o de asyncpg filtra estructura interna. El patrón correcto
es el de siempre: identificador de error al cliente, traza al log.

**H8 · `.gitignore` no cubre secretos ni entornos.** No hay reglas para `.env`
ni para `.venv/`. Hoy no hay ningún `.env` real en el árbol —solo
`.env.example`, que está bien—, así que no hay fuga. Pero la primera vez que
alguien escriba credenciales de una base de datos de verdad en `apps/api/.env`,
git se las ofrecerá para el commit. Es la corrección más barata de esta lista.

**H9 · Dependencias con vulnerabilidades conocidas** (A03). `npm audit
--package-lock-only` sobre `apps/web` reporta tres: `nanoid` (alta, bucle
infinito con `size` cero) y `esbuild`/`vite` (moderada,
[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99):
cualquier web puede enviar peticiones al **servidor de desarrollo** y leer la
respuesta). La de esbuild solo afecta a desarrollo, pero desarrollo es
precisamente donde se ejecuta este proyecto. `nanoid` se arregla con `npm audit
fix`; vite exige subir de versión mayor. No hay auditoría de dependencias en CI:
los dos workflows existentes son OSSF Scorecard, que puntúa prácticas del
repositorio pero no avisa de una CVE en un paquete.

**H10 · El frontend acepta el backend por query string** (A01 en cliente).
[App.tsx](../../apps/web/src/App.tsx) toma `?api=` y `?ws=` sin lista blanca. En
E1 es una comodidad de desarrollo. Publicado, un enlace
`…/?api=https://servidor-del-atacante` hace que la aplicación legítima hable con
un backend ajeno: señal falsa presentada con la interfaz de confianza, y
cualquier credencial futura enviada al atacante. Debe quedar detrás de una
comprobación de entorno de desarrollo o de una lista blanca.

### Pendiente, pero no todavía

Sin TLS (A04) todo viaja en claro: irrelevante en `localhost`, obligatorio en
E2. No hay cabeceras de seguridad ni CSP, lo que importa cuando el frontend se
sirva como estático en producción y no desde Vite. No hay registro de eventos de
seguridad ni alertas (A09): hoy los logs son de fallo de motor y persistencia,
que es lo correcto para la fase.

## 4. Estrategia por etapas

### Etapa 0 — Higiene (E1, horas de trabajo)

Todo esto se puede hacer sin tocar la arquitectura y conviene hacerlo aunque
nunca se salga del portátil:

1. `.gitignore`: `.env`, `*.env`, `.venv/`. (H8)
2. Rangos y `allow_inf_nan=False` en los payloads del WebSocket; `max_length` en
   los campos de texto. (H5, H6)
3. Sustituir `str(exc)` por un identificador de error en el mensaje al cliente.
   (H7)
4. `npm audit fix` para `nanoid`; planificar la subida de Vite aparte, porque
   cruza una versión mayor. (H9)
5. Publicar Postgres solo en la interfaz local: `127.0.0.1:5432:5432` en
   `docker-compose.yml`. Un cambio de once caracteres que cierra H4 en E1.
6. Restringir `?api=`/`?ws=` a `import.meta.env.DEV`. (H10)

Ninguna de estas seis toca el diseño ni obliga a rehacer tests. Son, en
conjunto, la mejor relación entre riesgo eliminado y esfuerzo del documento
entero.

### Etapa 1 — Salir a la red del aula (E2, días)

1. **Límites de recursos** — hecho. `limits.py` impone aforo total y por
   cliente, y el handler rechaza los mensajes desmedidos antes de parsearlos.
   Va primero y no tercero porque es el único de esta lista que protege incluso
   sin salir del portátil: con un solo worker, el aforo no es endurecimiento,
   es supervivencia. La IP real se lee de `X-Forwarded-For` solo si el
   despliegue declara un proxy de confianza (`TRUST_PROXY`).
2. **Terminación TLS en un proxy** — hecho como configuración, en
   `deploy/Caddyfile`. La aplicación no habla TLS y no debería. Queda por
   desplegarlo el día que haga falta.
3. **Comprobar `Origin` en el handler del WebSocket** — hecho, contra la misma
   lista que ya usa CORS. Cierra H3. Sin cabecera `Origin` se acepta: eso es un
   cliente que no es un navegador, y el ataque solo existe dentro de uno.
4. **Cabeceras de seguridad** — hecho para las respuestas de la API
   (`security_headers.py`). HSTS vive en el proxy, que es quien sabe si hay
   TLS; la CSP del frontend, en quien sirva el HTML.
5. **Autenticación mínima** — pendiente. Una clave compartida del aula,
   verificada en el primer mensaje del WebSocket y en un middleware para las
   rutas REST. No es identidad, es una puerta. Suficiente para E2 y honesta
   sobre lo que es. Va después de TLS a propósito: un login sobre HTTP en claro
   entrega la contraseña a la red, así que es peor que no tenerlo.

El punto 3 merece un matiz de viabilidad: con un solo worker, el límite de
conexiones **no es una medida de seguridad opcional sino de supervivencia**. Es
la decisión de arquitectura de `main.py` la que lo hace crítico, y quien quiera
levantar ese límite tendrá que sacar el estado de simulación del proceso, que es
un trabajo de fase 3, no un ajuste.

### Etapa 2 — Plataforma multiusuario (E3, semanas, toca el modelo de datos)

Esto ya no es endurecer: es construir lo que la fase 3 del roadmap describe.

1. **Identidad real**: OIDC contra el proveedor de la institución. Evita
   gestionar contraseñas, que es la parte que sale cara y mal.
2. **Autorización por rol** (alumno / instructor / administrador) y, sobre todo,
   **propiedad de los datos**: hoy `sessions` no tiene dueño. Añadir `owner_id`
   y filtrar por él en `list_sessions` y `get_session` es el cambio que convierte
   H1 en cerrado. Es una migración de Alembic y dos consultas, pero afecta a
   todo lo construido encima.
3. **Auditoría**: quién administró qué fármaco en qué sesión ya se registra; lo
   que falta es quién *era* esa persona de forma verificable.
4. **RGPD, cuando haya evaluación**: minimizar (no guardar nombres en `operator`
   si basta un identificador), definir retención, y poder borrar a petición. Se
   diseña ahora o se paga después.
5. **Escaneo en CI**: `npm audit` y `pip-audit` en cada PR, y Dependabot. Con
   Scorecard ya presente, el hueco es exactamente la detección de CVE.
6. **Integridad verificable del material exportado**: si un trazado se usa para
   evaluar, la exportación debería llevar el `seed`, la versión del motor y un
   hash. La pieza determinista ya existe; falta sellarla.

## 5. Lo que conviene no hacer todavía

Cifrar la base de datos a nivel de columna, montar un WAF, exigir MFA o
contratar un pentest son medidas de E3 que en E1 solo añaden fricción y dan
sensación de seguridad sin reducir riesgo. El mismo criterio que el CLAUDE.md
aplica a las fases del producto sirve aquí: la seguridad de una fase que no
existe no se implementa por adelantado, se diseña para que quepa.

Lo que sí conviene decidir ya es **el escenario objetivo**. Casi todo lo caro de
la etapa 2 viene de una sola decisión —que las sesiones tengan dueño— y esa
decisión es diez veces más barata antes de que existan mil sesiones sin él.
