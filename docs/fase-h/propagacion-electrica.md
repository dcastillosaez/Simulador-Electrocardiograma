# Fase H — Propagación eléctrica en el corazón 3D

Hoy el corazón late, pero no se ve por qué. Esta fase añade lo que falta entre
el trazado y la contracción: un impulso que nace, recorre el sistema de
conducción y activa el tejido, todo con el mismo reloj que el ECG. Quien la use
debe poder parar el trazado sobre una onda P, moverse por ella y ver qué parte
del corazón se está activando en ese instante.

Esto es una especificación: no hay nada implementado. Recoge el qué, el por qué
y el orden, con criterios que se pueden comprobar, y sale de contrastar con el
código una propuesta previa hecha sin ese acceso. Última revisión: 31 de
octubre de 2026, sobre `master`.

## Lo que ya existe y condiciona el diseño

**El reloj está resuelto.** `FrameBuffer.playbackTimeS` es la cabeza de
reproducción que comparten el trazado y el corazón, y `HeartModel` consulta con
ella las contracciones y las válvulas. La electricidad será una tercera línea
temporal colgada del mismo valor. No hay segundo reloj, ni `setInterval`, ni
`performance.now()`.

**Ya hay un pasado accesible.** El buffer de reproducción desecha lo que
reproduce, pero el trazado no: cada derivación vive en un `SweepBuffer` con
250 mm de papel, unos diez segundos a 25 mm/s, y `SampleIndexRing` sabe qué
muestra hay en cada posición. Congelar (`toggleFreeze` en `ECGWorkspace.tsx`)
llama a `runtime.pause()`, y la pausa detiene también el motor y la
farmacología. Sobre ese trazado congelado ya funcionan el zoom, el
desplazamiento y las medidas.

**Lo que se pierde son los eventos.** `HeartModel` poda las líneas temporales
con `PRUNE_MARGIN_S = 1`, así que un segundo después de pasar una contracción
ya no se puede reconstruir. `heart_state`, además, se guarda como un valor
único y no lleva tiempo.

**El motor sabe más de lo que publica.** `CardiacEvent` marca el pico de la P o
de la R, y `target_extent_s` da el inicio y el final de cada onda. Las políticas
de `ecg-engine/conduction.py` deciden qué P conduce. `BeatBasedSource.events`
aplica la política a las P de la ventana sin recortar sus QRS, de modo que la P
y el QRS que provoca llegan juntos aunque el QRS caiga después del final de la
ventana. Una P sin QRS del mismo índice en esa misma llamada es una P
bloqueada, y no hace falta mirar al futuro para saberlo.

**No todos los ritmos tienen latidos.** La fibrilación ventricular no implementa
`events`. La mecánica lo resuelve con `ContractionMode`: el evento vale para la
contracción organizada y el resto es un modo con sus parámetros en `heart_state`.

**La anatomía tiene dos límites.** No existe malla del tabique interventricular,
porque BodyParts3D no la trae (`heart-nodes.ts`), y el miocardio es una malla
sintetizada que viene apagada. Además, `applyExcursion` escala cada estructura
por separado. Lo que se coloque sobre el corazón y no siga esa deformación se
separará de la pared en cada latido.

## Decisiones

**Tres líneas temporales, un reloj.** Electricidad, contracción y válvulas son
fenómenos distintos y siguen separados. La despolarización no se funde con la
contracción: una disociación electromecánica tiene que poder existir.

**La electricidad viaja dentro de `cardiac_events`.** Las válvulas ya van en ese
mensaje, y por la misma razón: un mensaje aparte permitiría que corazón y
electricidad llegaran desparejados. `cardiac.py` compone el campo y
`heart-engine` lo calcula. No hace falta un publicador nuevo.

**El servidor manda los instantes; el cliente, el viaje.** Es la regla de las
válvulas aplicada aquí. El cliente interpola un pulso dentro de un tramo, pero
no decide cuándo empieza ni si llega.

**El repaso solo existe en congelado.** Directo y repaso no conviven. Mientras
el motor corre, el comportamiento es el de hoy. Al congelar, el servidor está
parado y nada puede divergir: no hay que alcanzar el directo, ni simular hacia
atrás, ni tocar el reloj fisiológico. Al descongelar, el buffer sigue contiguo
y se vuelve a la cabeza de reproducción. Por eso no se construye un historial
paralelo.

**El historial es lo que hay en el papel.** Diez segundos cubren una docena de
latidos a 72 lpm, y ese es el trazado que el alumno tiene delante. Las
velocidades de 0,25× a 2× mueven un cursor sobre señal ya guardada, así que el
trazado no se repinta nunca. Ampliar la ventana más allá del papel es otra
decisión y queda fuera.

**Sin geometría anatómica inventada.** El His y las ramas van en una capa
conductora propia, situada donde las superficies de los dos ventrículos se
acercan. No se añade un tabique: el proyecto ya descartó inventarlo, y la
conducción no lo necesita.

**Los tiempos son datos con fuente.** El reparto entre regiones vive en un
fichero versionado y cada valor cita de dónde sale. Claude no es fuente de
verdad clínica, y tampoco lo es esta especificación, que no fija ningún número.

## Panorama

| Fase | Objetivo en una frase | Depende de | Tamaño |
|---|---|---|---|
| H1 | El sistema de conducción se ve, late con el corazón y se puede seleccionar | — | Media |
| H2 | El impulso recorre ese sistema, calculado por el servidor | H1 | Media |
| H3 | Se puede parar, retroceder y repasar a otra velocidad | H2 | Media |
| H4 | La activación se extiende por el tejido | H2, H3 | **Grande** |
| H5 | Cada ritmo se comporta como es, y la vista enseña | H2, H4 | Media |

H3 va antes que H4 para que el mapa del tejido nazca sabiendo que su estado es
una función pura del tiempo, sin nada acumulado entre fotogramas. Hacerlo al
revés obligaría a rehacer el shader.

---

## H1 — Sistema de conducción estático

**Objetivo.** Ver el recorrido completo sobre el corazón, sin animación
eléctrica, pero latiendo con él.

### Entra

Las estructuras son el nodo sinoauricular, las vías auriculares, el nodo
auriculoventricular, el haz de His, las ramas derecha e izquierda y la red de
Purkinje. Las vías auriculares y Purkinje se declaran como esquema didáctico,
tanto en la interfaz como aquí: no reconstruyen fibras reales.

**Geometría calculada, no escrita a mano.** Igual que las valvas, un script
(`docs/fase-h/build-conduction-paths.py`) lee el GLB y genera los trayectos. El
endocardio ya existe, porque las cavidades de BodyParts3D son esa superficie, y
Purkinje se apoya en ella. La región septal se obtiene de donde las mallas de
los dos ventrículos están más próximas. La red de Purkinje se genera con
semilla fija y un tope de segmentos, de modo que el resultado es reproducible y
se puede versionar.

**Deformación.** Es lo primero que hay que resolver. Se crean dos grupos,
auricular y ventricular, que reciben la escala de `applyExcursion` por la misma
tabla `DEFORMATION`, añadiendo sus filas. Los dos ventrículos comparten factores
en esa tabla, de modo que toda la conducción ventricular cabe en un grupo.
Antes hay que comprobar los pivotes de cada nodo: si difieren, el mismo factor
no produce el mismo desplazamiento. La unión queda en el nodo AV, que es el
tramo donde más se nota la separación entre ambos grupos.

**Render.** Módulo `apps/web/src/ui/Cardiac3D/ConductionSystem/`, con tubos sobre
`CatmullRomCurve3` fusionados en un `BufferGeometry` por grupo y un atributo con
la posición a lo largo del trayecto, que H2 usará para mover el pulso. La
visibilidad reutiliza lo que `HeartModel` ya hace con `isolated`, `hidden` y la
opacidad, y debe respetar los planos de corte.

**Selección.** Cada estructura se puede seleccionar y muestra una ficha. Los
textos clínicos van en datos, no en componentes. El panel entra en el inspector
y obedece la regla de esa columna: pide su alto natural y el escenario mantiene
su suelo de 220 px.

### No entra

Animación eléctrica, mapas sobre el tejido o cambios en el GLB anatómico.

### Criterios de aceptación

- Validación contra las dos pieles y en siete puntos del ciclo, con la misma
  cuenta que hace la GPU: ningún trayecto sale del órgano con miocardio, y
  Purkinje queda a una distancia acotada del endocardio.
- La holgura en la unión del nodo AV se mide en la excursión máxima y queda
  fijada en un test.
- La posición anatómica se comprueba en vistas anterior, posterior y lateral y
  con corte. La revisión la firma una persona con criterio clínico, no un test.
- Regenerar los trayectos con la misma semilla da exactamente los mismos datos.
- Activar la capa no reduce más de un 5 % los fotogramas por segundo medidos
  frente a la capa apagada en la máquina de referencia.

---

## H2 — Secuencia eléctrica en el servidor

**Objetivo.** Al iniciar un ritmo sinusal, el impulso sale del nodo SA y llega a
Purkinje en el instante que dice el trazado.

### Contrato

Se fija antes de escribir código, porque motor, API y cliente deben compartir
las mismas referencias temporales. `cardiac_events` gana un campo:

```json
{
  "electrical": [
    {
      "impulse": 14,
      "origin": "sinus",
      "outcome": "conducted",
      "segments": [
        { "structure": "sa_node", "t_start_s": 0.0, "t_end_s": 0.0 },
        { "structure": "right_atrium", "t_start_s": 0.0, "t_end_s": 0.0 }
      ]
    }
  ]
}
```

Los ceros están ahí a propósito: el ejemplo enseña la forma, no los valores. Las
decisiones que contiene son estas.

La identidad de un impulso es la pareja `impulse` y `source_started_s`, la misma
época que ya usan contracciones y válvulas, porque una fuente reconstruida
vuelve a contar desde cero. Los tiempos son de simulación, redondeados a
milisegundos como el resto del mensaje, y un impulso lleva todos sus tramos, sin
referencias a eventos que el cliente tenga que resolver. Por eso se reconstruye
solo desde el historial.

`outcome` admite únicamente `conducted` y `blocked`. No existe «retrasado»: el
retraso es la duración del tramo AV, y un tercer estado sería una excepción
visual disfrazada de dato. En un bloqueo de primer grado el nodo AV dura más, y
nada más cambia. En Mobitz I crece latido a latido y el impulso bloqueado no
tiene tramos más allá del nodo AV.

`origin` dice dónde nace el impulso: `sinus`, `supraventricular` o `ventricular`.
El último no tiene P asociada ni pasa por el His. Esto no se deduce de los
eventos: en un bloqueo completo y en la taquicardia ventricular los QRS vienen
del tren de escape, con su propia numeración, y emparejar por índice inventaría
conducción donde no la hay. `is_dissociated` ya distingue ese caso. La diferencia
entre una aurícula sinusal y una supraventricular se declara en el catálogo,
junto a `mechanical_profile`, y en `PatientSpec`. Si algún día existe un escape
de la unión, ese origen se añade aquí.

La actividad continua no va en este campo. Las aurículas en flutter o
fibrilación y los ventrículos en fibrilación se describen con lo que ya publica
`heart_state`: el modo y `flutter_hz`.

### Tiempos

`heart-engine` gana `electrical.py`, con `derive_electrical_impulses`, que recibe
los eventos, el perfil y el fichero de tiempos, igual que
`derive_mechanical_events`. Las ventanas salen de `target_extent_s`, no de
constantes:

| Tramo | Se ancla en | Regla |
|---|---|---|
| Nodo SA | Inicio de la P | Marca breve: su disparo no se ve en superficie, y adelantarlo sería inventar un desfase |
| Aurículas | Extensión de la P | Derecha antes que izquierda, con reparto tomado del fichero |
| Nodo AV | Final de la P hasta el inicio del His | Absorbe el resto del PR: de aquí sale el bloqueo de primer grado sin caso especial |
| His, ramas, Purkinje | Terminan en el inicio del QRS | Duración tomada del fichero, con fuente citada |
| Miocardio ventricular | Extensión del QRS | Un QRS de 140 ms produce una activación de 140 ms |
| Recuperación ventricular | Extensión de la T | Marcada aparte; no es la misma onda en sentido contrario |

El QRS y el PR acotan cada tramo, pero no dicen cómo se reparte el tiempo dentro
de él. Ese reparto es lo que aporta el fichero
`packages/heart-engine/src/heart_engine/data/activation-timing.yaml`, con
`version` y referencia por valor. Si en un PR muy corto la duración fija del
tramo His-Purkinje no cabe, se comprime y el motor lo registra: nunca se
adelanta el inicio del nodo AV sobre el final de la P sin que quede constancia.

### Entra

- `cardiac.py` compone el campo. `stream_cardiac` publica hoy solo si hay
  contracciones (`events["events"]`), y esa condición debe ampliarse: una
  aurícula en flutter genera electricidad sin contracciones que publicar.
- `apps/web/src/cardiac/electrical-timeline.ts`, con el patrón de
  `CardiacTimeline`: `push(items, epoch)`, `prune`, `clear` y una consulta por
  tiempo que escribe en una estructura reservada, sin crear objetos en el
  camino caliente.
- `useCardiacTimeline` lo alimenta y lo limpia en `started`. Con `?? []`, las
  sesiones guardadas sin este campo se reproducen sin electricidad.
- El uniforme de progreso del pulso avanza sin React, como hoy las excursiones.

### No entra

Mapas sobre el tejido, controles de repaso o el aspecto de los ritmos no
sinusales. El contrato sí los contempla desde el principio.

### Criterios de aceptación

- `ecg-engine` no cambia su señal: los golden pasan sin regenerarse.
- Para cada ritmo con latidos, los tramos caen dentro de las ondas medidas por
  `measure`, con tolerancia fijada en el test. Vale también para `custom_patient`:
  pedir un QRS de 140 ms da un tramo ventricular de 140 ms.
- En Mobitz I, el tramo AV crece dentro del ciclo y el impulso caído es
  `blocked`, sin tramos ventriculares.
- En bloqueo completo y taquicardia ventricular, ningún impulso cruza el nodo AV.
- Generar 10 s de una vez y en trozos de 100 ms da los mismos impulsos.
- Ningún tramo llega al cliente después de empezar a reproducirse, con el buffer
  en `minS`.
- En pausa no avanza nada; al cambiar de ritmo no queda ningún impulso anterior.

---

## H3 — Repaso temporal

**Objetivo.** Con el trazado congelado, moverse por los últimos diez segundos y
ver el corazón en cada instante.

### Entra

**Una cabeza de reproducción con dos fuentes.** Un `PlaybackClock` devuelve
`reviewTimeS` si hay repaso y `buffer.playbackTimeS` si no. `HeartModel` y
`ValveReadout` leen de él. Nada más cambia de sitio: `advance()` sigue siendo
cosa exclusiva de `useSweepRenderer`.

**Retención.** La poda deja de ser relativa al tiempo consultado, que ahora puede
ir hacia atrás, y pasa a serlo a la cabeza del directo, con un margen igual a lo
que abarca el anillo. Eso alcanza a las tres líneas temporales. Sin poda
suficiente el coste vuelve al problema que motivó `prune`, así que la cantidad de
eventos retenidos queda acotada por un test.

**`heart_state` con tiempo.** El mensaje gana `t_s` y el cliente guarda sus
cambios como tramos constantes. Si el ritmo cambió hace seis segundos, al volver
atrás el corazón debe recuperar el modo de entonces.

**Cursor sobre el trazado.** Una línea en la capa de overlay, distinta del cursor
de medida, que no se toca. La posición sale de tiempo a muestra, de muestra a
`SampleIndexRing` y de ahí a `ringPosToPx`. `findRingPos` busca coincidencia
exacta y falla en un hueco, de modo que hace falta una variante que devuelva la
muestra más próxima. Si el cursor sale de la ventana con zoom, la ventana lo
sigue.

**Transporte.** Una barra con reproducir, pausa, paso adelante y atrás, repetir
fase y velocidades de 0,25×, 0,5×, 1× y 2×. El paso salta al siguiente límite de
tramo eléctrico. Solo aparece en congelado, y se llama velocidad de repaso para
que nadie la confunda con la velocidad de papel. El arrastre va en la barra y no
sobre el trazado, donde clic y arrastre ya son de la herramienta de medida.

### Casos límite

Al llegar al borde del historial, el cursor se detiene sin dar la vuelta. Un
evento a medias en ese borde se pinta con su estado en ese instante. Si un cambio
de layout o de ancho recrea los anillos, cosa que hoy los vacía, el repaso termina
y se vuelve a la cabeza. Si llega `started`, se limpia todo. Una discontinuidad
por pérdida de frames se atraviesa sin interpolar la señal.

### No entra

Velocidad en directo, ralentizar el motor o historial más largo que el papel.
Las medidas numéricas del panel siguen siendo las del momento de congelar, igual
que hoy: durante el repaso se rotula así para que nadie las atribuya al instante
del cursor.

### Criterios de aceptación

- La pose del corazón y el estado eléctrico son función pura del tiempo: el mismo
  instante da el mismo resultado llegando desde delante, desde detrás o a
  cualquier velocidad. Vale también para el temblor de las cámaras.
- En repaso, el trazado no se repinta y ningún `SweepRebuilder` corre en el bucle
  de dibujo.
- La velocidad no altera las relaciones temporales de la secuencia.
- Al descongelar, el trazado continúa sin hueco artificial.
- El servidor no recibe ningún mensaje por mover el cursor.

---

## H4 — Activación del miocardio

**Objetivo.** Ver cómo la activación alcanza el tejido, no solo las fibras.

### Entra

Primero regiones, después continuo. Cada vértice recibe un atributo con su
activación normalizada de 0 a 1 dentro del tramo correspondiente, calculada en un
script a partir de distancias sobre la superficie, porque una distancia recta
atravesaría paredes. Al ser normalizado, el mismo mapa sirve para cualquier
duración de QRS que mande el servidor. El shader compara el tiempo con ese
atributo y no guarda estado.

El shader se inyecta en los materiales existentes para respetar los cortes y el
aspecto de `heart-appearance.ts`. Antes hay que comprobar si la malla `Myocardium`
tiene vértices suficientes. Si no los tiene, se subdivide al generarla, pero esa
geometría se decide con la medida delante.

La recuperación usa un color propio y sigue siendo otra cosa: en esta fase se
muestra sobre el tejido durante la T sin afirmar un orden espacial. Dar ese orden
exige una fuente y queda para después.

### No entra

Electrofisiología numérica o mapas distintos por trastorno de conducción.

### Criterios de aceptación

- Se valida contra las dos pieles y en siete puntos del recorrido.
- Ningún vértice se activa fuera de su tramo.
- Ninguna geometría ni material se crea durante la reproducción.
- La caída de fotogramas se mide como en H1, y con el corte activado.

---

## H5 — Patologías y pulido

**Objetivo.** Que cada ritmo se reconozca por cómo viaja su impulso, y que la
vista explique lo que enseña.

| Ritmo | Qué debe verse |
|---|---|
| `sinus_normal`, `sinus_tachycardia`, `sinus_bradycardia`, `stemi_inferior` | Secuencia completa, con la separación que marque el ritmo |
| `svt` | No enciende el nodo SA: su origen es supraventricular |
| `av_block_first` | Nodo AV prolongado; todo conduce |
| `av_block_second_mobitz_i` | Retraso creciente y un impulso que se detiene en el nodo AV |
| `av_block_third` | Aurículas y escape con secuencias independientes |
| `atrial_flutter` | Circuito auricular continuo a `flutter_hz`; impulsos ventriculares según el bloqueo |
| `atrial_fibrillation` | Aurícula sin secuencia; solo impulsos ventriculares irregulares |
| `ventricular_tachycardia` | Activación desde foco ventricular; aurícula disociada |
| `ventricular_fibrillation` | Activación caótica, sin impulso ordenado |
| `custom_patient` | Lo que digan sus intervalos y su origen |

Todo esto sale de `origin`, `outcome` y el modo de cada cámara. Si un ritmo exige
una condición por su nombre en un componente, el contrato ha fallado, igual que
una molécula que obligue a tocar código fuera de su YAML. La actividad caótica se
genera como función del tiempo con semilla fija, para que el repaso la reproduzca
exactamente.

La parte didáctica incluye fichas por fase con P, PR, QRS y T, seguir una
estructura con la cámara, repetir fase, comparar ritmos y exportar la captura con
su fase eléctrica. Todo ello parte de lo que ya hay: `useExport`, `HeartCamera`
y el inspector.

### Criterios de aceptación

- Un test recorre la tabla con ritmos reales del catálogo y comprueba `origin`,
  `outcome` y los tramos presentes.
- Ningún componente visual importa ni compara un `rhythm_id` para decidir cómo se
  propaga el impulso.
- Una sesión de ocho horas no acumula impulsos ni geometría.
- Un fármaco que reconstruye la fuente no deja impulsos huérfanos ni congela la
  vista. Vale para los mandos de `RHYTHM_DRIVES`.

---

## Fuera de esta fase

La velocidad en directo, ampliar el historial más allá del papel, la repolarización
con orden espacial, los trastornos de rama y los trayectos accesorios. Los dos
últimos tienen hueco en el contrato: añadirlos debería ser una política y datos
nuevos.

## Riesgos

El mayor es la colocación de la conducción sobre un modelo que no se hizo para
ella. Las válvulas fallaron dos veces por validar poco, y la regla de las dos
pieles existe por eso.

El segundo es de honestidad docente. Una animación convincente parece más exacta
de lo que es: las vías auriculares, Purkinje y el reparto temporal son esquemas.
La interfaz debe decirlo, y los valores temporales necesitan una revisión clínica
real antes de cerrar H2. El simulador sigue siendo una herramienta formativa.
