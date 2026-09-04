# Las cuatro válvulas

Las válvulas del modelo se abren y se cierran con el mismo reloj que dibuja el
trazado. No es una animación en bucle sincronizada a ojo: los instantes salen
del motor, viajan por el mismo mensaje que las contracciones y se consultan con
el mismo `playbackTimeS` que mueve las cámaras. En pausa se quedan quietas donde
estaban; al saltar la reproducción saltan con ella.

## Lo que pasa en un latido

El servidor manda cuatro instantes por cada sístole ventricular
(`packages/heart-engine/src/heart_engine/valves.py`):

| Instante | Qué ocurre | De dónde sale |
|---|---|---|
| `t_close_av` | Se cierran la mitral y la tricúspide. Primer ruido cardíaco. | Inicio de la contracción ventricular, que a su vez arranca con el QRS. |
| `t_open_semilunar` | Se abren la aórtica y la pulmonar. Empieza la eyección. | 50 ms después, la contracción isovolumétrica. |
| `t_close_semilunar` | Se cierran las dos sigmoideas. Segundo ruido, fin de la sístole. | Final de la contracción ventricular. |
| `t_open_av` | Se abren la mitral y la tricúspide. Empieza el llenado. | 70 ms después, la relajación isovolumétrica. |

Son cuatro y no dos por un motivo que se ve en la escena: **hay dos intervalos
cortos con las cuatro válvulas cerradas**. Entre el primero y el segundo el
ventrículo se contrae sin expulsar una gota; entre el tercero y el cuarto se
relaja sin llenarse. Una animación que alternara dos estados —auriculoventriculares
abiertas o sigmoideas abiertas— se saltaría las dos fases isovolumétricas, que
son justamente la parte del ciclo que cuesta explicar en una pizarra.

Las aurículas no aparecen en la tabla. La sístole auricular ocurre con las
auriculoventriculares ya abiertas: remata el llenado, no lo inicia. Una
fibrilación auricular no mueve una sola de estas cuatro cifras, y hay un test
que lo comprueba.

Cuando el ventrículo no se contrae de forma organizada —una fibrilación
ventricular— no hay ciclo: `derive_valve_events` devuelve una lista vacía y el
cliente deja las válvulas donde las deja la presión cuando nada las mueve, que
es con las auriculoventriculares abiertas y las sigmoideas cerradas. No es un
caso especial en el cliente; es lo que sale de no tener eventos.

Los 50 y los 70 milisegundos viven en `MechanicalProfile`, junto al resto del
perfil mecánico del ritmo, y no en el cliente 3D: son fisiología, del mismo
material que `pr_is_measurable`, y el día que un fármaco alargue la contracción
isovolumétrica se cambian ahí. Lo que sí es del cliente es **cómo** transcurre
el movimiento entre esos instantes: un coseno alzado de 30 ms
(`apps/web/src/cardiac/valve-curve.ts`), que es el mismo reparto de
responsabilidades que ya tenían las contracciones.

## De dónde sale la geometría

BodyParts3D trae las once valvas como conceptos propios:

| Válvula | Valvas | Elementos |
|---|---|---|
| Tricúspide | anterior, posterior, septal | FJ2421, FJ2433, FJ2436 |
| Mitral | anterior, posterior | FJ2420, FJ2432 |
| Aórtica | izquierda, derecha, anterior | FJ2426, FJ2431, FJ2435 |
| Pulmonar | izquierda, posterior, derecha | FJ2417, FJ2427, FJ2434 |

Estaban ya en el modelo, pero fundidas dentro del ventrículo de su lado: una
válvula auriculoventricular separa dos cámaras y BodyParts3D la lista en las
dos, así que `build-heart-model.py` la asigna al ventrículo para que la misma
geometría no acabe duplicada en dos nodos que se animan por separado. Para
animarlas hace falta lo contrario, y de eso se encarga
`docs/fase-d/add-heart-valves.py`: las saca a once nodos propios y rehace los
dos ventrículos sin ellas.

**Las dos poses son sintetizadas, y ninguna es la de la fuente.** BodyParts3D
modela los velos en una posición neutra que no es ninguna de las dos del ciclo:
entreabierta. Tratarla como la pose cerrada —que es lo que se hacía— dejaba
pasar el 22% del orificio mitral con la válvula supuestamente cerrada, y por ahí
se veía a través. Así que se gira en los dos sentidos: hacia dentro hasta que
sella, hacia fuera hasta donde se pueda abrir sin asomar.

El anillo sobre el que se gira no se elige a ojo: es la superficie donde se
tocan el molde de la cámara de aguas arriba y el de aguas abajo. Un molde de
sangre auricular termina donde empieza el ventricular, y esa frontera *es* el
plano fibroso al que se insertan los velos. Sale con una desviación del plano de
un milímetro sobre radios de 8 a 17 mm, que es lo que uno esperaría de un anillo
de verdad; el script valida que los cuatro radios caigan en su rango anatómico y
no escribe nada si alguno se sale.

### Una valva está sujeta por la base, y ahí no gira

Es la corrección de fondo, y de ella salen las demás. El giro **nunca** es
rígido: cada vértice lleva su propio peso, de cero en el anclaje a uno en el
borde libre. Girar la valva entera en bloque despega la inserción de la pared y
la mete a través de ella, y el resultado se ve desde fuera del corazón — que es
justo lo que no puede pasar.

Dónde está el anclaje depende del tipo:

- En las **auriculoventriculares** es el anillo. El peso sube de 0 a 1 en los
  cuatro primeros milímetros, se mantiene por el cuerpo del velo y baja otra vez
  a 0 en el músculo papilar. Hacía falta ya por el otro extremo: la malla de una
  valva mitral o tricúspide no es solo el velo, lleva pegada la cuerda tendinosa
  cuarenta y tantos milímetros más abajo, y arrastrarla entera saca la punta
  fuera del ventrículo. El papilar no se mueve, y esa es exactamente la razón de
  que la cuerda tendinosa exista.
- En las **sigmoideas** el anclaje no es un plano sino la línea en U con la que
  la valva se inserta en la pared del vaso, así que el peso no se mide en
  profundidad sino en distancia a esa pared: cero sobre ella, uno en el borde
  libre. Con esto, una sigmoidea al abrirse se pliega **contra** la pared en vez
  de atravesarla. Antes giraban rígidas, y la pulmonar izquierda asomaba 3,8 mm
  por fuera del tronco: desde fuera se le veía la válvula al corazón en un 37% de
  su superficie.

### Los ángulos no se escriben, se buscan

Los dos ángulos de cada válvula son el resultado de una búsqueda contra dos
propiedades que sí se pueden comprobar, y no un número elegido a ojo:

| Válvula | Cierre | Apertura | Fuga cerrada | Orificio libre abierta |
|---|---|---|---|---|
| Tricúspide | 58° | 36,9° | 21% → 2,1% | 29% |
| Mitral | 61° | 43,6° | 22% → 2,6% | 29% |
| Aórtica | 4° | 58,1° | 2,7% → 1,0% | 65% |
| Pulmonar | 4° | 50,0° | 0,7% → 0,0% | 33% |

La apertura baja desde su tope en escalones hasta el primer ángulo con el que
ninguna valva se ve desde fuera, y de ese ángulo se usa el 90%: la prueba de
visibilidad es binaria —o escapa un rayo o no— y el margen tiene que salir del
ángulo, no de ella. El cierre sube hasta que el orificio deja de dejar pasar, y
luego cuatro grados más, porque coaptar es solaparse y un cierre al límite se
abre con cualquier redondeo.

Las dos sigmoideas se cierran solo cuatro grados porque en la fuente ya coaptan:
lo suyo era la apertura. Las dos auriculoventriculares necesitan sesenta, que es
lo que separa la posición neutra de la malla de una válvula de verdad cerrada.

### Tres poses en el `.glb`, no dos

La cerrada es la base y viajan dos *morph targets*: la abierta y una **comba**.
La comba no es un adorno. La GPU interpola en línea recta entre las poses que se
le den, y una valva mitral recorre unos cien grados entre cerrada y abierta: la
cuerda de un arco de cien grados se mete un 38% por dentro, así que a media
apertura el velo se acortaba esa barbaridad y se veía encogerse y volver a
crecer en cada latido. El segundo objetivo devuelve la trayectoria al arco.

El cliente sigue animándolas con un solo número —la apertura—, que reparte en
los dos pesos: `a` en el recorrido y `4a(1−a)` en la comba, que vale cero justo
en los dos extremos, donde las poses son exactas. Ni un vértice tocado por
fotograma ni un material duplicado.

Van también las normales de cada pose, y no como lujo: sin ellas la valva se
movería con la iluminación de la pose cerrada, y una membrana que gira sesenta
grados con la luz pegada al sitio de donde salió se ve plana justo cuando más se
mira.

## Lo que el script comprueba antes de escribir

- Que la calibración reproduce la cava superior con un residuo por debajo de
  1e-6. Es lo que garantiza que las válvulas nuevas caigan **exactamente**
  encima del modelo que ya existe y no medio milímetro más allá.
- Que las nueve estructuras anatómicas salen igual que estaban, quitando las
  valvas.
- Que el radio de cada anillo cae en su rango anatómico.
- **Que ninguna valva se ve desde fuera del corazón, ni cerrada ni abierta.**
  Desde cada vértice salen rayos en cuarenta y dos direcciones contra el
  miocardio, los vasos y las aurículas; si alguno escapa, ese punto se ve. Es la
  pregunta que hace quien mira la escena, no una aproximación suya.

  Antes se medía contra la envolvente convexa de las diez estructuras con cuatro
  milímetros de tolerancia, y por eso pasó una sigmoidea pulmonar que asomaba de
  verdad: estaba por fuera del tronco pero por dentro del casco, que no entra en
  los entrantes del órgano. La envolvente no era una prueba estricta con margen,
  era una prueba distinta.
- **Que la válvula cerrada no deja pasar.** Rayos a lo largo del eje del flujo
  por el 70% interior del disco del anillo. El 30% de fuera no es orificio: es la
  inserción misma y, en las sigmoideas, los senos de Valsalva, que quedan detrás
  de la valva — un rayo que pasa por ahí la roza, no la atraviesa. Se admite
  hasta un 3% por una razón del dato y no de la anatomía: las cuerdas tendinosas
  son un encaje de tiras y entre tira y tira pasan rayos que en un corazón de
  verdad no pasan por ninguna parte.
- Que el `.glb` escrito expone los 21 nombres de nodo, que las once valvas
  llevan su pose abierta con posición y normal, y que **todas** las mallas
  llevan normales. Esto último pasó: trimesh solo escribe el atributo `NORMAL`
  de las mallas que ya lo traen calculado, y sin él el corazón entero se ve
  negro en la escena. No se nota en ninguna validación geométrica.

## Cómo se mira

En el corazón entero y opaco las válvulas no se ven: están dentro de las
cavidades. Hay dos formas de verlas y las dos importan.

El **panel de estado**, arriba a la izquierda de la escena, dice la fase del
ciclo y si cada válvula está abierta o cerrada, con una barra que es la misma
apertura que mueve la valva en el modelo. Se lee a la vez que el trazado, sin
tocar ningún mando: es lo que permite comprobar que la mitral se cierra con el
QRS.

El botón **Válvulas** las aísla, lo que deja el resto del corazón como
fantasma. Es la única forma de verlas: con el corazón opaco no asoma ni un
vértice de ninguna de las once, en ninguna de las dos poses, y eso está
comprobado en el script que escribe el modelo. Es la vista en la que se ve el movimiento entero: los velos
separándose, la cuerda tendinosa abriéndose en abanico, las sigmoideas
plegándose contra la pared del vaso. También se ven bajando el mando de
opacidad, con las cámaras translúcidas alrededor.

Las válvulas no participan en las tapas del corte anatómico, aunque sí se
recortan con sus planos. Una valva es una membrana abierta de medio milímetro:
la técnica de stencil que produce las secciones macizas cuenta caras traseras
menos delanteras y da por supuesto un sólido cerrado, así que meterlas ahí
costaría veintidós pasadas de stencil para producir artefactos.

## Reconstruir el modelo

```bash
uv run --with trimesh --with numpy --with scipy --with networkx --with embreex \
    python docs/fase-d/add-heart-valves.py
```

`embreex` no es opcional: las dos comprobaciones que deciden los ángulos —que la
valva no se vea y que cerrada no deje pasar— son trazado de rayos. Sirve también
`rtree`, que es lo que usa el motor en Python puro de trimesh, pero tarda horas
donde embree tarda segundos. Sin ninguno de los dos el script para al principio y
lo dice.

Parte del `heart.glb` que ya existe —del que conserva el miocardio sintetizado,
que no sale de BodyParts3D— y rehace todo lo demás desde la fuente. Se puede
volver a ejecutar sobre su propia salida. Con `--validate-only` no escribe nada
y con `--preview <png>` deja tres proyecciones de las once valvas cerradas y
abiertas sobre los moldes de las cámaras, que es lo que caza un giro hacia el
lado que no es.
