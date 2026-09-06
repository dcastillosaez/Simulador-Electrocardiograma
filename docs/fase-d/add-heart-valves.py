"""Añade las cuatro válvulas a `apps/web/public/models/heart.glb`.

Las once valvas y velos que forman la tricúspide, la mitral, la aórtica y la
pulmonar están en BodyParts3D como conceptos propios, pero `build-heart-model.py`
las funde dentro del ventrículo de su lado: una válvula auriculoventricular
aparece listada a la vez en la aurícula y en el ventrículo, y dejarla en las dos
duplicaría la geometría. Para animarlas hace falta lo contrario — que cada valva
sea un nodo suyo — y eso es lo que hace este script.

Cada valva sale con **dos poses**: la de la fuente, que es la válvula cerrada, y
una pose abierta que se calcula girándola sobre su anillo. La diferencia entre
las dos viaja en el `.glb` como *morph target* de glTF, así que el cliente 3D
anima cada válvula con un solo número entre 0 y 1 y el trabajo lo hace la GPU.
Lo geométrico —dónde está el anillo, sobre qué eje gira cada valva, cuánto
arrastra a su cuerda tendinosa— se resuelve aquí, una vez, y queda auditable.

**Por qué es un script aparte y no un cambio en `build-heart-model.py`.** El
modelo que hay en el repositorio lleva además una capa de miocardio sintetizado
(ver `miocardio-y-fuente.md`) que no sale de BodyParts3D y que aquel script no
reconstruye. Regenerar el `.glb` desde cero la perdería. Este script parte del
`.glb` que ya existe, se queda con el miocardio tal cual y **rehace** las nueve
estructuras anatómicas desde la fuente, ahora sin las valvas. Se puede volver a
ejecutar sobre su propia salida: reproduce la misma geometría vértice a vértice.
Los bytes no son idénticos porque la calibración se vuelve a deducir del `.glb`
de entrada, cuyos vértices están en coma flotante de 32 bits, y eso mueve el
origen de cada nodo del orden de una diezmilmillonésima de milímetro.

Uso:

    uv run --with trimesh --with numpy --with scipy --with networkx \\
        python docs/fase-d/add-heart-valves.py
    ... --validate-only
    ... --preview docs/fase-d/valves.png

Fuente: BodyParts3D, Copyright(c) The Database Center for Life Science
licensed by CC Attribution-Share Alike 2.1 Japan. Ver `attribution.md`.
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL = REPO_ROOT / "apps" / "web" / "public" / "models" / "heart.glb"
MESH_ARCHIVE = "isa_BP3D_4.0_obj_99.zip"
ELEMENT_MAPS = ("partof_element_parts.txt", "isa_element_parts.txt")

# Las nueve estructuras anatómicas, copiadas de `build-heart-model.py`. Se
# repiten aquí y no se importan porque aquel fichero es un script con un `main`
# y no un módulo: importarlo obligaría a convertirlo en paquete para ganar
# nueve líneas. Si alguna vez divergen, la validación de este script lo canta —
# compara lo que reconstruye contra el `.glb` que ya existe, vértice a vértice.
STRUCTURES = [
    ("LeftVentricle", ("FMA7101",), "partof", 0, ()),
    ("RightVentricle", ("FMA7098",), "partof", 0, ()),
    ("LeftAtrium", ("FMA7097",), "partof", 1, ()),
    ("RightAtrium", ("FMA7096",), "partof", 1, ()),
    ("Aorta", ("FMA3736", "FMA3768"), "partof", 2, ()),
    (
        "PulmonaryArtery",
        ("FMA8612", "FMA50872", "FMA50873"),
        "partof",
        2,
        ("FMA67994", "FMA67995"),
    ),
    (
        "PulmonaryVeins",
        ("FMA49914", "FMA49911", "FMA49916", "FMA49913"),
        "partof",
        2,
        ("FMA68002", "FMA68003", "FMA68004", "FMA68005"),
    ),
    ("SuperiorVenaCava", ("FMA4720",), "partof", 2, ()),
    ("InferiorVenaCava", ("FMA10951",), "partof", 2, ()),
]

CARDIAC_MARGIN_MM = 60.0
CARRIED_OVER = "Myocardium"
"""Lo único que no se reconstruye desde la fuente: geometría sintetizada."""

# Las cuatro válvulas y sus valvas, con la cavidad de la que vienen y a la que
# van. Ese par no es decorativo: el anillo de cada válvula se calcula como la
# superficie donde los dos moldes se tocan, así que decide toda la geometría
# que sigue.
#
# Las tres sigmoideas pulmonares y las tres aórticas están en BodyParts3D como
# conceptos separados; las auriculoventriculares, con sus dos y tres velos. Los
# nombres de nodo son el contrato con `heart-valves.ts`.
VALVES = {
    "Tricuspid": {
        "leaflets": {
            "TricuspidAnterior": "FJ2421",
            "TricuspidPosterior": "FJ2433",
            "TricuspidSeptal": "FJ2436",
        },
        "upstream": "RightAtrium",
        "downstream": "RightVentricle",
        "kind": "atrioventricular",
    },
    "Mitral": {
        "leaflets": {
            "MitralAnterior": "FJ2420",
            "MitralPosterior": "FJ2432",
        },
        "upstream": "LeftAtrium",
        "downstream": "LeftVentricle",
        "kind": "atrioventricular",
    },
    "Aortic": {
        # FJ2426 y FJ2431 aparecen también bajo "anillo fibroso de la mitral"
        # (FMA9498): es la continuidad mitroaórtica, y no un error de los
        # datos. Se asignan a la aórtica, que es de lo que la ontología los
        # llama valva.
        "leaflets": {
            "AorticLeft": "FJ2426",
            "AorticRight": "FJ2431",
            "AorticAnterior": "FJ2435",
        },
        "upstream": "LeftVentricle",
        "downstream": "Aorta",
        "kind": "semilunar",
    },
    "Pulmonary": {
        "leaflets": {
            "PulmonaryLeft": "FJ2417",
            "PulmonaryPosterior": "FJ2427",
            "PulmonaryRight": "FJ2434",
        },
        "upstream": "RightVentricle",
        "downstream": "PulmonaryArtery",
        "kind": "semilunar",
    },
}

VALVE_ELEMENTS = {
    element for valve in VALVES.values() for element in valve["leaflets"].values()
}

RING_PERCENTILE = 3.0
"""Qué parte del molde de aguas arriba cuenta como contacto con el de aguas
abajo. Con el 3% más cercano, el anillo sale con una desviación del plano de
1 mm sobre un radio de 8 a 17 mm: es un anillo plano de verdad, no una nube."""

# Cuánto puede girar cada válvula y qué parte de cada valva gira.
#
# Los dos ángulos son TOPES, no valores. El que se usa lo busca el script para
# cada válvula, contra dos propiedades que sí se pueden comprobar: que la valva
# abierta no se vea desde fuera y que la cerrada no deje pasar. Fijarlos a ojo
# es lo que había antes, y producía las dos cosas que un ángulo a ojo produce —
# la sigmoidea pulmonar izquierda asomaba por fuera del tronco al abrirse y el
# orificio aórtico se quedaba abierto un 15% al cerrarse.
#
# `hinge_mm`, `free_mm` y `papillary_mm` describen QUÉ se mueve, y son la
# corrección de fondo: **una valva está anclada por su base y ahí no gira**.
# Antes el giro era pleno desde el anillo, así que la inserción se despegaba de
# la pared y la atravesaba. Ahora el peso del giro sale de cero en el anclaje.
#
# En las auriculoventriculares el anclaje es el anillo y el peso sube de 0 a 1
# en los `hinge_mm` primeros milímetros; se mantiene en 1 por el cuerpo del
# velo hasta `free_mm`, que es donde acaba, y baja otra vez a 0 en
# `papillary_mm`, que es donde está el músculo papilar. La malla de BodyParts3D
# no es solo el velo: lleva pegada la cuerda tendinosa cuarenta y tantos
# milímetros más abajo, y el papilar no se mueve — que es exactamente la razón
# de que la cuerda tendinosa exista.
#
# En las sigmoideas el anclaje no es un plano sino la línea en U con la que la
# valva se inserta en la pared del vaso, así que el peso no se mide en
# profundidad sino en distancia a esa pared: cero sobre ella, uno en el borde
# libre. `base_fraction` dice a qué parte de la anchura de la valva se alcanza
# el giro pleno.
MOTION = {
    "Tricuspid": {
        "open_deg": 62.0,
        "close_deg": 70.0,
        "hinge_mm": 4.0,
        "free_mm": 8.0,
        "papillary_mm": 34.0,
    },
    "Mitral": {
        "open_deg": 62.0,
        "close_deg": 70.0,
        "hinge_mm": 4.0,
        "free_mm": 9.0,
        "papillary_mm": 36.0,
    },
    "Aortic": {"open_deg": 75.0, "close_deg": 40.0, "base_fraction": 0.55},
    "Pulmonary": {"open_deg": 75.0, "close_deg": 40.0, "base_fraction": 0.55},
}

OPEN_SAFETY = 0.90
"""Del ángulo máximo que aún deja la valva escondida se usa el 90%.

La prueba de visibilidad es binaria —o escapa un rayo o no—, así que el margen
no puede salir de ella. Sale del ángulo: quedarse un 10% por debajo del punto
en el que la valva empieza a asomar deja sitio para que el cliente interpole
entre las dos poses sin que ningún fotograma intermedio se salga."""

CLOSE_MARGIN_DEG = 4.0
"""Lo que se cierra de más una vez sellado el orificio.

Coaptar es que los velos se solapen, no que se toquen justo: un cierre al
límite se abre con cualquier redondeo, y el solapamiento es lo que hace
hermética una válvula de verdad."""

ESCAPE_DIRECTIONS = 42
"""Direcciones de la esfera por las que se intenta escapar desde cada vértice.

Cuarenta y dos repartidas por Fibonacci: separadas unos 25°, que para una valva
de 10 mm a 30 mm de la pared es de sobra para encontrar el hueco por el que se
la ve. Subirlo no cambia el veredicto de ninguna valva; se comprobó con 162."""

ORIFICE_SAMPLES = 24
"""Celdas por radio de la rejilla con la que se mide la fuga del orificio."""

ORIFICE_FRACTION = 0.70
"""Qué parte del disco del anillo es orificio de verdad.

El anillo de contacto sale de dónde se tocan dos moldes de sangre, y su borde
no es el borde del agujero que la válvula tiene que tapar: es la inserción
misma, y en las sigmoideas, además, los senos de Valsalva, que quedan DETRÁS
de la valva. Un rayo que pasa por ahí no atraviesa la válvula, la roza. Medir
el disco entero daba un 15% de fuga a una válvula aórtica que en el centro
estaba sellada al 0,3%; con el 70% interior, la cifra dice lo que se ve."""

MAX_CLOSED_LEAK = 0.03
"""Fuga que se admite con la válvula cerrada.

No es cero por una razón del dato y no de la anatomía: la malla de una valva
auriculoventricular de BodyParts3D lleva las cuerdas tendinosas como un encaje
de tiras, y entre tira y tira pasan rayos que en el corazón de verdad no pasan
por ninguna parte — las cuerdas están detrás del velo, no en el orificio.
Perseguir el cero sería perseguir el ruido de una malla, no cerrar nada."""

ANNULUS_RADIUS_RANGE_MM = {
    # Rangos anatómicos de referencia para el radio del anillo. No son un
    # adorno: si el ajuste del anillo se va, el eje de giro se va con él y las
    # válvulas se abrirían hacia donde no es. Aquí se corta antes de escribir.
    "Tricuspid": (12.0, 22.0),
    "Mitral": (12.0, 20.0),
    "Aortic": (7.0, 15.0),
    "Pulmonary": (7.0, 15.0),
}

# Lo que se ve del corazón desde fuera. Los dos ventrículos no están: viven
# dentro del miocardio, que sí. Una valva escondida dentro de cualquiera de
# estas superficies no se ve, y esa es toda la prueba.
SKIN = (
    "Myocardium",
    "Aorta",
    "PulmonaryArtery",
    "LeftAtrium",
    "RightAtrium",
    "PulmonaryVeins",
    "SuperiorVenaCava",
    "InferiorVenaCava",
)


# ---------------------------------------------------------------- fuente ----


def load_element_map(path: Path) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = defaultdict(list)
    with path.open(encoding="utf-8") as handle:
        next(handle)
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if len(fields) >= 3:
                mapping[fields[0]].append(fields[2])
    return mapping


def resolve_elements(maps: dict[str, dict[str, list[str]]]) -> dict[str, list[str]]:
    """Elementos de cada estructura, sin solapes. Igual que en el script
    hermano: las valvas caen del lado del ventrículo, y de ahí las saca luego
    `without_valves`."""
    claimed: dict[str, str] = {}
    resolved: dict[str, list[str]] = {}
    for name, includes, tree, _, exclude in sorted(STRUCTURES, key=lambda row: row[3]):
        excluded = {
            element
            for other in exclude
            for source in maps.values()
            for element in source.get(other, [])
        }
        elements = []
        for fma in includes:
            for element in maps[tree].get(fma, []):
                if element in claimed or element in excluded:
                    continue
                claimed[element] = name
                elements.append(element)
        resolved[name] = elements
    return resolved


class Source:
    """Las mallas de elemento del archivo de BodyParts3D, ya en el sistema del
    modelo: rotadas a Y-arriba y con la misma escala y desplazamiento que el
    `.glb` que hay en el repositorio."""

    ROTATION = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])[:3, :3]

    def __init__(self, archive: Path):
        self.zip = zipfile.ZipFile(archive)
        self.scale = 1.0
        self.offset = np.zeros(3)

    def raw(self, element: str) -> trimesh.Trimesh:
        data = io.BytesIO(self.zip.read(f"isa_BP3D_4.0_obj_99/{element}.obj"))
        mesh = trimesh.load(data, file_type="obj", process=False)
        return mesh.to_geometry() if isinstance(mesh, trimesh.Scene) else mesh

    def calibrate(self, element: str, target: np.ndarray) -> float:
        """Deduce escala y desplazamiento comparando una estructura conocida
        con la que ya está en el `.glb`.

        Se deducen en vez de recalcularse porque lo que importa no es repetir
        la fórmula del script hermano sino caer **exactamente** encima del
        modelo que hay: si el corazón se moviera medio milímetro, las válvulas
        nuevas encajarían y las nueve estructuras viejas no. Devuelve el
        residuo máximo, que es lo que dice si la deducción es de fiar."""
        source = np.asarray(self.raw(element).vertices) @ self.ROTATION.T
        self.scale = float(
            np.linalg.norm(target - target.mean(0))
            / np.linalg.norm(source - source.mean(0))
        )
        self.offset = source.mean(0) - target.mean(0) / self.scale
        return float(np.abs(self.scale * (source - self.offset) - target).max())

    def element(self, name: str) -> trimesh.Trimesh:
        mesh = self.raw(name)
        mesh.vertices = self.scale * (
            (np.asarray(mesh.vertices) @ self.ROTATION.T) - self.offset
        )
        return mesh


def glb_nodes(path: Path) -> dict[str, trimesh.Trimesh]:
    """Nodos del `.glb`, cada uno con su transformación ya aplicada."""
    scene = trimesh.load(path)
    nodes: dict[str, trimesh.Trimesh] = {}
    for node in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        nodes[node] = mesh
    return nodes


# --------------------------------------------------------------- válvulas ----


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def contact_ring(
    upstream: trimesh.Trimesh, downstream: trimesh.Trimesh
) -> tuple[np.ndarray, np.ndarray, float, int]:
    """Anillo valvular: dónde se tocan los dos moldes que la válvula separa.

    Es la definición anatómica y no una aproximación geométrica. Un molde de
    sangre auricular termina donde empieza el ventricular, y esa frontera *es*
    el anillo — el mismo plano fibroso al que se insertan los velos. Sale un
    centro, una normal en el sentido del flujo y un radio."""
    a = np.asarray(upstream.vertices)
    b = np.asarray(downstream.vertices)
    distance, _ = cKDTree(b).query(a)
    ring = a[distance <= np.percentile(distance, RING_PERCENTILE)]

    centre = ring.mean(0)
    _, _, axes = np.linalg.svd(ring - centre, full_matrices=False)
    normal = axes[2]
    # El signo que da una descomposición en valores singulares es arbitrario.
    # La normal tiene que apuntar aguas abajo, que es lo que después decide
    # hacia dónde se abre cada valva.
    if normal @ (b.mean(0) - centre) < 0:
        normal = -normal
    radius = np.linalg.norm(
        (ring - centre) - np.outer((ring - centre) @ normal, normal), axis=1
    )
    return centre, normal, float(np.median(radius)), len(ring)


def valve_frame(
    spec: dict, chambers: dict[str, trimesh.Trimesh], leaflets: dict[str, trimesh.Trimesh]
) -> tuple[np.ndarray, np.ndarray, float, int]:
    centre, normal, radius, count = contact_ring(
        chambers[spec["upstream"]], chambers[spec["downstream"]]
    )
    if spec["kind"] == "semilunar":
        # Entre el molde del ventrículo y el del vaso no queda una frontera:
        # queda el hueco de la válvula entera, y lo más cercano entre los dos
        # cae a la altura de la coaptación, con las valvas repartidas por
        # encima y por debajo. La bisagra de una sigmoidea está en su nadir,
        # así que el plano se baja hasta el extremo de aguas arriba de las tres.
        points = np.vstack([np.asarray(m.vertices) for m in leaflets.values()])
        centre = centre + normal * float(np.percentile((points - centre) @ normal, 2.0))
    return centre, normal, radius, count


def dense_points(mesh: trimesh.Trimesh) -> np.ndarray:
    """Vértices, centros de cara y puntos medios de arista.

    Densifica una malla sin muestreo aleatorio, que en un script cuyo resultado
    se versiona no vale: dos ejecuciones tienen que dar el mismo `.glb`. Sirve
    para medir distancias a una superficie con un árbol de puntos, sin arrastrar
    `rtree` solo para eso — el molde de la aorta trae 610 vértices para toda su
    superficie y a pelo sesgaría la medida un par de milímetros."""
    v = np.asarray(mesh.vertices)
    f = np.asarray(mesh.faces)
    centres = v[f].mean(axis=1)
    edges = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    mids = v[edges].mean(axis=1)
    return np.vstack([v, centres, mids])


def escape_directions(count: int) -> np.ndarray:
    """Direcciones repartidas por la esfera con la espiral de Fibonacci."""
    i = np.arange(count) + 0.5
    polar = np.arccos(1.0 - 2.0 * i / count)
    azimuth = np.pi * (1.0 + 5.0 ** 0.5) * i
    return np.column_stack(
        [np.cos(azimuth) * np.sin(polar), np.sin(azimuth) * np.sin(polar), np.cos(polar)]
    )


def visible_from_outside(points: np.ndarray, skin: trimesh.Trimesh) -> np.ndarray:
    """Qué puntos se ven desde fuera del corazón, uno a uno.

    Desde cada punto salen rayos en todas direcciones contra la piel del
    órgano. Si alguno escapa sin chocar, ese punto se ve. Es la pregunta que
    hace el usuario del simulador —«¿se le ve la válvula al corazón?»— y no una
    aproximación suya: no depende de que los moldes sean sólidos cerrados (no lo
    son, están cortados por donde acaban los vasos) ni de envolventes convexas,
    que dan por dentro todo lo que quede en un entrante del órgano.

    Antes esto se medía contra la envolvente convexa de las diez estructuras, y
    por eso pasó una sigmoidea pulmonar que asomaba de verdad: por fuera del
    tronco pero por dentro del casco."""
    directions = escape_directions(ESCAPE_DIRECTIONS)
    origins = np.repeat(points, len(directions), axis=0)
    rays = np.tile(directions, (len(points), 1))
    # Un pelo hacia el rayo para no chocar con la propia superficie de salida.
    blocked = skin.ray.intersects_any(origins + rays * 1e-5, rays)
    return (~blocked.reshape(len(points), len(directions))).any(axis=1)


def orifice_leak(
    posed: dict[str, np.ndarray],
    faces: dict[str, np.ndarray],
    centre: np.ndarray,
    normal: np.ndarray,
    radius: float,
) -> float:
    """Qué parte del orificio deja pasar la válvula, de 0 a 1.

    Rayos a lo largo del eje del flujo por el orificio. Los que atraviesan sin
    tocar valva son la fuga. Con la válvula cerrada tiene que ser casi cero:
    una válvula que coapta no es una que se toca en algún punto suelto, es una
    por la que no se ve a través."""
    mesh = trimesh.util.concatenate(
        [
            trimesh.Trimesh(vertices=posed[name], faces=faces[name], process=False)
            for name in posed
        ]
    )
    basis = np.cross(normal, [1.0, 0.0, 0.0])
    if np.linalg.norm(basis) < 1e-6:
        basis = np.cross(normal, [0.0, 1.0, 0.0])
    basis /= np.linalg.norm(basis)
    other = np.cross(normal, basis)
    orifice = radius * ORIFICE_FRACTION
    step = orifice / ORIFICE_SAMPLES
    grid = np.arange(-orifice, orifice + step, step)
    x, y = np.meshgrid(grid, grid)
    inside = x ** 2 + y ** 2 <= orifice ** 2
    offsets = np.column_stack([x[inside], y[inside]])
    origins = (
        centre
        + offsets[:, :1] * basis
        + offsets[:, 1:2] * other
        - normal * (radius * 2.0)
    )
    return float((~mesh.ray.intersects_any(origins, np.tile(normal, (len(origins), 1)))).mean())


def leaflet_hinge(
    mesh: trimesh.Trimesh, centre: np.ndarray, normal: np.ndarray, radius: float
) -> tuple[np.ndarray, np.ndarray]:
    """Punto y eje de giro de una valva: la tangente al anillo en su sector.

    Una valva no gira sobre un eje cualquiera — gira sobre su inserción, que
    es un arco del anillo. La tangente en el punto del anillo que le
    corresponde por posición es la recta que mejor lo aproxima."""
    points = np.asarray(mesh.vertices)
    towards = points.mean(0) - centre
    radial = towards - (towards @ normal) * normal
    radial /= np.linalg.norm(radial)
    axis = np.cross(normal, radial)
    return centre + radius * radial, axis / np.linalg.norm(axis)


def rotate_about(
    points: np.ndarray, origin: np.ndarray, axis: np.ndarray, angle: np.ndarray
) -> np.ndarray:
    """Rodrigues con un ángulo por vértice. Con el ángulo constante es un giro
    rígido; con el ángulo decreciendo, la valva gira y la cuerda tendinosa se
    queda por el camino."""
    relative = points - origin
    cos = np.cos(angle)[:, None]
    sin = np.sin(angle)[:, None]
    return (
        origin
        + relative * cos
        + np.cross(axis, relative) * sin
        + axis[None, :] * ((relative @ axis)[:, None]) * (1.0 - cos)
    )


def attachment_weights(
    points: np.ndarray,
    kind: str,
    motion: dict,
    centre: np.ndarray,
    normal: np.ndarray,
    wall: cKDTree | None,
    mm_per_unit: float,
) -> np.ndarray:
    """Cuánto gira cada vértice, de 0 en el anclaje a 1 en el borde libre.

    Es la pieza que hace que una valva se comporte como una membrana sujeta por
    la base y no como una tapa con bisagra. Girar la valva entera en bloque
    despega la inserción de la pared y la mete a través de ella; el resultado se
    ve desde fuera del corazón, que es justo lo que no puede pasar."""
    if kind == "semilunar":
        assert wall is not None
        distance = wall.query(points)[0] * mm_per_unit
        # La anchura de esta valva concreta y no un número fijo: la sigmoidea
        # pulmonar izquierda mide el doble que cualquier aórtica, y el borde
        # libre de cada una está donde está.
        span = float(np.percentile(distance, 95.0))
        if span <= 0.0:
            return np.ones(len(points))
        return smoothstep(distance / max(span * motion["base_fraction"], 1e-6))

    depth = ((points - centre) @ normal) * mm_per_unit
    anchored = smoothstep(depth / motion["hinge_mm"])
    trailing = 1.0 - smoothstep(
        (depth - motion["free_mm"]) / (motion["papillary_mm"] - motion["free_mm"])
    )
    return anchored * trailing


def opening_sign(
    points: np.ndarray,
    origin: np.ndarray,
    axis: np.ndarray,
    weights: np.ndarray,
    centre: np.ndarray,
    normal: np.ndarray,
) -> float:
    """Cuál de los dos sentidos de giro abre la valva.

    No se escribe a mano: se prueban los dos y se queda el que aleja del eje de
    la válvula lo que de verdad se mueve. Escribirlo serían once decisiones que
    revisar cada vez que se toca la geometría; así es una propiedad que se
    comprueba sola."""
    moving = weights >= 0.5 * weights.max()

    def mean_radius(sign: float) -> float:
        posed = rotate_about(points, origin, axis * sign, weights)[moving]
        relative = posed - centre
        return float(
            np.mean(
                np.linalg.norm(relative - np.outer(relative @ normal, normal), axis=1)
            )
        )

    return 1.0 if mean_radius(1.0) > mean_radius(-1.0) else -1.0


def posed_leaflets(
    leaflets: dict[str, dict],
    angle_deg: float,
    direction: float,
) -> dict[str, np.ndarray]:
    """Las valvas de una válvula giradas ese ángulo. `direction` +1 abre."""
    return {
        name: rotate_about(
            data["points"],
            data["origin"],
            data["axis"] * data["sign"] * direction,
            np.deg2rad(angle_deg) * data["weights"],
        )
        for name, data in leaflets.items()
    }


def largest_hidden_angle(
    leaflets: dict[str, dict],
    skin: trimesh.Trimesh,
    ceiling_deg: float,
    step_deg: float = 1.5,
) -> tuple[float, int]:
    """El mayor ángulo de apertura con el que ninguna valva se ve desde fuera.

    Se baja desde el tope en escalones en vez de bisecar: la visibilidad no es
    monótona con el ángulo —una valva puede salir por un hueco y volver a
    esconderse—, y una bisección sobre una condición no monótona devuelve
    cualquier cosa. Bajando se coge el primer ángulo bueno por debajo del tope,
    que es el que se quiere."""
    angle = ceiling_deg
    while angle > 0.0:
        posed = posed_leaflets(leaflets, angle, +1.0)
        exposed = sum(
            int(visible_from_outside(points, skin).sum()) for points in posed.values()
        )
        if exposed == 0:
            return angle, 0
        angle = round(angle - step_deg, 3)
    return 0.0, 1


def smallest_sealing_angle(
    leaflets: dict[str, dict],
    faces: dict[str, np.ndarray],
    centre: np.ndarray,
    normal: np.ndarray,
    radius: float,
    ceiling_deg: float,
    step_deg: float = 1.5,
) -> tuple[float, float]:
    """El menor ángulo de cierre que deja el orificio sin fuga.

    Cero es la pose de BodyParts3D, que no es una válvula cerrada: la fuente
    modela los velos entreabiertos, en una posición neutra que no es ninguna de
    las dos del ciclo. Por el orificio mitral se veía pasar la mitad del disco.
    Se cierra desde ahí hasta que deja de pasar, y luego un poco más — coaptar
    es solaparse."""
    angle = 0.0
    while angle <= ceiling_deg:
        leak = orifice_leak(
            posed_leaflets(leaflets, angle, -1.0), faces, centre, normal, radius
        )
        if leak <= MAX_CLOSED_LEAK:
            return min(angle + CLOSE_MARGIN_DEG, ceiling_deg), leak
        angle = round(angle + step_deg, 3)
    return ceiling_deg, orifice_leak(
        posed_leaflets(leaflets, ceiling_deg, -1.0), faces, centre, normal, radius
    )


# ------------------------------------------------------------------ glTF ----


def add_morph_targets(
    raw: bytes, targets: dict[str, list[dict[str, np.ndarray]]]
) -> bytes:
    """Mete las poses alternativas de cada malla en un GLB ya escrito.

    trimesh no sabe exportar *morph targets*, y son justo lo que hace falta:
    con ellos el cliente anima una válvula con un número y la interpolación la
    hace la GPU, sin tocar un vértice por fotograma ni duplicar materiales.
    Se añaden aquí, sobre el binario que trimesh acaba de escribir, porque el
    formato es abierto y esto son cuarenta líneas — bastante menos que la
    alternativa de escribir el GLB entero a mano.

    `targets` lleva, por nombre de malla, DOS objetivos y no uno: el primero es
    la diferencia entre la pose cerrada y la abierta, y el segundo la comba que
    hace falta para que el camino entre las dos sea un arco y no una cuerda. En
    `POSITION` va la diferencia de cada vértice y en `NORMAL` la de su normal;
    glTF guarda los *morph targets* como diferencias, no como valores absolutos.

    Lo de la comba merece una línea: una valva mitral recorre unos cien grados
    entre cerrada y abierta, y la GPU interpola en línea recta entre las poses
    que se le den. La recta entre los extremos de un arco de cien grados se mete
    un 38% por dentro, así que a mitad de camino el velo se acortaba esa
    barbaridad — se veía encogerse y volver a crecer en cada latido. El
    segundo objetivo lo devuelve al arco.

    Las normales van también, y no son un lujo: sin ellas la valva se movería
    con la iluminación de la pose cerrada, y una membrana que gira sesenta
    grados con la luz pegada al sitio de donde salió se ve plana justo cuando
    más se mira."""
    json_length = int.from_bytes(raw[12:16], "little")
    document = json.loads(raw[20 : 20 + json_length])
    binary_start = 20 + json_length + 8
    binary = bytearray(raw[binary_start:])

    def add_accessor(deltas: np.ndarray) -> int:
        payload = np.ascontiguousarray(deltas, dtype="<f4").tobytes()
        # Todo desplazamiento de vértice se alinea a 4 bytes por la propia
        # anchura del flotante, pero el búfer anterior puede no acabar en un
        # múltiplo: sin este relleno el visor lee basura.
        while len(binary) % 4:
            binary.append(0)
        document["bufferViews"].append(
            {
                "buffer": 0,
                "byteOffset": len(binary),
                "byteLength": len(payload),
                "target": 34962,
            }
        )
        binary.extend(payload)
        document["accessors"].append(
            {
                "bufferView": len(document["bufferViews"]) - 1,
                "componentType": 5126,
                "count": int(len(deltas)),
                "type": "VEC3",
                # `min` y `max` son obligatorios en un accesor de POSITION, y
                # los validadores de glTF lo comprueban.
                "min": [float(v) for v in deltas.min(axis=0)],
                "max": [float(v) for v in deltas.max(axis=0)],
            }
        )
        return len(document["accessors"]) - 1

    for mesh in document["meshes"]:
        target = targets.get(mesh.get("name", ""))
        if target is None:
            continue
        written = [
            {name: add_accessor(deltas) for name, deltas in pose.items()}
            for pose in target
        ]
        for primitive in mesh["primitives"]:
            primitive["targets"] = written
        # Los pesos iniciales: la válvula arranca cerrada y sin comba. El
        # cliente los sobrescribe en cuanto llega el primer latido.
        mesh["weights"] = [0.0] * len(written)
        mesh.setdefault("extras", {})["targetNames"] = ["open", "bulge"]

    document["buffers"][0]["byteLength"] = len(binary)

    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    binary.extend(b"\x00" * (-len(binary) % 4))

    header = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(encoded) + 8 + len(binary))
    return (
        header
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(binary), 0x004E4942)
        + bytes(binary)
    )


def read_gltf_document(path: Path) -> dict:
    raw = path.read_bytes()
    length = int.from_bytes(raw[12:16], "little")
    return json.loads(raw[20 : 20 + length])


# ----------------------------------------------------------------- vistas ----


def write_preview(
    chambers: dict[str, trimesh.Trimesh],
    closed: dict[str, np.ndarray],
    opened: dict[str, np.ndarray],
    target: Path,
) -> None:
    """Las once valvas cerradas y abiertas, sobre los moldes de las cámaras.

    Sirve para cazar un montaje mal hecho —una valva girando hacia el lado que
    no es, una punta saliéndose del ventrículo—, no para juzgar el aspecto:
    eso es la escena de Three.js."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    views = [("Frontal", 0, 1), ("Lateral", 2, 1), ("Superior", 0, 2)]
    colours = plt.get_cmap("tab20")
    figure, axes = plt.subplots(2, 3, figsize=(21, 14))
    # Sin apellido de fase: las cuatro válvulas no se cierran a la vez. Las
    # auriculoventriculares están cerradas en sístole y las sigmoideas en
    # diástole, así que rotular la fila entera con una fase es falso para la
    # mitad de lo que se ve en ella.
    for row, (poses, title) in enumerate(
        [(closed, "CERRADAS"), (opened, "ABIERTAS")]
    ):
        for axis, (view, i, j) in zip(axes[row], views):
            for mesh in chambers.values():
                points = np.asarray(mesh.vertices)
                axis.scatter(
                    points[:, i],
                    points[:, j],
                    s=0.3,
                    alpha=0.08,
                    linewidths=0,
                    color="0.55",
                )
            for index, (name, points) in enumerate(poses.items()):
                axis.scatter(
                    points[:, i],
                    points[:, j],
                    s=1.4,
                    alpha=0.85,
                    linewidths=0,
                    color=colours(index),
                    label=name,
                )
            axis.set_title(f"{title} — {view}")
            axis.set_aspect("equal")
            axis.grid(alpha=0.2)
    handles, labels = axes[0][0].get_legend_handles_labels()
    figure.legend(handles, labels, loc="lower center", ncol=6, markerscale=9, frameon=False)
    figure.tight_layout(rect=(0, 0.06, 1, 1))
    figure.savefig(target, dpi=95)
    plt.close(figure)


# ------------------------------------------------------------------- main ----


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--preview", type=Path)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(__file__).resolve().parent / ".bodyparts3d-cache",
    )
    args = parser.parse_args()

    if not MODEL.exists():
        print(f"MAL: no existe {MODEL}. Ejecuta antes build-heart-model.py.")
        return 1
    # Las dos comprobaciones que deciden la geometría —que la valva no se vea
    # desde fuera y que cerrada no deje pasar— son trazado de rayos, y sin un
    # motor detrás trimesh no puede hacerlas. Se avisa aquí y no a los cinco
    # minutos de leer el archivo de mallas.
    probe = trimesh.creation.box()
    try:
        probe.ray.intersects_any(np.zeros((1, 3)), np.array([[0.0, 0.0, 1.0]]))
    except Exception as error:  # noqa: BLE001 — da igual cuál: falta el motor
        print(
            "MAL: no hay motor de trazado de rayos "
            f"({type(error).__name__}: {error}).\n"
            "     Añade `--with embreex` (o `--with rtree`) al comando."
        )
        return 1
    for name in (MESH_ARCHIVE, *ELEMENT_MAPS):
        if not (args.cache / name).exists():
            print(f"MAL: falta {name} en {args.cache}. Lo descarga build-heart-model.py.")
            return 1

    print("Modelo de partida")
    existing = glb_nodes(MODEL)
    print(f"  {MODEL.name}: {len(existing)} nodos, {MODEL.stat().st_size / 1e6:.1f} MB")
    if CARRIED_OVER not in existing:
        print(f"MAL: el modelo no trae {CARRIED_OVER}.")
        return 1

    maps = {
        "partof": load_element_map(args.cache / ELEMENT_MAPS[0]),
        "isa": load_element_map(args.cache / ELEMENT_MAPS[1]),
    }
    resolved = resolve_elements(maps)
    source = Source(args.cache / MESH_ARCHIVE)

    # Calibración contra la cava superior: un solo elemento, sin recorte
    # espacial y sin valvas, así que su malla en el `.glb` es la de la fuente
    # punto por punto.
    residual = source.calibrate(
        maps["partof"]["FMA4720"][0], np.asarray(existing["SuperiorVenaCava"].vertices)
    )
    mm_per_unit = 1.0 / source.scale
    print(
        f"  calibración: escala={source.scale:.12f} "
        f"(1 unidad = {mm_per_unit:.1f} mm), residuo={residual:.2e}"
    )
    if residual > 1e-6:
        print("MAL: la calibración no reproduce la cava superior.")
        return 1

    print("\nEstructuras reconstruidas sin sus valvas")
    failures = 0
    low, high = None, None
    chambers: dict[str, trimesh.Trimesh] = {}
    for name, *_ in STRUCTURES:
        if low is None:
            # La misma caja cardíaca que usa el script hermano para descartar
            # la aorta descendente y el árbol intrapulmonar. Se calcula con las
            # cuatro cavidades enteras, valvas incluidas: quitarlas cambiaría la
            # caja y con ella qué vasos entran, y el modelo dejaría de coincidir.
            corners = np.vstack(
                [
                    source.element(element).bounds
                    for chamber in (
                        "LeftVentricle",
                        "RightVentricle",
                        "LeftAtrium",
                        "RightAtrium",
                    )
                    for element in resolved[chamber]
                ]
            )
            margin = CARDIAC_MARGIN_MM * source.scale
            low, high = corners.min(axis=0) - margin, corners.max(axis=0) + margin

        kept = [
            element
            for element in resolved[name]
            if element not in VALVE_ELEMENTS
            and np.all(source.element(element).bounding_box.centroid >= low)
            and np.all(source.element(element).bounding_box.centroid <= high)
        ]
        mesh = trimesh.util.concatenate([source.element(element) for element in kept])
        chambers[name] = mesh
        removed = len(resolved[name]) - len(kept)
        print(
            f"  {name:17} elementos={len(kept):3} (-{removed:2}) "
            f"vértices={len(mesh.vertices):6} triángulos={len(mesh.faces):6}"
        )

    print("\nVálvulas")
    # Lo que tapa el corazón por fuera, en una sola malla: es contra esto —y no
    # contra una envolvente convexa— contra lo que se comprueba que una valva no
    # se ve.
    skin = trimesh.util.concatenate(
        [chambers[name] for name in SKIN if name in chambers]
        + [existing[name] for name in SKIN if name in existing]
    )
    closed: dict[str, np.ndarray] = {}
    opened: dict[str, np.ndarray] = {}
    bulged: dict[str, np.ndarray] = {}
    leaflet_meshes: dict[str, trimesh.Trimesh] = {}
    for valve, spec in VALVES.items():
        meshes = {
            name: source.element(element) for name, element in spec["leaflets"].items()
        }
        centre, normal, radius, ring = valve_frame(spec, chambers, meshes)
        radius_mm = radius * mm_per_unit
        floor, ceiling = ANNULUS_RADIUS_RANGE_MM[valve]
        status = "OK " if floor <= radius_mm <= ceiling else "MAL"
        if status == "MAL":
            failures += 1
        print(
            f"  {status} {valve:10} anillo: {ring:4} puntos, radio {radius_mm:5.1f} mm "
            f"(esperado {floor:.0f}-{ceiling:.0f}), normal {np.round(normal, 3)}"
        )

        motion = MOTION[valve]
        wall = None
        if spec["kind"] == "semilunar":
            # La pared en la que se inserta la valva: el vaso de aguas abajo y
            # el ventrículo de aguas arriba, que en la raíz son el mismo tubo.
            wall = cKDTree(
                np.vstack(
                    [
                        dense_points(chambers[spec["upstream"]]),
                        dense_points(chambers[spec["downstream"]]),
                    ]
                )
            )

        leaflets: dict[str, dict] = {}
        faces: dict[str, np.ndarray] = {}
        for name, mesh in meshes.items():
            points = np.asarray(mesh.vertices)
            weights = attachment_weights(
                points, spec["kind"], motion, centre, normal, wall, mm_per_unit
            )
            origin, axis = leaflet_hinge(mesh, centre, normal, radius)
            sign = opening_sign(points, origin, axis, weights, centre, normal)
            leaflets[name] = {
                "points": points,
                "origin": origin,
                "axis": axis,
                "sign": sign,
                "weights": weights,
            }
            faces[name] = np.asarray(mesh.faces)
            leaflet_meshes[name] = mesh

        source_leak = orifice_leak(
            {n: d["points"] for n, d in leaflets.items()}, faces, centre, normal, radius
        )
        close_deg, _ = smallest_sealing_angle(
            leaflets, faces, centre, normal, radius, motion["close_deg"]
        )
        closed_pose = posed_leaflets(leaflets, close_deg, -1.0)
        closed_leak = orifice_leak(closed_pose, faces, centre, normal, radius)
        status = "OK " if closed_leak <= MAX_CLOSED_LEAK else "MAL"
        if status == "MAL":
            failures += 1
        print(
            f"      {status} cierre {close_deg:5.1f}° hacia dentro — "
            f"fuga del orificio {100 * source_leak:5.1f}% en la fuente "
            f"→ {100 * closed_leak:4.1f}%"
        )

        # La apertura se busca desde la pose de la fuente y no desde la cerrada:
        # el ángulo de cierre corrige la fuente, no forma parte del recorrido
        # que se quiere enseñar.
        limit, missed = largest_hidden_angle(leaflets, skin, motion["open_deg"])
        failures += missed
        open_deg = limit * OPEN_SAFETY
        open_pose = posed_leaflets(leaflets, open_deg, +1.0)
        open_leak = orifice_leak(open_pose, faces, centre, normal, radius)
        print(
            f"      {'MAL' if missed else 'OK '} apertura {open_deg:5.1f}° "
            f"(último ángulo escondido {limit:4.1f}° de {motion['open_deg']:.0f}°) — "
            f"orificio libre {100 * open_leak:5.1f}%"
        )

        # La pose intermedia, y no por capricho: el cliente interpola en línea
        # recta entre las dos poses, y una recta entre dos puntos de un arco de
        # cien grados se mete muy por dentro del arco — la valva se acorta un
        # tercio a mitad de camino y se ve encogerse y volver a crecer. Con una
        # tercera pose en el medio, la trayectoria vuelve a pasar por el arco.
        halfway = (open_deg - close_deg) / 2.0
        middle = posed_leaflets(
            leaflets, abs(halfway), +1.0 if halfway >= 0.0 else -1.0
        )

        for name in leaflets:
            closed[name] = closed_pose[name]
            opened[name] = open_pose[name]
            bulged[name] = middle[name] - 0.5 * (closed_pose[name] + open_pose[name])
            travel = (
                np.linalg.norm(open_pose[name] - closed_pose[name], axis=1) * mm_per_unit
            )
            free = leaflets[name]["weights"] >= 0.5
            print(
                f"        {name:20} {spec['leaflets'][name]} "
                f"vértices={len(leaflets[name]['points']):5} "
                f"giro={leaflets[name]['sign']:+.0f} "
                f"libres={100 * free.mean():3.0f}% "
                f"recorrido medio={travel.mean():5.1f} mm máximo={travel.max():5.1f} mm"
            )

    print("\nNi cerradas ni abiertas se ven desde fuera del corazón")
    for name in closed:
        seen = {
            pose: int(visible_from_outside(points, skin).sum())
            for pose, points in (("cerrada", closed[name]), ("abierta", opened[name]))
        }
        status = "OK " if not any(seen.values()) else "MAL"
        if status == "MAL":
            failures += 1
        print(
            f"  {status} {name:20} vértices a la vista: "
            f"cerrada {seen['cerrada']:5}  abierta {seen['abierta']:5}"
        )

    if args.preview:
        write_preview(chambers, closed, opened, args.preview)
        print(f"\n  vistas en {args.preview}")

    if failures:
        print(f"\n{failures} problema(s). No se escribe nada.")
        return 1
    if args.validate_only:
        print("\nValidación en verde. No se escribe nada (--validate-only).")
        return 0

    # ------------------------------------------------------------ escritura --
    scene = trimesh.Scene(base_frame="Heart")
    order: list[tuple[str, trimesh.Trimesh]] = [
        *((name, chambers[name]) for name, *_ in STRUCTURES),
        (CARRIED_OVER, existing[CARRIED_OVER]),
        *((name, leaflet_meshes[name]) for name in closed),
    ]
    deltas: dict[str, list[dict[str, np.ndarray]]] = {}
    for name, mesh in order:
        mesh = mesh.copy()
        if name in closed:
            # La pose base del `.glb` es la válvula CERRADA, y ya no es la de la
            # fuente: la fuente modela los velos entreabiertos y por ahí se veía
            # a través del orificio. El cliente sigue escribiendo 0 para cerrada
            # y 1 para abierta, así que el contrato con `ValveAnimator` no se
            # mueve ni un ápice.
            mesh.vertices = closed[name]
        # Tocar las normales antes de exportar no es un efecto secundario
        # accidental: el exportador de trimesh solo escribe el atributo NORMAL
        # de las mallas que ya lo tienen calculado, y sin él el visor ilumina
        # el corazón entero de negro. Se comprueba al final releyendo el
        # fichero.
        _ = mesh.vertex_normals
        # El origen de cada nodo en su propio centro geométrico, como en el
        # script hermano: es lo que hace que escalar una cavidad la contraiga
        # hacia dentro. Las valvas no se escalan, pero el criterio se mantiene
        # para que el modelo tenga una sola convención.
        local = np.asarray(mesh.bounding_box.centroid, dtype=float)
        mesh.apply_translation(-local)
        transform = np.eye(4)
        transform[:3, 3] = local
        scene.add_geometry(mesh, node_name=name, geom_name=name, transform=transform)
        if name in opened:
            base_normals = np.asarray(mesh.vertex_normals)

            def normals_of(vertices: np.ndarray) -> np.ndarray:
                return np.asarray(
                    trimesh.Trimesh(
                        vertices=vertices - local, faces=mesh.faces, process=False
                    ).vertex_normals
                )

            middle = 0.5 * (closed[name] + opened[name]) + bulged[name]
            deltas[name] = [
                {
                    "POSITION": (opened[name] - closed[name]).astype("<f4"),
                    "NORMAL": (normals_of(opened[name]) - base_normals).astype("<f4"),
                },
                {
                    # La comba se mide contra el punto medio de la recta, que es
                    # justo lo que la GPU daría a media apertura sin ella.
                    "POSITION": bulged[name].astype("<f4"),
                    "NORMAL": (
                        normals_of(middle)
                        - 0.5 * (base_normals + normals_of(opened[name]))
                    ).astype("<f4"),
                },
            ]

    MODEL.write_bytes(
        add_morph_targets(scene.export(file_type="glb", include_normals=True), deltas)
    )
    print(f"\nEscrito {MODEL.relative_to(REPO_ROOT)}: {MODEL.stat().st_size / 1e6:.1f} MB")

    # Releer el fichero escrito y comprobar el contrato: los nombres de nodo y
    # que cada valva lleve de verdad su pose abierta. Que el exportador y el
    # parche hayan hecho lo que se les pidió no es algo que convenga dar por
    # supuesto — el fallo aparecería en el navegador y no aquí.
    document = read_gltf_document(MODEL)
    written = {node.get("name", "") for node in document["nodes"]}
    expected = {name for name, _ in order}
    if missing := expected - written:
        print(f"MAL: el GLB no expone estos nodos: {sorted(missing)}")
        return 1
    without_target = [
        mesh.get("name")
        for mesh in document["meshes"]
        if mesh.get("name") in closed
        and not all(
            len(p.get("targets", [])) == 2
            and all({"POSITION", "NORMAL"} <= set(t) for t in p["targets"])
            for p in mesh["primitives"]
        )
    ]
    if without_target:
        print(f"MAL: estas valvas salieron sin pose abierta: {sorted(without_target)}")
        return 1
    # Sin el atributo NORMAL el visor no tiene con qué iluminar y el corazón
    # sale negro. Pasó: trimesh solo lo escribe cuando la malla lo trae
    # calculado, y el fallo no se ve en ninguna proyección de puntos.
    without_normals = [
        mesh.get("name")
        for mesh in document["meshes"]
        if not all("NORMAL" in p["attributes"] for p in mesh["primitives"])
    ]
    if without_normals:
        print(f"MAL: estas mallas salieron sin normales: {sorted(without_normals)}")
        return 1
    print(
        f"Contrato verificado: {len(expected)} nodos con normales, "
        f"{len(closed)} de ellos con su pose abierta."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
