# De dónde sale `heart.glb`

El modelo anatómico de la fase D no es un binario que alguien exportó una vez
desde Blender y nadie sabe reproducir. Se construye con
`build-heart-model.py`, que descarga la fuente original, selecciona las
estructuras, las valida y escribe el `.glb`. Este documento explica las
decisiones que el script toma, que son las que no se leen en el código.

```bash
uv run --with trimesh --with numpy python docs/fase-d/build-heart-model.py
```

Añade `--validate-only` para comprobar sin escribir, y `--preview vistas.png`
para sacar tres proyecciones ortográficas.

## La fuente

**BodyParts3D**, del Database Center for Life Science. Ver `attribution.md`
para la licencia, que es CC BY-SA y tiene consecuencias.

Se eligió frente a Z-Anatomy —la otra candidata, derivada de esta misma— por
cómo viene empaquetada. Z-Anatomy es un `.blend` del cuerpo entero: obliga a
abrir Blender, aislar estructuras de una escena enorme y renombrarlas a mano,
y el resultado es un artefacto que solo puede reproducir quien repita esos
clics. BodyParts3D publica una malla por elemento anatómico con su
identificador FMA, y eso se puede montar con un script.

Los 136 MB del archivo no entran en el repositorio. Se descargan a una caché
fuera del árbol de fuentes y se descartan; lo único versionado son los 2,1 MB
del `.glb` y este procedimiento.

**El espejo de BodyParts3D en GitHub no sirve.** Es un subconjunto de 934 de
las 1.524 estructuras y le faltan las cuatro cavidades: lo que trae del
corazón es `FMA7274`, "wall of heart", una sola malla fusionada. Hay que ir al
archivo oficial del NBDC.

## Las nueve estructuras

| Nodo del contrato | Conceptos FMA | Jerarquía |
|---|---|---|
| `LeftVentricle` | FMA7101 | part-of |
| `RightVentricle` | FMA7098 | part-of |
| `LeftAtrium` | FMA7097 | part-of |
| `RightAtrium` | FMA7096 | part-of |
| `Aorta` | FMA3736 + FMA3768 | part-of |
| `PulmonaryArtery` | FMA8612 + FMA50872 + FMA50873, menos FMA67994 y FMA67995 | part-of |
| `PulmonaryVeins` | FMA49914 + FMA49911 + FMA49916 + FMA49913, menos FMA68002-68005 | part-of |
| `SuperiorVenaCava` | FMA4720 | part-of |
| `InferiorVenaCava` | FMA10951 | part-of |

BodyParts3D tiene dos jerarquías, IS-A y PART-OF, sobre las mismas mallas de
elemento: solo cambia de qué concepto cuelgan. Las cavidades viven en la de
PART-OF, porque "la aurícula izquierda es parte del corazón" es una relación
de composición y no de tipo.

## El tabique interventricular no está

El brief de la fase D pedía diez estructuras. `Septum` no está aquí, y no por
descuido: **BodyParts3D no tiene malla del tabique interventricular**. Se
comprobó FMA7133 en las dos jerarquías, y también sus vecinos FMA7134 (parte
muscular) y FMA7132: cero elementos en todos. De los 83 elementos que
componen el corazón, 22 son las cavidades y los 61 restantes son vasos
coronarios.

Se decidió quitarlo del contrato en vez de sintetizarlo. Una superficie
derivada de dónde se aproximan los moldes del ventrículo izquierdo y el
derecho quedaría en el sitio aproximadamente correcto, pero sería geometría
inventada presentada como anatomía en una herramienta docente. No se pierde
nada en esta entrega —el tabique no se ve desde fuera en un modelo sólido—.
Donde hará falta es en el corte anatómico de la Entrega 3, y ese día habrá
que traerlo de otra fuente y comprobar que alinea.

`HEART_NODE_NAMES` tiene por tanto nueve nombres, no diez.

## Tres decisiones que el script toma por ti

**Las valvas van al ventrículo.** Las mallas de la válvula mitral y la
tricúspide aparecen listadas a la vez en la aurícula y en el ventrículo de su
lado. No es un defecto de los datos: una válvula auriculoventricular separa
las dos cámaras, así que pertenece a ambas. Pero si se dejara en las dos, la
misma geometría acabaría en dos nodos que se animan por separado y se vería el
solape. Se asignan al ventrículo, porque el plano valvular desciende con la
sístole ventricular, que es el movimiento dominante.

> Esta decisión la reemplaza después `add-heart-valves.py`, que saca las once
> valvas de los dos ventrículos a nodos propios para poder abrirlas y cerrarlas
> con el ciclo cardíaco. El modelo que hay en el repositorio lleva ya ese paso
> dado: son 21 nodos, no diez. Ver `valvulas.md`. Lo de arriba sigue describiendo
> lo que hace *este* script, que es de donde parte el otro.

**Los vasos se recortan.** Los conceptos de BodyParts3D son anatómicos, no
escenográficos: "aorta" incluye la descendente hasta el abdomen, y "arteria
pulmonar" son 99 elementos que llegan al último subsegmento de ambos
pulmones. Dejarlos enteros da un corazón perdido en una maraña. Se acotan por
ontología donde la ontología ya distingue lo que interesa —extrapulmonar
frente a intrapulmonar, aorta ascendente y cayado frente a aorta entera— y,
como red de seguridad, con un recorte espacial a la caja de las cavidades más
60 mm, que es lo que descarta la porción abdominal de la cava inferior. El
recorte es por elemento entero: ninguna malla queda cortada ni con agujeros.

**Cada nodo se centra en su propio centro geométrico.** Es lo que hace que
escalar una cavidad la contraiga hacia dentro en vez de arrastrarla hacia el
origen de la escena. La malla se recentra y el desplazamiento se recupera en
la transformación del nodo, así que la posición en el mundo no cambia. Sin
esto el animador de la Task 9 produciría un corazón que se desmonta.

Además, el conjunto se normaliza a altura 1 y se centra en el origen: la
escena de Three.js encuadra sin números mágicos y el animador, que trabaja con
factores relativos, no depende de que la fuente venga en milímetros.

## Lo que la validación comprueba

El script no escribe nada si algo falla. Por estructura: que tenga elementos
en el mapa, que la malla cargue, que no esté vacía, que la caja delimitadora
no sea degenerada, que los vértices sean finitos y que las normales estén
completas. Del conjunto: que no se pase del presupuesto de 3M de triángulos.
Y del fichero ya escrito: que exponga los nueve nombres de nodo, releyendo la
cabecera JSON del GLB en crudo, sin pasar por la librería que lo escribió.

Estado en la última ejecución: **84.170 triángulos**, un 2,8% del presupuesto,
2,1 MB de `.glb`.

| Estructura | Elementos | Triángulos | Caja (mm) |
|---|---|---|---|
| LeftVentricle | 8 | 16.846 | 69 × 75 × 71 |
| RightVentricle | 10 | 25.586 | 74 × 60 × 87 |
| LeftAtrium | 2 | 8.608 | 86 × 81 × 73 |
| RightAtrium | 2 | 20.028 | 43 × 70 × 96 |
| Aorta | 2 | 1.066 | 42 × 88 × 83 |
| PulmonaryArtery | 3 | 7.430 | 138 × 101 × 70 |
| PulmonaryVeins | 7 | 2.598 | 119 × 57 × 72 |
| SuperiorVenaCava | 1 | 598 | 23 × 24 × 35 |
| InferiorVenaCava | 1 | 1.410 | 23 × 23 × 96 |

## Lo que la validación no puede comprobar

Que el resultado se vea bien. Las proyecciones de `--preview` sirven para
cazar un montaje mal hecho —una cavidad fuera de sitio, un vaso suelto en
mitad de la nada—, no para juzgar el aspecto. Eso hay que mirarlo en la
escena, con luces, cuando exista.

Dos cosas que ya se sabe que están así y no son fallos: los bordes rectos de
las aurículas son los tapones planos con que BodyParts3D cierra el molde en
las desembocaduras venosas, y las mallas no traen materiales ni texturas, así
que todo el aspecto final dependerá de la iluminación.
