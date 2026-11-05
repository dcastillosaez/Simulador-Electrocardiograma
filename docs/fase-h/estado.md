# Fase H — estado de implementación

Qué está hecho, qué se comprobó ejecutándolo, qué no se puede comprobar desde
aquí y qué espera una revisión humana. La especificación es
`propagacion-electrica.md`; este fichero es su estado.

Última revisión: 5 de noviembre de 2026 · rama `claude/fase-h-propagacion-electrica`

## Resumen

| Fase | Estado | Verificado ejecutándolo | Pendiente de una persona |
|---|---|---|---|
| H1 Sistema de conducción estático | **Hecha, sin revisión anatómica** | Trayectos validados contra dos pieles en siete puntos del ciclo; regenerar da el mismo fichero; holguras fijadas en test | Revisión anatómica en vistas anterior, posterior, lateral y con corte; FPS en la máquina de referencia |
| H2 Secuencia eléctrica en el servidor | **Hecha, sin revisión clínica** | Tramos contra `measure` en todos los ritmos; Mobitz I, disociación, trozos de 100 ms, llegada antes de reproducir | Revisión clínica de `activation-timing.yaml` |
| H3 Repaso temporal | **Hecha** | Función pura del tiempo, retención acotada en ocho horas, sin mensajes al servidor ni repintado | — |
| H4 Activación del miocardio | **Hecha, sin revisión** | Mapa reproducible, ningún vértice fuera de su tramo, epicardio después del endocardio en siete puntos | Revisión del orden de activación; FPS con y sin corte en la máquina de referencia |
| H5 Patologías y pulido | **Hecha** | Tabla de ritmos contra el catálogo real; fármacos que reconstruyen la fuente; ningún `rhythm_id` en la propagación | Revisión docente de cómo se ve cada ritmo |

Lo que queda **no es programación**: son revisiones que tiene que firmar alguien
con criterio clínico y una medida de rendimiento que hay que tomar en la
máquina de referencia, con GPU.

## Tests ejecutados

Todos en local, el 5 de noviembre de 2026, sobre el último commit de la rama:

| Suite | Resultado |
|---|---|
| `packages/ecg-engine` (incluye los golden en tres niveles) | 552 pasan, 4 omitidos; **ningún golden regenerado** |
| `packages/heart-engine` | 58 pasan |
| `packages/pharmacology-engine` | 111 pasan |
| `apps/api` con `ECG_TEST_DB=postgres` (Postgres 16 local) | 315 pasan |
| `apps/api` con `ECG_TEST_DB=sqlite` | 315 pasan |
| `apps/web`: `npx tsc -b --noEmit` y `npm test` | sin errores de tipos; 692 pasan en 71 ficheros |
| `docs/fase-h/build-conduction-paths.py --check` | idéntico al fichero versionado |
| `docs/fase-h/build-activation-map.py --check` | idéntico al fichero versionado |

La CI del repositorio solo ejecuta los tests de `apps/api` y de `apps/web`; los
de `heart-engine` y `ecg-engine` se ejecutaron a mano y conviene que alguien
los incorpore a la CI.

## H1 — Sistema de conducción estático · hecha, sin revisión anatómica

- `docs/fase-h/build-conduction-paths.py` lee el `.glb` y calcula los
  trayectos: nodo sinusal en la unión anterolateral de la cava superior con la
  aurícula derecha; tres vías internodales y el haz de Bachmann como
  geodésicas dentro de la pared auricular; nodo AV donde la aurícula derecha se
  acerca más al ventrículo izquierdo junto al anillo tricuspídeo; His hasta el
  punto más próximo del hueco septal; rama izquierda hacia los dos papilares y
  el centro del tabique; rama derecha hacia el papilar anterior; Purkinje como
  árbol de caminos mínimos con semilla fija (20261105) y tope de 3000
  segmentos. Salida: `apps/web/src/ui/Cardiac3D/ConductionSystem/conduction-paths.json`.
- **Validación** (en el propio script, que no escribe si falla): contra la piel
  del órgano con miocardio, ningún punto de la superficie del tubo —anillo de
  seis puntos alrededor de la curva Catmull-Rom centrípeta que dibuja el
  cliente, 201 453 puntos— se ve desde fuera en ninguno de los siete puntos del
  ciclo, deformados con la misma cuenta que `applyExcursion`. Contra la piel
  por defecto, Purkinje queda entre 1,08 y 1,29 mm del endocardio y nunca
  dentro del molde. El haz de Bachmann, que es subepicárdico, asoma en la vista
  sin miocardio en 44 puntos del surco interauricular: se registra como medida,
  no como fallo.
- **Pivotes.** Se comprobaron como pedía la especificación y difieren: 31,7 mm
  entre los dos ventrículos. Ver «Desviaciones».
- **Holguras de unión**, medidas en la excursión máxima y fijadas en
  `conduction-system.test.ts`: nodo AV–His 2,02 mm; His–rama derecha 1,27 mm.
- Render en `apps/web/src/ui/Cardiac3D/ConductionSystem/`: tubos sobre
  `CatmullRomCurve3` fundidos en un `BufferGeometry` por cámara, con los
  atributos `aProgress` y `aStructure`. La capa se enciende con «Ver
  conducción», se aísla como un grupo más («Conducción»), respeta los planos de
  corte y cada estructura abre su ficha en el inspector. Los textos de las
  fichas son datos (`conduction-structures.ts`).
- Comprobado en Chromium sin GPU (SwiftShader): la capa se dibuja, aislada y
  sin aislar, y el clic selecciona.

**No comprobable aquí.** La caída de FPS en la máquina de referencia. En la nube
solo hay renderizado por software (SwiftShader), donde todo es CPU y las cifras
no dicen nada de una GPU: 6,2–6,6 fps con la capa apagada y 4,6–4,8 con ella
encendida; con corte coronal, 2,7–2,8 y 2,3. Hay que medir en la máquina de
referencia antes de dar el criterio del 5 % por cumplido.

**Pendiente de revisión humana.** La posición anatómica en vistas anterior,
posterior, lateral y con corte. La firma una persona con criterio clínico.

## H2 — Secuencia eléctrica en el servidor · hecha, sin revisión clínica

- `packages/heart-engine/src/heart_engine/electrical.py`
  (`derive_electrical_impulses`) y `data/activation-timing.yaml`
  (`version: 1`, `revision_clinica: pendiente`). `cardiac_events` gana el campo
  `electrical`; `stream_cardiac` publica también cuando hay electricidad sin
  contracciones.
- El origen no se deduce: `RhythmDefinition.atrial_origin` y
  `PatientSpec.atrial_origin` (sinusal o supraventricular; el editor del
  paciente lo ofrece) y `pairs_by_index` en cada política de conducción.
- **Valores del fichero de tiempos**, cada uno con referencia completa:
  - Retraso de la aurícula izquierda, 31 ms (Lemery R, et al. J Cardiovasc
    Electrophysiol. 2007;18(4):402-408, PMID 17394455).
  - Intervalo HV, 45 ms (Lee YS, Lien WP. Chest. 1975;67(6):696-701, PMID
    1126224), dentro del rango 35-55 ms de Josephson, 5.ª ed.
  - Rama izquierda–ventrículo, 25 ms (Lee y Lien, 1975).
- **Lo que no tiene fuente y se dejó fuera** (listado en el propio YAML):
  el fin de la activación de la aurícula derecha dentro de la P (se usa el
  final de la P); el reparto de la P en tercios; el reparto del LB-V entre
  ramas y Purkinje (comparten ventana); un RB-V normativo (la rama derecha usa
  la ventana de la izquierda); el retraso del disparo sinusal al inicio de la P
  (el nodo es una marca en el inicio de la P); la duración total de la
  activación ventricular (sale del QRS del motor).
- **Cómo se buscaron.** Con búsquedas web; las bases de datos y las revistas no
  eran accesibles desde la sesión, así que solo se leyeron fragmentos de
  resúmenes indexados. Ningún artículo se leyó entero. La lista de autores de
  Lemery 2007 no se comprobó (va como «et al.»).
- Criterios comprobados con tests: golden sin regenerar; tramos contra `measure`
  en los once ritmos con latidos y un QRS de 140 ms del paciente inventado que
  da 140 ms; Mobitz I con AV creciente e impulso caído `blocked` sin tramos
  ventriculares; ningún impulso cruza el nodo AV en bloqueo completo ni en TV;
  10 s de una vez y en trozos de 100 ms dan los mismos impulsos; ningún tramo
  llega después de empezar a reproducirse con el buffer en 300 ms; en pausa no
  hay electricidad nueva y un ritmo nuevo no deja impulsos del anterior.
- Comprobado en Chromium: el pulso recorre las vías en directo.

**Pendiente de revisión humana.** Los tiempos de `activation-timing.yaml`. La
especificación pide una revisión clínica real antes de cerrar H2: hay que leer
las fuentes completas y firmar los números, y entonces cambiar
`revision_clinica`.

## H3 — Repaso temporal · hecha

- `PlaybackClock` (cursor del repaso o cabeza del directo), leído por
  `HeartModel` y `ValveReadout`. `advance()` sigue siendo solo de
  `useSweepRenderer`.
- La poda es relativa a la cabeza del directo con un margen igual al papel, en
  las cuatro líneas temporales (contracciones, válvulas, electricidad y estado).
- `heart_state` lleva `t_s` y el cliente lo guarda en `HeartStateTimeline`.
- Cursor en su propia capa sobre el trazado; `findNearestRingPos` atraviesa los
  huecos sin interpolar; con zoom, la ventana sigue al cursor.
- Barra de transporte solo en congelado: reproducir, pausa, paso a límite de
  tramo, repetir fase, 0,25×–2× («Velocidad de repaso») y arrastre. Durante el
  repaso las medidas del inspector se rotulan «medidas del momento de
  congelar».
- Casos límite: el cursor se detiene en el borde; si se recrean los anillos el
  repaso termina y vuelve a la cabeza; `started` lo cierra todo.
- Tests: pose, temblor, pulso y tejido como función pura del tiempo; ocho horas
  de sesión con poda contra la cabeza retienen como mucho 20 entradas por línea
  temporal; mover el cursor no envía nada por el WebSocket, no llama a
  `advance()` ni a `SweepRebuilder.rebuild`.
- Comprobado en Chromium: congelar, retroceder por tramos y reproducir a 0,25×.

## H4 — Activación del miocardio · hecha, sin revisión

- `docs/fase-h/build-activation-map.py` calcula la activación normalizada de
  cada vértice de las dos aurículas, los dos moldes ventriculares y el
  miocardio (que reparte sus vértices entre ventrículo y aurículas por la
  cavidad más próxima). Distancia geodésica por el endocardio más el tramo
  recto a través de la pared, desde el nodo sinusal, la entrada del haz de
  Bachmann y las cuatro zonas de activación precoz de Durrer et al. (Circulation
  1970;41(6):899-912). Salida:
  `apps/web/src/ui/Cardiac3D/activation/activation-map.json`.
- Vértices del miocardio: 52 384, arista media 1,40 mm; no hizo falta
  subdividir. Los moldes ventriculares tienen aristas de 3,1-3,4 mm.
- El sombreador se inyecta en los materiales existentes, compara el tiempo con
  el atributo y no guarda estado. La recuperación tiene color propio y sin
  orden espacial. Se ve con la capa de conducción encendida.
- Comprobado con tests: ningún vértice fuera de su tramo; el mapa cuadra con el
  `.glb` versionado; los uniformes se escriben sin crear objetos y como función
  pura del tiempo. En el script, en los siete puntos del ciclo, el epicardio
  visible se activa de media después que el endocardio (0,465 frente a 0,363).
- Comprobado en Chromium: el frente recorre el miocardio desde la región apical
  hacia la base dentro del QRS y deja el tejido despolarizado hasta la T.

**Desviación anotada.** Durrer sitúa el inicio del ventrículo derecho 5-10 ms
después que el izquierdo; ese retraso no se aplica porque convertirlo en
distancia exige una velocidad de conducción sin fuente.

**No comprobable aquí.** La caída de FPS con y sin corte (ver H1).

## H5 — Patologías y pulido · hecha

- `apps/api/tests/test_electrical_rhythms.py` recorre la tabla de la
  especificación con los ritmos reales y comprueba `origin`, `outcome`, tramos y
  el modo de cada cámara. Con atropina en el bloqueo completo, adrenalina en la
  TV y adenosina en el flutter la fuente se reconstruye, y aplicada la regla del
  cliente no quedan impulsos huérfanos y la electricidad sigue llegando.
- Actividad continua (`continuous-activity.ts`): el circuito del flutter a
  `flutter_hz` y la fibrilación, función del tiempo con semilla fija.
- Un test lee los módulos de la propagación y falla si alguno nombra un ritmo o
  lee `rhythm_id`.
- Didáctica hecha: la barra del repaso marca P, PR, QRS o T y la describe;
  repetir fase; seguir una estructura con la cámara desde su ficha; la captura
  exportada lleva el instante y la fase del corazón.
- Ocho horas sin acumular: test de H3. La geometría se construye una vez.

- Comparar ritmos: el inspector dibuja el diagrama en escalera de los últimos
  cuatro segundos (aurícula, unión AV, ventrículo; el color dice el origen y un
  bloqueo se queda a mitad de la unión) y permite fijarlo para compararlo con el
  del ritmo siguiente. Sale de los tramos del servidor, sin preguntar qué ritmo
  es. Comprobado en Chromium con un Mobitz I fijado frente a un bloqueo
  completo. Es una forma de comparar elegida aquí: la especificación no decía
  cuál, y conviene que la revise quien la vaya a usar en clase.

**Pendiente de revisión humana.** Que cada ritmo se reconozca como dice la tabla,
mirándolo.

## Desviaciones de la especificación

Adaptaciones mínimas donde el código no encajaba, cada una con su porqué:

1. **Un grupo por cámara, no dos.** La especificación pedía un grupo auricular
   y uno ventricular, y comprobar antes los pivotes. Difieren: con el mismo
   factor, un único grupo ventricular se separaba 1,27 mm de uno de los dos
   moldes. Hay cuatro grupos, cada uno con el pivote de su nodo y su misma fila
   de `DEFORMATION` (por referencia).
2. **La ventana de la electricidad se adelanta 0,5 s.** Con la ventana de las
   contracciones, un impulso llegaba hasta 80 ms después de que la cabeza de
   reproducción hubiera pasado por su primer tramo. El adelanto queda dentro de
   los 0,8 s que el motor ya fija al dibujar, y un test comprueba que lo
   anunciado es lo que se dibuja. Lo que una fuente reconstruida anunció para
   después lo descarta el cliente.
3. **La clave de un impulso lleva el origen**, además del número y la época: en
   un bloqueo completo las P y el escape tienen su propia cuenta.
4. **En la FA no hay tramo AV**: no hay una onda f concreta que conduzca. En el
   flutter sí, desde la onda F que conduce.
5. **El paso a paso salta entre límites de tramo** y el His-Purkinje comprimido
   en un PR muy corto se registra en el log del motor una vez por combinación
   de plantillas, no por latido.
