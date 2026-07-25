# Simulador de ECG — Diseño de la Fase 1 (MVP)

**Fecha:** 2026-07-25
**Estado:** aprobado, listo para plan de implementación
**Alcance:** Fase 1 del roadmap descrito en `CLAUDE.md`

---

## 1. Qué construimos

Un simulador de ECG usable y estable, con motor fisiológico real detrás. No una demo que dibuja ondas bonitas: el objetivo de esta fase es dejar montada la arquitectura que soportará las fases 2 y 3 sin reescrituras.

Concretamente, al final de la fase 1 debe existir:

- 12 ritmos generados por un motor fisiológico parametrizable, visibles en las 12 derivaciones estándar.
- Trazado en tiempo real a 60 fps sobre Canvas 2D, con grid clínico y layouts de 1, 3, 6 y 12 derivaciones.
- Controles en caliente de frecuencia cardíaca, ruido, ganancia y velocidad de papel.
- Streaming de señal por WebSocket desde un backend Python.
- Persistencia de sesiones cerradas en PostgreSQL, reproducibles a partir de su semilla.
- Suite de tests por capas, incluyendo golden signals.

### Catálogo de ritmos del MVP

Los doce esenciales, los que un residente ve en urgencias:

Ritmo sinusal normal · taquicardia sinusal · bradicardia sinusal · fibrilación auricular · flutter auricular · taquicardia supraventricular · taquicardia ventricular · fibrilación ventricular · bloqueo AV de 1.er grado · bloqueo AV de 2.º grado Mobitz I · bloqueo AV de 3.er grado · IAM con elevación del ST.

Los nueve restantes del catálogo de `CLAUDE.md` —BRI, BRD, pericarditis, hiperpotasemia, hipopotasemia, hipocalcemia, hipercalcemia, WPW y torsades— entran en fase 2 como datos, no como código nuevo. La arquitectura está diseñada para que así sea.

---

## 2. Supuestos y no-objetivos del MVP

Esta sección existe para que nadie —incluido el yo de dentro de tres meses— confunda una decisión deliberada con un descuido.

### No-objetivos explícitos

| No hay | Por qué | Cuándo |
|---|---|---|
| **Multiworker** | El estado de simulación vive en memoria del proceso que sostiene el WebSocket. Varios workers romperían el binding socket↔motor. | Fase 3, vía sticky sessions o estado en Redis |
| **Autenticación** | Un solo usuario implícito. Las sesiones se guardan sin asociar a cuenta. | Fase 3 |
| **Redis** | Sin auth y con el estado en el proceso WS, no aporta nada. YAGNI. | Cuando llegue el multiworker |
| **Reconexión automática** | Un bucle de reconexión enmascara fallos reales del motor. El cliente muestra el estado y ofrece reconectar a mano. | Se reevalúa en fase 2 |
| **Persistencia en la ruta caliente** | El WebSocket solo simula y transmite. Cero escrituras por chunk. | Nunca. Es una regla, no una limitación |
| **Motor de escenarios con narrativa** | En fase 1, un "escenario" es `{ritmo, parámetros iniciales}`. Sin línea temporal, eventos ni branching. | Fase 2 |
| **Tests visuales por captura** | Los golden signals a nivel de muestras cubren la regresión de señal. La comparación visual pixel a pixel es otra categoría de trabajo. | Fase 4 |
| **Intervenciones y evaluación del alumno** | Requieren el motor de escenarios completo. | Fase 2 |

### Supuestos

- **Despliegue con un único worker de uvicorn.** Es una restricción arquitectónica documentada del MVP, no un accidente de configuración.
- **Frecuencia de red de 50 Hz** (Europa). El artefacto de interferencia se modela a esa frecuencia.
- **Frecuencia de muestreo de 500 Hz**, estándar diagnóstico.
- **Uso docente exclusivamente.** El posicionamiento regulatorio del proyecto depende de ello.

---

## 3. Arquitectura general

Tres procesos, orquestados con `docker-compose`: FastAPI (motor y API), React/Vite (interfaz) y PostgreSQL.

```
Simulador_Electrocardiograma/
├── apps/
│   ├── api/            FastAPI: REST, endpoint WS, capa de datos
│   └── web/            React + TypeScript + Vite, render Canvas 2D
├── packages/
│   ├── ecg-engine/     paquete Python puro — motor fisiológico
│   └── shared-types/   esquemas de mensajes y catálogo; genera tipos TS
├── docs/
│   ├── domain-model/
│   ├── scenario-spec/
│   └── clinical-reference/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── golden-signals/
└── docker-compose.yml
```

La regla estructural que importa: **`ecg-engine` no importa nada de `apps/api`**. Se ejecuta bajo pytest sin levantar un servidor. Eso es precisamente lo que hace posible el testing de golden signals y lo que permitirá, si algún día hace falta rendimiento, mover el motor a Rust sin tocar la API.

### Flujo de datos

1. El cliente pide `GET /api/rhythms` y recibe el catálogo con parámetros ajustables, rangos válidos y valores por defecto.
2. Abre `WS /ws/simulation` y envía `start` con el ritmo, los parámetros y opcionalmente una semilla.
3. El backend instancia el motor y emite chunks de 100 ms a 500 Hz —12 derivaciones × 50 muestras—, unos diez mensajes por segundo. El payload va en Float32 binario para no pagar el coste de JSON en la ruta caliente.
4. El cliente bufferiza en torno a 500 ms y dibuja con `requestAnimationFrame`, en modo barrido de monitor.
5. Los controles viajan como mensajes `update` sobre el mismo socket. El motor los aplica en caliente, sin recrear la simulación.
6. Al cerrar, la API persiste la sesión con su ritmo, parámetros, semilla, duración y versión del motor.

El desacople entre los 500 Hz de generación y los 60 fps de dibujo es deliberado: el motor produce a ritmo fisiológico y el canvas consume lo que hay disponible.

---

## 4. Contrato del frame binario

Little-endian en todos los campos. Cabecera fija de 40 bytes:

| Offset | Tipo | Campo | Valor |
|---|---|---|---|
| 0 | uint16 | `version` | 1 |
| 2 | uint16 | `sample_rate_hz` | 500 |
| 4 | uint8 | `n_channels` | 12 |
| 5 | uint8 | `reserved` | 0 |
| 6 | uint16 | `n_samples_per_channel` | 50 |
| 8 | uint32 | `sequence_number` | — |
| 12 | uint32 | `reserved2` | 0 |
| 16 | float64 | `t_start_s` | tiempo de simulación de la 1.ª muestra |
| 24 | byte[16] | `session_id` | UUID canónico |
| 40 | float32[] | payload | channel-major |

**Orden canónico de canales**, fijo: I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6.

**Layout channel-major**: todas las muestras de I, luego todas las de II, y así sucesivamente. El canvas dibuja derivación a derivación, de modo que cada una queda como un slice contiguo de memoria.

La cabecera de 40 bytes deja el payload alineado a 4, requisito de `new Float32Array(buffer, 40, n)` en JavaScript. No es un número arbitrario.

**`session_id`**: UUID canónico de 16 bytes, serializado en orden de red. El cliente lo interpreta exactamente igual que el backend; no hay conversión ni reordenación de bytes en ningún extremo.

**`sequence_number`**: monótono creciente dentro de una sesión, empezando en 0. Se reinicia con cada sesión nueva. Un salto a 0 acompañado de un `session_id` distinto identifica un reinicio de forma inequívoca; un salto hacia adelante dentro de la misma sesión indica frames perdidos; un valor inferior al último recibido indica un frame fuera de orden, que se descarta.

Los mensajes de control siguen siendo JSON en frames de texto. Solo los datos van en binario.

---

## 5. Motor fisiológico

### La decisión central: dos trenes independientes

El latido no se modela como una unidad monolítica P+QRS+T. Hay dos trenes de eventos independientes —uno auricular, que emite ondas P, y otro ventricular, que emite QRS+T— enlazados por una capa explícita de reglas de conducción.

Esa decisión es la que convierte los doce ritmos en datos en lugar de en doce casos especiales:

- **Sinusal**: cada P conduce, con PR fijo.
- **BAV 1.º**: PR fijo pero prolongado.
- **BAV 2.º Mobitz I**: el PR crece latido a latido hasta que una P no conduce.
- **BAV 3.º**: los dos trenes corren a frecuencias distintas sin relación entre sí —aurícula en torno a 75, escape ventricular en torno a 40—. Fisiológicamente es exactamente eso, y sale gratis del modelo.
- **Flutter**: tren auricular a 300 con morfología en dientes de sierra, conducción 2:1 o 4:1.
- **FA**: sin tren auricular organizado (ondas f caóticas) y conducción irregular.
- **TSV y TV**: solo tren ventricular, con QRS estrecho o ancho.

La fibrilación ventricular es la única excepción al modelo: no hay latidos discretos, así que se genera como señal caótica continua —suma de senoides moduladas en frecuencia y amplitud— con tres parámetros explícitos: granularidad (fina o gruesa), amplitud pico a pico y frecuencia dominante, entre 4 y 10 Hz. Implementa la misma interfaz pública que el resto, de modo que sigue siendo intercambiable y testeable igual que cualquier otra fuente.

### Eventos primero, señal después

El scheduler produce una línea temporal de `CardiacEvent(tipo, t_s, morfología)`. Un renderer separado la convierte en muestras.

El beneficio es doble. Por un lado se puede volcar el log de eventos para depurar preguntas del tipo "¿cuándo ocurrió exactamente esa P?". Por otro, los tests se escriben contra eventos discretos en lugar de contra arrays de floats, lo que los hace legibles y mantenibles. Los golden signals pasan a tener dos niveles: golden de eventos y golden de muestras.

### Módulos

| Módulo | Responsabilidad |
|---|---|
| `types.py` | **Lugar canónico** de los contratos de dominio: `CardiacEvent`, `RhythmSource`, `ConductionState`, `MorphologyOverlay`, `SignalChunk`, `LeadSet`, `EngineParams`. Ningún otro módulo define tipos compartidos |
| `waveform.py` | Gaussianas paramétricas vectorizadas con numpy |
| `beat.py` | Plantillas de latido e intervalos PR, QRS, QT |
| `leads.py` | Proyección a las 12 derivaciones por coeficientes |
| `overlays.py` | `MorphologyOverlay`: cambios morfológicos por derivación |
| `rhythm.py` | Trenes de eventos y scheduler |
| `conduction.py` | `ConductionState` y políticas de conducción |
| `variability.py` | Variabilidad fisiológica normal |
| `noise.py` | Artefactos de medición |
| `renderer.py` | Eventos + overlays + ruido → muestras. Nada más |
| `catalog/` | Los doce ritmos, como datos |
| `engine.py` | Orquestador: `generate(n)`, `update_params()` |

### Morfología: suma de gaussianas paramétricas

Cada onda —P, Q, R, S, T— es una gaussiana definida por amplitud, centro y anchura. Las patologías se obtienen moviendo parámetros: ensanchar el QRS es subir sigma, elevar el ST es aplicar un offset al segmento, aplanar la P es bajar su amplitud.

Se descartaron dos alternativas. Las plantillas muestreadas de latidos reales dan mejor realismo visual de entrada, pero parametrizar patologías obliga a mantener una plantilla por variante, lo cual escala mal y ata el motor a un dataset concreto. El modelado del dipolo cardíaco en 3D con proyección geométrica a las derivaciones es fisiológicamente más fiel y permitiría simular desviaciones del eje de verdad, pero es bastante más trabajo del que justifica un MVP. Queda como camino de migración para la fase 4, y la capa de proyección está diseñada para que ese cambio no toque la API.

La proyección a las doce derivaciones se hace mediante una tabla de coeficientes por derivación, con overrides puntuales para patologías localizadas.

### Conducción

El tren auricular solo emite eventos P a su frecuencia; no sabe nada de bloqueos. `ConductionState` consume cada evento auricular y decide si conduce y con qué PR. Las políticas son intercambiables:

- `FixedPR` — sinusal, taquicardia y bradicardia sinusales.
- `FixedPR` prolongado — BAV de 1.er grado.
- `WenckebachPR` — incremento del PR por ciclo hasta el latido caído. Mobitz I.
- `FixedRatioBlock(n:m)` — conducción 2:1 o 4:1 del flutter. La misma política cubriría el Mobitz II, que no entra en el MVP.
- `CompleteBlock` — con fuente de escape ventricular independiente. BAV de 3.er grado.
- `IrregularConduction` — fibrilación auricular.

Añadir preexcitación o un Wenckebach de periodicidad variable consiste en escribir una política nueva, sin tocar los trenes.

### Overlays morfológicos

Un `MorphologyOverlay` declara qué derivaciones toca y cómo: offset del ST, inversión de la T, ensanchamiento del QRS, aplanamiento de la P.

El IAM con elevación del ST no es un ritmo nuevo. Es ritmo sinusal normal más un overlay de elevación del ST aplicado a un subconjunto de derivaciones. Ese es el patrón para toda la patología morfológica futura: pericarditis, hiperpotasemia e hipopotasemia entran en fase 2 como datos de catálogo.

### Variabilidad fisiológica

Un único **oscilador respiratorio compartido**, entre 12 y 20 respiraciones por minuto, alimenta simultáneamente tres fenómenos:

- La arritmia sinusal respiratoria, que modula el intervalo RR.
- La variación de amplitud latido a latido, del orden del 2 al 5 %.
- La deriva de la línea base.

Que los tres compartan oscilador no es un atajo de implementación: es lo que ocurre fisiológicamente, y hace que el trazo "respire" de forma coherente en lugar de temblar al azar en tres direcciones distintas. Encima se le suma un jitter aleatorio pequeño en el RR, del 1 al 2 %.

### Ruido y artefactos

| Artefacto | Naturaleza | Ámbito | Dependencias |
|---|---|---|---|
| Ruido muscular (EMG) | aditivo | por derivación, independiente | banda 20–150 Hz |
| Interferencia de red 50 Hz | aditivo | común a todas | ninguna |
| Deriva de línea base | aditivo | por derivación, escalado | ciclo respiratorio |
| Artefacto de movimiento | aditivo + multiplicativo | por derivación, en ráfagas | — |
| Saturación / clipping | no lineal | global | último de la cadena |

**Orden de la cadena, fijo**: señal base → overlays → variabilidad → ruido aditivo → modulación multiplicativa → clipping.

### La frontera entre ruido y variabilidad

Conviene tenerla escrita porque se confunde con facilidad.

**Variabilidad fisiológica** es señal real del paciente: estaría ahí aunque el electrodo fuera perfecto. Arritmia sinusal respiratoria, variación de amplitud latido a latido.

**Ruido** lo introduce la medición: EMG, red eléctrica, movimiento, clipping. Nunca debe alterar los intervalos reales del evento subyacente.

Hay un caso limítrofe que hay que dejar resuelto de antemano: **la deriva de línea base es un artefacto de medición** —impedancia cambiante por el movimiento del tórax— aunque su origen sea fisiológico. Por eso vive en `noise.py`, aunque se alimente del oscilador respiratorio de `variability.py`. Sin esta nota, alguien acabará clasificándola mal.

La consecuencia práctica está en los tests: los de fisiología corren siempre con el ruido a cero; los de ruido corren sobre señal base conocida. No se mezclan nunca.

### El renderer es deliberadamente tonto

`renderer.py` recibe eventos, overlays y parámetros de ruido, y devuelve muestras. No decide nada fisiológico: ni cuándo late el corazón, ni si una P conduce, ni cuánto varía el RR.

El criterio es sencillo: si alguna vez hay que preguntarle a `renderer.py` "¿por qué el ECG hace esto?", la lógica está en el sitio equivocado. Toda la lógica médica vive antes, en `rhythm.py`, `conduction.py`, `variability.py` y `overlays.py`.

### Determinismo

Todo lo aleatorio pasa por un `numpy.random.Generator(PCG64(seed))` propio de la sesión. Mismo seed y mismos parámetros producen la misma señal bit a bit. Sin eso no hay golden signals ni replay posible.

---

## 6. API

### REST — plano de control

Nunca en la ruta caliente.

| Endpoint | Descripción |
|---|---|
| `GET /api/rhythms` | Catálogo con parámetros ajustables, rangos válidos y defaults |
| `GET /api/rhythms/{id}` | Detalle y spec del ritmo |
| `GET /api/sessions` | Historial |
| `GET /api/sessions/{id}` | Detalle de sesión |
| `GET /api/health` | Salud del servicio |

No hay `POST /api/sessions`. La sesión la escribe el propio handler del WebSocket al cerrarse, según las reglas de la sección 7. Exponer además un endpoint de escritura crearía dos caminos para el mismo dato y abriría la puerta a sesiones inventadas por el cliente.

### WebSocket `/ws/simulation`

Control en JSON de texto, datos en binario.

| Cliente → servidor | Servidor → cliente |
|---|---|
| `start {rhythm_id, params, seed?}` | `started {session_id, seed, sample_rate, channels}` |
| `update {params}` | `updated {params efectivos}` |
| `pause` / `resume` | `paused` / `resumed` |
| `stop` | `stopped {duration_s}` |
| — | `error {code, detail}` |

**Pausar no es congelar.** `pause` detiene el reloj de simulación en el servidor. Congelar la pantalla es una acción puramente de cliente sobre el buffer, pensada para medir intervalos sin detener la simulación. Son dos cosas distintas y ambas hacen falta.

### Reparto de parámetros

El motor recibe únicamente lo que cambia la señal generada: frecuencia cardíaca y niveles de ruido.

Todo lo demás es render y vive en el cliente: velocidad de papel (25 o 50 mm/s), ganancia (×0,25 a ×2), calibración a 10 mm/mV y layout de 1, 3, 6 o 12 derivaciones. Cambiar el layout no debe generar ni un byte de tráfico de red.

---

## 7. Persistencia

PostgreSQL con Alembic para migraciones.

```sql
rhythms (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  category       text NOT NULL,
  spec           jsonb NOT NULL,
  engine_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

sessions (
  id             uuid PRIMARY KEY,
  rhythm_id      text NOT NULL REFERENCES rhythms(id),
  params         jsonb NOT NULL,
  seed           bigint NOT NULL,
  engine_version text NOT NULL,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz,
  duration_s     numeric
);
```

La base de datos recibe exclusivamente: el catálogo, las sesiones cerradas, los resultados y, como mucho, snapshots puntuales que pida el usuario al congelar o exportar. Nada de persistir chunks de 100 ms.

`engine_version` en `sessions` es lo que hace honesto el replay: si el motor cambió entre la grabación y la reproducción, la sesión ya no reproduce idéntica, y el sistema lo sabe en vez de mentir.

Una sesión se persiste al recibir `stop` explícito, o al cerrarse el socket si duró cinco segundos o más.

---

## 8. Frontend

```
apps/web/src/
├── engine-client/   cliente WS, decodificador de frames, buffer y sus políticas
├── render/          grid clínico, trazado por derivación, layouts 1/3/6/12
├── ui/              controles, selector de ritmo, panel de parámetros
├── state/           Zustand
└── types/           generados desde shared-types
```

El decodificador y el buffer son lógica pura, sin DOM. Separarlos del canvas es exactamente lo que los hace verificables con tests unitarios rápidos.

### Política de buffer

Documentada como comportamiento esperado del cliente, no como detalle de implementación:

- **Objetivo**: 500 ms. Rango sano: 300 a 700 ms.
- **Underrun** (buffer vacío): congelar el trazo en la última muestra y mostrar un indicador de espera de señal. Nunca saltar ni interpolar.
- **Overrun** (por encima de 700 ms, lo típico al volver de una pestaña en segundo plano): descartar lo más antiguo hasta recuperar el objetivo de 500 ms.

### Grid clínico

Cuadrícula menor de 1 mm y mayor de 5 mm. A 25 mm/s, 1 mm equivale a 40 ms. Calibración estándar de 10 mm/mV.

---

## 9. Manejo de errores

| Situación | Respuesta | ¿Cierra el socket? |
|---|---|---|
| Parámetros fuera de rango | `error {code: "INVALID_PARAMS"}` | No |
| Ritmo inexistente | `error {code: "NOT_FOUND"}` | No |
| Fallo del motor | `error {code: "ENGINE_FAILURE"}`, cierre 1011 | Sí |
| Cliente desconecta | Liberar motor, persistir si duró ≥ 5 s | — |
| Buffer de envío saturado | Descartar frames antiguos | No |

Ante un fallo del motor, el log estructurado registra `session_id`, `seed` y `params`, de modo que el fallo sea reproducible offline sin necesidad del socket original. El cliente muestra el estado y ofrece reconectar a mano; no hay bucles de reconexión automática, porque enmascaran fallos reales.

Si el buffer de envío se satura, el servidor descarta los frames más antiguos en lugar de encolar sin límite. El hueco resultante lo detecta el cliente por `sequence_number`.

---

## 10. Estrategia de tests

### Unitarios del motor

- Gaussianas: amplitud de pico y anchura a media altura.
- Intervalos medidos sobre la señal generada frente a los especificados, dentro de tolerancia.
- Frecuencia cardíaca efectiva con margen del 1 %.
- Políticas de conducción verificadas **a nivel de eventos**: Wenckebach con su PR creciente y su latido caído en la posición correcta; BAV de 3.er grado con trenes estadísticamente independientes.
- RR irregular en fibrilación auricular, comprobado estadísticamente.
- Fibrilación ventricular dentro de su banda de frecuencia esperada.

### Golden signals

Dos niveles, eventos y muestras. Doce ritmos, diez segundos cada uno, semilla fija. Dos suites: una limpia, con el ruido a cero, y otra con niveles de ruido fijos.

Los ficheros de referencia solo se regeneran ante un cambio intencional y documentado del motor.

### Integración

WebSocket de extremo a extremo con un cliente de prueba: conectar, `start`, validar la cabecera de los frames, la monotonía de `sequence_number` y los tamaños; `update` con cambio de frecuencia observable en la señal; `stop` y verificación de la sesión persistida.

### Frontend (Vitest)

- Decodificador de frames: endianness, offsets, layout channel-major.
- Máquina de buffer: underrun, overrun, reordenación de frames y reinicio de sesión.

---

## 11. Criterios de aceptación de la fase 1

1. Los doce ritmos se generan y se ven correctamente en las doce derivaciones.
2. Trazado estable a 60 fps durante diez minutos seguidos, sin fugas de memoria ni deriva de sincronía.
3. Frecuencia cardíaca y niveles de ruido modificables en caliente, sin cortes en el trazo.
4. Sesión cerrada persistida en PostgreSQL y reproducible a partir de `seed`, `params` y `engine_version`.
5. Golden signals en verde, en ambos niveles y ambas suites.
6. **Revisión clínica de los doce trazados por un profesional antes de dar la fase por cerrada.**

El sexto criterio no es negociable. `CLAUDE.md` identifica "no validar con profesionales" como el riesgo principal del proyecto, y un simulador de ECG que no ha visto un clínico no vale para formar a nadie.

---

## 12. Stack

| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript + Vite, Canvas 2D, Zustand |
| Backend | Python + FastAPI, un único worker de uvicorn |
| Motor | Python + numpy, paquete independiente |
| Base de datos | PostgreSQL + Alembic |
| Tests | pytest (backend y motor), Vitest (frontend) |
| Infraestructura | Docker Compose |

Redis queda fuera del MVP, según lo indicado en la sección de no-objetivos.
