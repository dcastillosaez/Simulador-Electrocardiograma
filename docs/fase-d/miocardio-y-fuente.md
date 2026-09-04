# Por qué el corte anatómico no puede salir de BodyParts3D

Se planteó añadir el miocardio al modelo trayendo `FMA7274`, "wall of heart",
que `anatomy-source.md` menciona de pasada como lo único que el espejo de
GitHub trae del corazón. La verificación dice que ese camino no existe, y de
paso aclara qué es exactamente lo que ya hay dentro del `heart.glb`.

## FMA7274 no está en el archivo oficial

Cero elementos, en las dos jerarquías:

```
FMA7274  partof=0  isa=0
```

Lo mismo que ya le pasaba a `FMA7133`, el tabique interventricular. El espejo
de GitHub empaqueta mallas fusionadas por concepto y por eso allí aparece algo
llamado `FMA7274`; el archivo del NBDC, que es el que usa
`build-heart-model.py`, publica malla por elemento y ese concepto no tiene
ninguno asignado.

## Ningún otro concepto aporta miocardio ventricular

`FMA7088`, "heart", son 83 elementos. Veintidós están ya en el `heart.glb`
—las cuatro cámaras— y los sesenta y uno restantes son vasos coronarios sin
excepción. No hay una malla de músculo esperando a que alguien la pida.

Los conceptos que prometen pared existen, pero no contienen lo que su nombre
sugiere:

| Concepto | Nombre | Elementos |
|---|---|---|
| FMA9556 | wall of left ventricle | FJ2418, FJ2429, FJ2432 |
| FMA9533 | wall of right ventricle | FJ2419, FJ2430, FJ2437 |
| FMA9531 | wall of left atrium | FJ2438 |
| FMA9457 | wall of right atrium | FJ2439 |

Los tres elementos de la "pared del ventrículo izquierdo" son, midiéndolos:
dos sólidos macizos de 6,5 y 6,1 mL —los músculos papilares, que la ontología
cuenta como parte de la pared con toda la razón anatómica— y una membrana
cerrada de 1,6 mL de material repartidos en 3.820 triángulos. Ninguno envuelve
la cavidad: los tres quedan a 26 mm o más de ella. No hay pared libre.

## Lo que sí hay, que es más de lo que parecía

Las cuatro cámaras no son moldes opacos. Cada una trae su cavidad y, en las
aurículas, también su pared:

| Estructura | Sólido | Volumen | Naturaleza |
|---|---|---|---|
| VI | cavidad (FJ2422) | 115,3 mL | macizo |
| VI | 2 papilares + 5 valvas | 6,5 / 6,1 / ≤1,6 mL | macizos y membranas |
| VD | cavidad (FJ2423) | 137,8 mL | macizo |
| AI | cavidad (FJ2425) | 61,2 mL | macizo |
| AI | pared (FJ2438) | 47,7 mL | **cáscara que envuelve la cavidad a 1,9 mm** |
| AD | cavidad (FJ2424) | 99,6 mL | macizo |
| AD | pared (FJ2439) | 32,5 mL | **cáscara que envuelve la cavidad a 2,1 mm** |

Las cuatro cavidades suman 414 mL, que es el contenido de sangre de un corazón
en telediástole. Lo que se ve hoy en pantalla, gris y de una pieza, es el
volumen sanguíneo del corazón, no su músculo.

Las aurículas, por tanto, ya están completas: pared y luz, con un grosor
medido de 1,9 y 2,1 mm, que es el que tiene una aurícula. Un corte pasa por
ellas y se ve bien. Por los ventrículos pasa por sangre y no encuentra músculo.

## Cómo se comprobó

Sobre el `heart.glb` ya escrito, sin volver a la fuente:

1. **Soldadura por posición.** Las nueve mallas parecen tener miles de aristas
   abiertas —2.846 solo el VI—, pero son vértices duplicados en las costuras
   entre elementos. Tras fundir: 0 aristas abiertas y 0 no-manifold en las
   nueve. Son cerradas.
2. **Descomposición en componentes conexas.** Cada estructura se separa en
   tantos sólidos como elementos la componen, y el reparto coincide con el que
   declara la ontología.
3. **Paridad de rayos desde el centroide de cada sólido.** Un número impar de
   cruces significa que el centroide está en el material: sólido macizo. Un
   número par significa que está en un hueco: cáscara. Es lo que separa un
   molde de sangre de una pared.
4. **Paridad desde el centroide de la cavidad contra cada uno de los demás
   sólidos.** Dos cruces significan que ese sólido envuelve la cavidad. Sale
   dos en las dos aurículas y cero en todo lo demás.

Un aviso para quien repita esto: los nodos del GLB llevan la transformación en
`matrix`, no en `translation`. Leer solo `translation` deja las nueve mallas
apiladas en el origen y cualquier medida entre estructuras sale inventada.

## Qué queda entonces

**Las coronarias sí están disponibles**, sesenta y un elementos sin usar, y no
cuestan nada en presupuesto: el modelo va por 84.170 triángulos de los tres
millones permitidos.

**El miocardio ventricular habría que sintetizarlo**, engordando la cavidad
hacia fuera hasta un grosor plausible. Sería geometría inventada presentada
como anatomía, exactamente lo que se rechazó con el tabique. Es una decisión
que puede esperar: no bloquea ni los materiales por estructura ni el
aislamiento por grupos, y conviene tomarla con el modelo ya coloreado delante.
