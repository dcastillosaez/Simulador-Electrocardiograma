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

**La pose cerrada es la de la fuente, sin tocar.** Lo único sintetizado es la
pose abierta. Se calcula girando cada valva sobre el anillo de su válvula, y el
anillo no se elige a ojo: es la superficie donde se tocan el molde de la cámara
de aguas arriba y el de aguas abajo. Un molde de sangre auricular termina donde
empieza el ventricular, y esa frontera *es* el plano fibroso al que se insertan
los velos. Sale con una desviación del plano de un milímetro sobre radios de 8 a
17 mm, que es lo que uno esperaría de un anillo de verdad; el script valida que
los cuatro radios caigan en su rango anatómico y no escribe nada si alguno se
sale.

En las auriculoventriculares el giro **no es rígido**. La malla de una valva
mitral o tricúspide de BodyParts3D no es solo el velo: lleva pegada la cuerda
tendinosa hasta el músculo papilar, cuarenta y tantos milímetros más abajo.
Girarlo todo en bloque saca la punta fuera del ventrículo —se comprobó, y se
sale por bastante—, así que el giro va a plena amplitud hasta el borde libre del
velo y se apaga suavemente hasta anularse en el papilar. El papilar no se mueve,
y esa es exactamente la razón de que la cuerda tendinosa exista. Las sigmoideas
son compactas y giran rígidas.

Las dos poses viajan en el `.glb` como *morph target* de glTF. El cliente anima
una válvula escribiendo un número entre 0 y 1 en `morphTargetInfluences[0]` y la
interpolación la hace la GPU: ni un vértice tocado por fotograma ni un material
duplicado. Van también las normales, y no como lujo: sin ellas la valva se
movería con la iluminación de la pose cerrada y una membrana que gira sesenta
grados con la luz pegada al sitio de donde salió se ve plana justo cuando más se
mira.

## Lo que el script comprueba antes de escribir

- Que la calibración reproduce la cava superior con un residuo por debajo de
  1e-6. Es lo que garantiza que las válvulas nuevas caigan **exactamente**
  encima del modelo que ya existe y no medio milímetro más allá.
- Que las nueve estructuras anatómicas salen igual que estaban, quitando las
  valvas.
- Que el radio de cada anillo cae en su rango anatómico.
- Que ninguna valva abierta asoma más de 4 mm por fuera de la envolvente
  convexa del corazón. Es el fallo que un ángulo demasiado generoso produce y
  el que una proyección de puntos disimula.
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
fantasma. Es la vista en la que se ve el movimiento entero: los velos
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
uv run --with trimesh --with numpy --with scipy --with networkx \
    python docs/fase-d/add-heart-valves.py
```

Parte del `heart.glb` que ya existe —del que conserva el miocardio sintetizado,
que no sale de BodyParts3D— y rehace todo lo demás desde la fuente. Se puede
volver a ejecutar sobre su propia salida. Con `--validate-only` no escribe nada
y con `--preview <png>` deja tres proyecciones de las once valvas cerradas y
abiertas sobre los moldes de las cámaras, que es lo que caza un giro hacia el
lado que no es.
