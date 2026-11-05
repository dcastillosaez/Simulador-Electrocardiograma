"""Genera los trayectos del sistema de conducción sobre `heart.glb`.

El corazón del simulador no trae sistema de conducción: BodyParts3D no lo
modela, y el proyecto ya decidió no inventar geometría anatómica a mano. Este
script lo **calcula** sobre las superficies que sí existen, igual que
`docs/fase-d/add-heart-valves.py` calcula las poses de las valvas:

- El endocardio ya existe: las cavidades de BodyParts3D son moldes de la sangre
  que contienen, y su superficie es esa capa. Purkinje y las ramas se apoyan en
  ella, un milímetro por fuera del molde, que es donde está el subendocardio.
- Las aurículas traen su pared (una cáscara de unos 2 mm). Las vías auriculares
  y los dos nodos se colocan dentro de esa pared, a 1 mm del molde.
- La región septal sale de donde los dos moldes ventriculares están más
  próximos. No se añade tabique: el haz de His cruza por ese hueco.
- Los recorridos sobre una superficie son geodésicas (Dijkstra sobre la malla
  subdividida), no líneas rectas, porque una recta atravesaría la cavidad.
- La red de Purkinje es un árbol de caminos mínimos desde las ramas hasta
  puntos elegidos con semilla fija y un tope de segmentos: el resultado es
  reproducible y se versiona.

**Qué es esquema y qué no.** Los puntos de referencia —unión de la cava superior
con la aurícula, anillo tricuspídeo, región septal, músculos papilares— salen de
la geometría. El trazado de las vías auriculares y de Purkinje es un esquema
didáctico: no reconstruye fibras reales, y la interfaz lo dice.

**Deformación.** Cada estructura se asigna a la cámara que la contiene y en el
cliente cuelga de un grupo con el pivote de esa cámara y su misma fila de
`DEFORMATION`. Los pivotes de los nodos del `.glb` difieren (31 mm entre los dos
ventrículos) y, con el mismo factor, dos pivotes distintos producen
desplazamientos distintos: un único grupo ventricular se habría separado de uno
de los dos moldes en cada latido. Las uniones entre cámaras —nodo AV con His,
His con la rama derecha— sí se separan un poco; aquí se miden en la excursión
máxima y el cliente las fija en un test.

**Validación.** Se valida contra dos pieles y en siete puntos del ciclo,
deformando mallas y trayectos con la misma cuenta que hace `applyExcursion` en
la GPU, y se comprueba la curva que dibuja el cliente (Catmull-Rom centrípeta),
no solo los puntos exportados:

- Piel del órgano con miocardio: ningún punto de ningún trayecto se ve desde
  fuera (rayos en 42 direcciones), y ninguno queda a menos de su radio de tubo
  de una superficie, de modo que el tubo entero queda del mismo lado.
- Piel por defecto, sin miocardio: Purkinje queda a una distancia acotada del
  endocardio —el molde de su ventrículo— y nunca dentro de él; las estructuras
  auriculares siguen escondidas en la pared.

Uso:

    uv run --python 3.12 --with trimesh --with numpy --with scipy \\
        --with networkx --with rtree --with embreex \\
        python docs/fase-h/build-conduction-paths.py [--check]

Con `--check` no escribe nada: regenera y compara byte a byte con el fichero
versionado. Es la prueba de que la misma semilla da exactamente los mismos
datos.

Fuente del modelo: BodyParts3D, Copyright(c) The Database Center for Life
Science licensed by CC Attribution-Share Alike 2.1 Japan.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL = REPO_ROOT / "apps" / "web" / "public" / "models" / "heart.glb"
OUTPUT = (
    REPO_ROOT
    / "apps"
    / "web"
    / "src"
    / "ui"
    / "Cardiac3D"
    / "ConductionSystem"
    / "conduction-paths.json"
)

FORMAT_VERSION = 1
SEED = 20261105
"""Semilla de la red de Purkinje. Cambiarla cambia la red: es un dato más del
fichero y viaja dentro de él."""

MM_PER_UNIT = 222.4
"""El mismo factor que `heart-scale.ts`: el modelo está normalizado y esto es lo
que mide en milímetros una unidad de escena."""

# --------------------------------------------------------------- geometría ----

SUBDIVIDE_MM = 1.5
"""Arista máxima de la malla sobre la que se trazan las geodésicas. Los moldes
ventriculares traen aristas de unos 6 mm, demasiado para un camino que tiene
que pegarse a la superficie."""

SAMPLE_MM = 1.0
"""Separación de los puntos exportados. El cliente pasa una Catmull-Rom por
ellos; a esta distancia la curva y la poligonal no se separan ni una décima."""

ATRIAL_DEPTH_MM = 1.0
"""Profundidad de las vías auriculares dentro de la pared, medida desde el molde
de sangre. La pared mide 1,9 mm en la aurícula izquierda y 2,1 en la derecha
(`docs/fase-d/miocardio-y-fuente.md`)."""

VENTRICULAR_OFFSET_MM = 1.2
"""Distancia de ramas y Purkinje al molde ventricular: subendocardio."""

RADIUS_MM = {
    "sa_node": 0.6,
    "atrial_pathways": 0.35,
    "av_node": 0.6,
    "his_bundle": 0.6,
    "left_bundle_branch": 0.45,
    "right_bundle_branch": 0.45,
    "purkinje": 0.25,
}
"""Radio del tubo de cada estructura. No es anatomía —un nodo SA mide más que
esto— sino lo que cabe en la pared sin asomar, que es lo que se valida."""

SA_NODE_LENGTH_MM = 8.0
AV_NODE_LENGTH_MM = 5.0

PURKINJE_TARGETS = {"LeftVentricle": 55, "RightVentricle": 35}
"""Puntos de destino de la red de Purkinje en cada ventrículo."""

PURKINJE_MAX_SEGMENTS = 3000
"""Tope de segmentos de toda la red. Si el árbol lo superase, el script falla en
vez de recortar en silencio."""

BASAL_EXCLUSION_MM = 8.0
"""Purkinje no llega al anillo de las válvulas: los puntos de destino se toman a
más de esta distancia de los anillos."""

PURKINJE_ENDOCARDIUM_MAX_MM = 2.0
"""Distancia máxima admitida entre Purkinje y el endocardio en cualquier punto
del ciclo. La cota mínima es el radio del tubo: por debajo, el tubo tocaría el
molde."""

# ---------------------------------------------------------- deformación ----

DEFORMATION = {
    # Copia de `HeartAnimator.ts`. Se repite y no se lee porque aquel fichero es
    # TypeScript; si divergen, la validación deja de validar lo que se ve, y por
    # eso el test del cliente comprueba que las filas de la conducción son las
    # de su cámara.
    "LeftVentricle": ("ventricles", -0.04, 0.04),
    "RightVentricle": ("ventricles", -0.04, 0.04),
    "LeftAtrium": ("atria", -0.02, 0.02),
    "RightAtrium": ("atria", -0.02, 0.02),
    "Aorta": ("ventricles", 0.004, 0.008),
    "PulmonaryArtery": ("ventricles", 0.004, 0.008),
    "PulmonaryVeins": ("atria", 0.002, 0.004),
    "SuperiorVenaCava": ("atria", 0.002, 0.004),
    "InferiorVenaCava": ("atria", 0.002, 0.004),
    "Myocardium": ("ventricles", -0.03, 0.03),
}

SKIN_ORGAN = (
    "Myocardium",
    "Aorta",
    "PulmonaryArtery",
    "LeftAtrium",
    "RightAtrium",
    "PulmonaryVeins",
    "SuperiorVenaCava",
    "InferiorVenaCava",
)
SKIN_DEFAULT_VIEW = (
    "LeftVentricle",
    "RightVentricle",
    "Aorta",
    "PulmonaryArtery",
    "LeftAtrium",
    "RightAtrium",
    "PulmonaryVeins",
    "SuperiorVenaCava",
    "InferiorVenaCava",
)
"""Las mismas dos pieles que `add-heart-valves.py`: el órgano con su miocardio y
lo que se ve por defecto sin él."""

ESCAPE_DIRECTIONS = 42


def cycle_points() -> list[tuple[float, float]]:
    """Siete puntos de un ciclo normal, como pareja (aurículas, ventrículos).

    Se calculan con la misma curva que el cliente (`contraction-curve.ts`):
    coseno alzado por tramos con el pico al 45 % de la ventana. El latido es el
    del catálogo a 70 lpm: sístole auricular de 110 ms desde el inicio de la P,
    QRS 160 ms después y sístole ventricular del 40 % del RR. Los siete
    instantes incluyen el pico auricular con el ventrículo en reposo y el pico
    ventricular con la aurícula en reposo, que son los dos extremos en que más
    se separan los grupos.
    """
    rr = 60.0 / 70.0
    atrial = (0.0, 0.11)
    ventricular = (0.16, 0.16 + 0.4 * rr)

    def excursion(window: tuple[float, float], t: float) -> float:
        start, end = window
        if t <= start or t >= end:
            return 0.0
        peak = start + 0.45 * (end - start)
        if t <= peak:
            return 0.5 * (1 - np.cos(np.pi * (t - start) / (peak - start)))
        return 0.5 * (1 + np.cos(np.pi * (t - peak) / (end - peak)))

    instants = [
        atrial[0] + fraction * (atrial[1] - atrial[0]) for fraction in (0.2, 0.45, 0.8)
    ] + [
        ventricular[0] + fraction * (ventricular[1] - ventricular[0])
        for fraction in (0.15, 0.45, 0.7, 0.9)
    ]
    return [
        (round(excursion(atrial, t), 4), round(excursion(ventricular, t), 4))
        for t in instants
    ]


# --------------------------------------------------------------- lectura ----


def read_pivots(path: Path) -> dict[str, np.ndarray]:
    """El origen de cada nodo del `.glb`, que es el pivote de su escala."""
    data = path.read_bytes()
    length = struct.unpack("<I", data[12:16])[0]
    document = json.loads(data[20 : 20 + length])
    pivots: dict[str, np.ndarray] = {}
    for node in document["nodes"]:
        if "matrix" in node:
            pivots[node["name"]] = np.array(node["matrix"][12:15], dtype=float)
        else:
            pivots[node["name"]] = np.array(node.get("translation", [0, 0, 0]), dtype=float)
    return pivots


def read_nodes(path: Path) -> dict[str, trimesh.Trimesh]:
    scene = trimesh.load(path)
    nodes: dict[str, trimesh.Trimesh] = {}
    for node in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        nodes[node] = mesh
    return nodes


def cavity(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """El molde de sangre de una cámara: su componente de más volumen.

    En los ventrículos es la cavidad; los otros componentes son músculos
    papilares. En las aurículas el componente con más vértices es la pared,
    una cáscara de dos superficies que encierra poco volumen, y la cavidad es
    el de más volumen."""
    parts = [p for p in mesh.split(only_watertight=False) if len(p.vertices) > 100]
    return max(parts, key=lambda p: abs(p.volume))


def papillary_muscles(mesh: trimesh.Trimesh) -> list[trimesh.Trimesh]:
    parts = [p for p in mesh.split(only_watertight=False) if len(p.vertices) > 100]
    main = max(parts, key=lambda p: abs(p.volume))
    return [p for p in parts if p is not main]


# ------------------------------------------------------------- superficie ----


class Surface:
    """Una superficie subdividida, con su grafo de aristas para geodésicas."""

    def __init__(self, mesh: trimesh.Trimesh, name: str) -> None:
        vertices, faces = trimesh.remesh.subdivide_to_size(
            mesh.vertices, mesh.faces, max_edge=SUBDIVIDE_MM / MM_PER_UNIT
        )
        self.name = name
        self.mesh = trimesh.Trimesh(vertices, faces, process=True)
        self.vertices = np.asarray(self.mesh.vertices)
        self.normals = np.asarray(self.mesh.vertex_normals)
        edges = np.asarray(self.mesh.edges_unique)
        lengths = np.linalg.norm(
            self.vertices[edges[:, 0]] - self.vertices[edges[:, 1]], axis=1
        )
        n = len(self.vertices)
        self.graph = coo_matrix(
            (
                np.concatenate([lengths, lengths]),
                (
                    np.concatenate([edges[:, 0], edges[:, 1]]),
                    np.concatenate([edges[:, 1], edges[:, 0]]),
                ),
            ),
            shape=(n, n),
        ).tocsr()
        self.tree = cKDTree(self.vertices)

    def nearest(self, point: np.ndarray) -> int:
        return int(self.tree.query(point)[1])

    def geodesic(self, start: int, end: int) -> list[int]:
        _, predecessors = dijkstra(
            self.graph, directed=False, indices=start, return_predecessors=True
        )
        path = [end]
        while path[-1] != start:
            previous = int(predecessors[path[-1]])
            if previous < 0:
                raise RuntimeError(f"{self.name}: no hay camino entre {start} y {end}")
            path.append(previous)
        return path[::-1]

    def offset(self, indices: list[int], distance_mm: float) -> np.ndarray:
        """Los vértices del camino desplazados por su normal hacia fuera del
        molde. Los moldes salen de BodyParts3D con las normales hacia fuera
        (volumen positivo), que es lo que da el signo."""
        idx = np.asarray(indices)
        return self.vertices[idx] + self.normals[idx] * (distance_mm / MM_PER_UNIT)


def resample(points: np.ndarray, spacing_mm: float) -> np.ndarray:
    """Remuestrea una poligonal a paso constante, conservando los extremos."""
    if len(points) < 2:
        return points
    steps = np.linalg.norm(np.diff(points, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(steps)])
    total = arc[-1]
    count = max(2, int(np.ceil(total * MM_PER_UNIT / spacing_mm)) + 1)
    targets = np.linspace(0.0, total, count)
    return np.column_stack([np.interp(targets, arc, points[:, k]) for k in range(3)])


def smooth(points: np.ndarray, passes: int = 3) -> np.ndarray:
    """Suavizado laplaciano que conserva los extremos: quita el zigzag de una
    geodésica sobre triángulos sin despegarla de la superficie más de lo que
    luego se valida."""
    out = points.copy()
    for _ in range(passes):
        out[1:-1] = 0.25 * out[:-2] + 0.5 * out[1:-1] + 0.25 * out[2:]
    return out


def arc_length(points: np.ndarray) -> np.ndarray:
    steps = np.linalg.norm(np.diff(points, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(steps)])


# --------------------------------------------------------------- trayecto ----


class Path3D:
    """Un trayecto: puntos, la cámara de la que cuelga y la distancia recorrida
    por el impulso desde el inicio de su estructura (en unidades de escena)."""

    def __init__(
        self, structure: str, chamber: str, points: np.ndarray, start_distance: float
    ) -> None:
        self.structure = structure
        self.chamber = chamber
        self.points = points
        self.distance = start_distance + arc_length(points)


def straight(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    count = max(2, int(np.ceil(np.linalg.norm(b - a) * MM_PER_UNIT / SAMPLE_MM)) + 1)
    return np.linspace(a, b, count)


def truncate(points: np.ndarray, length_mm: float) -> np.ndarray:
    arc = arc_length(points) * MM_PER_UNIT
    keep = points[arc <= length_mm]
    return keep if len(keep) >= 2 else points[:2]


def surface_path(
    surface: Surface, start: int, end: int, distance_mm: float
) -> np.ndarray:
    raw = surface.offset(surface.geodesic(start, end), distance_mm)
    return smooth(resample(raw, SAMPLE_MM))


def contact_points(a: np.ndarray, b: np.ndarray, within_mm: float) -> np.ndarray:
    """Puntos de `a` a menos de `within_mm` de `b`, contados desde la distancia
    mínima entre las dos: entre dos moldes de sangre siempre queda la pared, y
    su grosor no es el mismo en todas las uniones."""
    distance, _ = cKDTree(b).query(a)
    mm = distance * MM_PER_UNIT
    return a[mm <= mm.min() + within_mm]


def purkinje_tree(
    surface: Surface,
    roots: list[np.ndarray],
    root_distance: list[float],
    excluded: np.ndarray,
    targets: int,
    rng: np.random.Generator,
    chamber: str,
) -> list[Path3D]:
    """Árbol de caminos mínimos desde las ramas hasta `targets` puntos.

    Un súper-nodo une todas las raíces con un coste igual a la distancia que el
    impulso ya ha recorrido hasta ellas: así cada punto de destino cuelga de la
    rama que antes lo alcanzaría, que es la idea de un árbol de activación y no
    un adorno."""
    n = len(surface.vertices)
    root_ids = [surface.nearest(p) for p in roots]
    # Súper-nodo n, aristas dirigidas hacia cada raíz.
    rows = np.full(len(root_ids), n)
    cols = np.asarray(root_ids)
    weights = np.asarray(root_distance) + 1e-9
    base = surface.graph.tocoo()
    graph = coo_matrix(
        (
            np.concatenate([base.data, weights]),
            (np.concatenate([base.row, rows]), np.concatenate([base.col, cols])),
        ),
        shape=(n + 1, n + 1),
    ).tocsr()
    dist, predecessors = dijkstra(graph, directed=True, indices=n, return_predecessors=True)

    candidates = np.flatnonzero(~excluded & np.isfinite(dist[:n]))
    chosen = np.sort(rng.choice(candidates, size=min(targets, len(candidates)), replace=False))

    # Unión de los caminos: cada vértice apunta a su padre en el árbol.
    parent: dict[int, int] = {}
    for target in chosen:
        node = int(target)
        while node != n and node not in parent:
            previous = int(predecessors[node])
            parent[node] = previous
            node = previous

    children: dict[int, list[int]] = {}
    for child, father in parent.items():
        children.setdefault(father, []).append(child)
    for value in children.values():
        value.sort()

    # Cadenas entre bifurcaciones: cada una será un tubo.
    chains: list[list[int]] = []
    stack = [(n, child) for child in children.get(n, [])]
    while stack:
        start, node = stack.pop()
        chain = [start, node] if start != n else [node]
        while len(children.get(node, [])) == 1:
            node = children[node][0]
            chain.append(node)
        chains.append(chain)
        for child in children.get(node, []):
            stack.append((node, child))

    paths: list[Path3D] = []
    for chain in sorted(chains, key=lambda c: (c[0], c[-1])):
        if len(chain) < 2:
            continue
        idx = np.asarray(chain)
        points = surface.offset(chain, VENTRICULAR_OFFSET_MM)
        path = Path3D("purkinje", chamber, points, 0.0)
        path.distance = dist[idx]
        paths.append(path)
    return paths


RELAX_MARGIN_MM = 0.25
"""Holgura que se pide por encima del radio del tubo al separar un trayecto de
las superficies. Absorbe lo que se mueven las mallas respecto al grupo de la
conducción a lo largo del ciclo."""


def relax(points: np.ndarray, radius_mm: float, surfaces: trimesh.Trimesh) -> np.ndarray:
    """Aparta de las superficies los puntos que quedan demasiado cerca.

    Una geodésica desplazada un milímetro sobre un molde de aristas de 6 mm no
    queda a un milímetro de todo: en el hueco septal, junto a la aorta o donde
    el miocardio sintetizado es más fino, pasa rozando. Empujar en la dirección
    contraria a la superficie más próxima no basta en un hueco estrecho —el
    empujón lo lleva contra la de enfrente—, así que cada punto corto prueba
    desplazamientos en 26 direcciones y se queda con el que más le despeja. Es
    una función del punto y nada más: dos trayectos que comparten un extremo lo
    siguen compartiendo después."""
    target = (radius_mm + RELAX_MARGIN_MM) / MM_PER_UNIT
    offsets = np.array(
        [
            (x, y, z)
            for x in (-1, 0, 1)
            for y in (-1, 0, 1)
            for z in (-1, 0, 1)
            if (x, y, z) != (0, 0, 0)
        ],
        dtype=float,
    )
    offsets /= np.linalg.norm(offsets, axis=1, keepdims=True)
    out = points.copy()
    for _ in range(20):
        _, distance, _ = trimesh.proximity.closest_point(surfaces, out)
        short = np.flatnonzero(distance < target)
        if len(short) == 0:
            break
        step = 0.25 / MM_PER_UNIT
        candidates = (out[short, None, :] + offsets[None] * step).reshape(-1, 3)
        _, reach, _ = trimesh.proximity.closest_point(surfaces, candidates)
        reach = reach.reshape(len(short), len(offsets))
        best = np.argmax(reach, axis=1)
        improves = reach[np.arange(len(short)), best] > distance[short]
        moved = short[improves]
        out[moved] = out[moved] + offsets[best[improves]] * step
    return out


def relax_curve(path: "Path3D", surfaces: trimesh.Trimesh) -> None:
    """Aparta un trayecto de las superficies, comprobando la curva y no solo
    sus puntos.

    Entre dos puntos separados un milímetro puede colarse una arista viva del
    miocardio sintetizado: los puntos quedan lejos y la curva que los une la
    roza. Donde pasa eso se inserta el punto medio de la Catmull-Rom y se
    vuelve a apartar, hasta que la curva entera queda limpia. La distancia
    recorrida del punto insertado es la media de sus vecinos."""
    radius = RADIUS_MM[path.structure]
    for _ in range(8):
        path.points = relax(path.points, radius, surfaces)
        mids = catmull_rom_midpoints(path.points)
        if len(mids) == 0:
            return
        _, distance, _ = trimesh.proximity.closest_point(surfaces, mids)
        bad = np.flatnonzero(distance * MM_PER_UNIT < radius + 0.5 * RELAX_MARGIN_MM)
        if len(bad) == 0:
            return
        mid_distance = 0.5 * (path.distance[bad] + path.distance[bad + 1])
        path.points = np.insert(path.points, bad + 1, mids[bad], axis=0)
        path.distance = np.insert(path.distance, bad + 1, mid_distance)


# -------------------------------------------------------------- validación ----


def deform(points: np.ndarray, chamber: str, pivots, pose: tuple[float, float]) -> np.ndarray:
    """La misma cuenta que `applyExcursion`: escala respecto al pivote del nodo,
    longitudinal en Y y radial en X y Z, con el suelo de 0,5."""
    driver, longitudinal, radial = DEFORMATION[chamber]
    value = pose[0] if driver == "atria" else pose[1]
    scale = np.array(
        [
            max(0.5, 1 + radial * value),
            max(0.5, 1 + longitudinal * value),
            max(0.5, 1 + radial * value),
        ]
    )
    pivot = pivots[chamber]
    return pivot + (points - pivot) * scale


def deformed_skin(nodes, names, pivots, pose) -> trimesh.Trimesh:
    meshes = []
    for name in names:
        mesh = nodes[name].copy()
        mesh.vertices = deform(np.asarray(mesh.vertices), name, pivots, pose)
        meshes.append(mesh)
    return trimesh.util.concatenate(meshes)


def escape_directions(count: int) -> np.ndarray:
    i = np.arange(count) + 0.5
    polar = np.arccos(1.0 - 2.0 * i / count)
    azimuth = np.pi * (1.0 + 5.0**0.5) * i
    return np.column_stack(
        [np.cos(azimuth) * np.sin(polar), np.sin(azimuth) * np.sin(polar), np.cos(polar)]
    )


def visible_from_outside(points: np.ndarray, skin: trimesh.Trimesh) -> np.ndarray:
    directions = escape_directions(ESCAPE_DIRECTIONS)
    origins = np.repeat(points, len(directions), axis=0)
    rays = np.tile(directions, (len(points), 1))
    blocked = skin.ray.intersects_any(origins + rays * 1e-5, rays)
    return (~blocked.reshape(len(points), len(directions))).any(axis=1)


def catmull_rom_midpoints(points: np.ndarray) -> np.ndarray:
    """Puntos a mitad de cada tramo de la Catmull-Rom centrípeta que construye
    `CatmullRomCurve3` en el cliente (su tipo por defecto). Se valida la curva
    que se dibuja, no solo los puntos por los que pasa."""
    if len(points) < 2:
        return np.empty((0, 3))
    padded = np.vstack(
        [2 * points[0] - points[1], points, 2 * points[-1] - points[-2]]
    )
    out = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1], padded[i], padded[i + 1], padded[i + 2]
        dt0 = max(np.linalg.norm(p1 - p0) ** 0.5, 1e-4)
        dt1 = max(np.linalg.norm(p2 - p1) ** 0.5, 1e-4)
        dt2 = max(np.linalg.norm(p3 - p2) ** 0.5, 1e-4)
        if dt1 < 1e-4:
            dt1 = 1.0
        if dt0 < 1e-4:
            dt0 = dt1
        if dt2 < 1e-4:
            dt2 = dt1
        t1 = ((p1 - p0) / dt0 - (p2 - p0) / (dt0 + dt1) + (p2 - p1) / dt1) * dt1
        t2 = ((p2 - p1) / dt1 - (p3 - p1) / (dt1 + dt2) + (p3 - p2) / dt2) * dt1
        # Hermite cúbico en u = 0,5.
        out.append(0.5 * p1 + 0.125 * t1 + 0.5 * p2 - 0.125 * t2)
    return np.asarray(out)


def tube_surface(points: np.ndarray, radius_mm: float, sides: int = 6) -> np.ndarray:
    """Puntos de la superficie del tubo: un anillo de `sides` puntos alrededor
    de cada punto de la curva, en el plano normal a la tangente. Es la
    geometría que dibuja el cliente (`TubeGeometry` con seis lados), y es lo que
    tiene que quedar dentro del órgano, no solo el eje."""
    if len(points) < 2:
        return np.empty((0, 3))
    tangent = np.gradient(points, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-12)
    helper = np.where(
        np.abs(tangent[:, [0]]) < 0.9, np.array([[1.0, 0.0, 0.0]]), np.array([[0.0, 1.0, 0.0]])
    )
    u = np.cross(tangent, helper)
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    v = np.cross(tangent, u)
    r = radius_mm / MM_PER_UNIT
    rings = [
        points + r * (np.cos(a) * u + np.sin(a) * v)
        for a in np.linspace(0.0, 2.0 * np.pi, sides, endpoint=False)
    ]
    return np.vstack(rings)


def validate(paths: list[Path3D], nodes, pivots, casts) -> dict:
    """Comprueba las dos pieles en los siete puntos del ciclo. Devuelve las
    medidas; lanza si alguna condición falla."""
    failures: list[str] = []
    worst = {
        "organ_visible_points": 0,
        "purkinje_endocardium_mm": [np.inf, 0.0],
        "atrial_visible_default_view": 0,
    }

    samples = []
    for path in paths:
        dense = np.vstack([path.points, catmull_rom_midpoints(path.points)])
        samples.append((path, dense, tube_surface(path.points, RADIUS_MM[path.structure])))

    for pose in cycle_points():
        organ = deformed_skin(nodes, SKIN_ORGAN, pivots, pose)
        default = deformed_skin(nodes, SKIN_DEFAULT_VIEW, pivots, pose)
        posed_casts = {
            name: trimesh.Trimesh(
                deform(np.asarray(mesh.vertices), name, pivots, pose), mesh.faces
            )
            for name, mesh in casts.items()
        }
        by_chamber: dict[str, list[np.ndarray]] = {}
        radii: dict[str, list[np.ndarray]] = {}
        for path, dense, tube in samples:
            posed = deform(np.vstack([dense, tube]), path.chamber, pivots, pose)
            by_chamber.setdefault(path.structure, []).append(posed)

        for structure, chunks in by_chamber.items():
            points = np.vstack(chunks)
            visible = visible_from_outside(points, organ)
            if visible.any():
                failures.append(
                    f"{pose}: {structure} asoma fuera del órgano en {int(visible.sum())} puntos"
                )
            worst["organ_visible_points"] += int(visible.sum())
            worst["tube_points_checked"] = worst.get("tube_points_checked", 0) + len(points)
            if structure in ("sa_node", "atrial_pathways", "av_node"):
                # Informativo, no un fallo: el haz de Bachmann es
                # subepicárdico y cruza el surco interauricular por fuera de
                # las dos paredes. Con el miocardio apagado se ve, igual que
                # se ve Purkinje sobre el molde ventricular.
                shown = visible_from_outside(points, default)
                worst["atrial_visible_default_view"] = max(
                    worst["atrial_visible_default_view"], int(shown.sum())
                )

        for path, dense, _ in samples:
            if path.structure != "purkinje":
                continue
            posed = deform(dense, path.chamber, pivots, pose)
            _, distance, _ = trimesh.proximity.closest_point(posed_casts[path.chamber], posed)
            mm = distance * MM_PER_UNIT
            low, high = worst["purkinje_endocardium_mm"]
            worst["purkinje_endocardium_mm"] = [min(low, float(mm.min())), max(high, float(mm.max()))]
            if mm.min() < RADIUS_MM["purkinje"] or mm.max() > PURKINJE_ENDOCARDIUM_MAX_MM:
                failures.append(
                    f"{pose}: Purkinje a {mm.min():.2f}-{mm.max():.2f} mm del endocardio "
                    f"({path.chamber})"
                )
        print(f"  pose aurículas={pose[0]:.2f} ventrículos={pose[1]:.2f}: revisada")

    if failures:
        for failure in failures[:40]:
            print("  MAL:", failure)
        raise SystemExit(f"la validación falló en {len(failures)} comprobaciones")

    worst["purkinje_endocardium_mm"] = [round(v, 3) for v in worst["purkinje_endocardium_mm"]]
    return worst


def junction_gap_mm(point: np.ndarray, a: str, b: str, pivots) -> float:
    """Separación máxima entre dos grupos en una unión, en los siete puntos del
    ciclo y en los dos extremos sueltos (una cámara contraída del todo y la
    otra en reposo)."""
    poses = cycle_points() + [(1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
    gaps = [
        np.linalg.norm(deform(point[None], a, pivots, p) - deform(point[None], b, pivots, p))
        for p in poses
    ]
    return round(float(max(gaps)) * MM_PER_UNIT, 3)


# ------------------------------------------------------------------- main ----


def build(nodes, pivots) -> tuple[list[Path3D], dict, dict]:
    rng = np.random.default_rng(SEED)
    ra_cavity = cavity(nodes["RightAtrium"])
    la_cavity = cavity(nodes["LeftAtrium"])
    lv_cast = cavity(nodes["LeftVentricle"])
    rv_cast = cavity(nodes["RightVentricle"])
    ra = Surface(ra_cavity, "RightAtrium")
    la = Surface(la_cavity, "LeftAtrium")
    lv = Surface(lv_cast, "LeftVentricle")
    rv = Surface(rv_cast, "RightVentricle")

    paths: list[Path3D] = []
    landmarks: dict[str, list[float]] = {}

    # --- Nodo SA: unión anterolateral de la cava superior con la aurícula.
    svc_contact = contact_points(ra.vertices, np.asarray(nodes["SuperiorVenaCava"].vertices), 3.0)
    anterolateral = np.array([-1.0, 0.0, 1.0]) / np.sqrt(2.0)
    sa_point = svc_contact[np.argmax(svc_contact @ anterolateral)]
    sa = ra.nearest(sa_point)
    # Hacia abajo por la cresta terminal: hacia la desembocadura de la cava
    # inferior por la cara lateral.
    ivc_contact = contact_points(ra.vertices, np.asarray(nodes["InferiorVenaCava"].vertices), 3.0)
    crista_end = ra.nearest(ivc_contact[np.argmin(ivc_contact @ np.array([1.0, 0.0, 0.0]))])

    # --- Nodo AV: el punto de la aurícula derecha más próximo al ventrículo
    # izquierdo junto al anillo tricuspídeo. Es el tabique auriculoventricular,
    # el vértice del triángulo de Koch.
    tricuspid = contact_points(ra.vertices, rv.vertices, 3.0)
    near_ring = cKDTree(tricuspid).query(ra.vertices)[0] * MM_PER_UNIT <= 8.0
    candidates = np.flatnonzero(near_ring)
    lv_distance = cKDTree(lv.vertices).query(ra.vertices[candidates])[0]
    av = int(candidates[np.argmin(lv_distance)])

    # Vías internodales: anterior, media y posterior. Esquema didáctico.
    ra_centre = ra.vertices.mean(0)
    height = ra.vertices[:, 1]
    mid = np.abs(height - np.median(height)) * MM_PER_UNIT < 6.0
    anterior_waypoint = int(np.flatnonzero(mid)[np.argmax(ra.vertices[mid, 2])])
    posterior_waypoint = crista_end

    sa_path = ra.geodesic(sa, crista_end)
    sa_points = truncate(
        smooth(resample(ra.offset(sa_path, ATRIAL_DEPTH_MM), SAMPLE_MM)),
        SA_NODE_LENGTH_MM,
    )
    paths.append(Path3D("sa_node", "RightAtrium", sa_points, 0.0))

    def atrial_route(waypoints: list[int]) -> np.ndarray:
        chunks = []
        for a, b in zip(waypoints[:-1], waypoints[1:]):
            chunks.extend(ra.geodesic(a, b) if not chunks else ra.geodesic(a, b)[1:])
        return smooth(resample(ra.offset(chunks, ATRIAL_DEPTH_MM), SAMPLE_MM))

    for waypoints in ([sa, anterior_waypoint, av], [sa, av], [sa, posterior_waypoint, av]):
        paths.append(Path3D("atrial_pathways", "RightAtrium", atrial_route(waypoints), 0.0))

    # Haz de Bachmann: de la aurícula derecha a la izquierda por arriba y por
    # delante, cruzando por donde las dos aurículas se tocan.
    ra_la = contact_points(ra.vertices, la.vertices, 4.0)
    superior_anterior = np.array([0.0, 1.0, 1.0]) / np.sqrt(2.0)
    crossing = ra.nearest(ra_la[np.argmax(ra_la @ superior_anterior)])
    bachmann_ra = atrial_route([sa, crossing])
    la_entry = la.nearest(ra.vertices[crossing])
    appendage = int(np.argmax(la.vertices @ np.array([1.0, 0.3, 1.0])))
    bachmann_la = smooth(
        resample(la.offset(la.geodesic(la_entry, appendage), ATRIAL_DEPTH_MM), SAMPLE_MM)
    )
    start = Path3D("atrial_pathways", "RightAtrium", bachmann_ra, 0.0)
    paths.append(start)
    bridge = straight(bachmann_ra[-1], bachmann_la[0])
    paths.append(
        Path3D("atrial_pathways", "LeftAtrium", bridge, float(start.distance[-1]))
    )
    paths.append(
        Path3D(
            "atrial_pathways",
            "LeftAtrium",
            bachmann_la,
            float(start.distance[-1]) + float(arc_length(bridge)[-1]),
        )
    )

    # Nodo AV: un tramo corto hacia el anillo, en dirección al His.
    septal_ring = ra.nearest(tricuspid[np.argmin(cKDTree(lv.vertices).query(tricuspid)[0])])
    av_points = truncate(
        smooth(resample(ra.offset(ra.geodesic(av, septal_ring), ATRIAL_DEPTH_MM), SAMPLE_MM)),
        AV_NODE_LENGTH_MM,
    )
    paths.append(Path3D("av_node", "RightAtrium", av_points, 0.0))

    # --- Región septal: donde los dos moldes ventriculares están más cerca.
    rv_tree = cKDTree(rv.vertices)
    gap, partner = rv_tree.query(lv.vertices)
    septal = gap * MM_PER_UNIT <= 6.0
    septal_mid = 0.5 * (lv.vertices[septal] + rv.vertices[partner[septal]])
    # His: del final del nodo AV al punto del hueco septal más próximo.
    his_end = septal_mid[np.argmin(np.linalg.norm(septal_mid - av_points[-1], axis=1))]
    his_points = straight(av_points[-1], his_end)
    paths.append(Path3D("his_bundle", "LeftVentricle", his_points, 0.0))
    landmarks["av_his_junction"] = av_points[-1].round(6).tolist()

    # --- Ramas. La izquierda baja por la cara izquierda del tabique y se
    # abre hacia los dos papilares; la derecha baja por la derecha hacia el
    # papilar anterior. Los papilares son los componentes sueltos de cada
    # molde, así que también salen de la geometría.
    def papillary_base(mesh: trimesh.Trimesh, surface: Surface) -> list[np.ndarray]:
        bases = []
        for muscle in papillary_muscles(mesh):
            vertices = np.asarray(muscle.vertices)
            distance = surface.tree.query(vertices)[0]
            bases.append(vertices[np.argmin(distance)])
        return bases

    lv_papillaries = papillary_base(nodes["LeftVentricle"], lv)
    rv_papillaries = papillary_base(nodes["RightVentricle"], rv)
    # Anterolateral: el de más Z. Posteromedial: el de menos.
    lv_papillaries.sort(key=lambda p: p[2])
    rv_anterior = max(rv_papillaries, key=lambda p: p[2])

    lv_entry = lv.nearest(his_end)
    septal_centre = lv.nearest(lv.vertices[septal].mean(0))
    lbb_paths = []
    distance_offset = float(arc_length(his_points)[-1])
    for target in (
        lv.nearest(lv_papillaries[-1]),
        septal_centre,
        lv.nearest(lv_papillaries[0]),
    ):
        points = surface_path(lv, lv_entry, target, VENTRICULAR_OFFSET_MM)
        points = np.vstack([his_end, points])
        path = Path3D("left_bundle_branch", "LeftVentricle", points, 0.0)
        lbb_paths.append(path)
        paths.append(path)

    rv_entry = rv.nearest(his_end)
    rbb_points = np.vstack(
        [his_end, surface_path(rv, rv_entry, rv.nearest(rv_anterior), VENTRICULAR_OFFSET_MM)]
    )
    rbb = Path3D("right_bundle_branch", "RightVentricle", rbb_points, 0.0)
    paths.append(rbb)
    landmarks["his_right_bundle_junction"] = his_end.round(6).tolist()

    # --- Purkinje: árbol desde los puntos de las ramas.
    def rings(surface: Surface, others: list[str]) -> np.ndarray:
        excluded = np.zeros(len(surface.vertices), dtype=bool)
        for other in others:
            near = cKDTree(np.asarray(nodes[other].vertices)).query(surface.vertices)[0]
            excluded |= near * MM_PER_UNIT <= BASAL_EXCLUSION_MM
        return excluded

    lv_roots, lv_root_d = [], []
    for path in lbb_paths:
        lv_roots.extend(path.points[1:])
        lv_root_d.extend(path.distance[1:])
    paths.extend(
        purkinje_tree(
            lv, lv_roots, lv_root_d,
            rings(lv, ["LeftAtrium", "Aorta"]),
            PURKINJE_TARGETS["LeftVentricle"], rng, "LeftVentricle",
        )
    )
    paths.extend(
        purkinje_tree(
            rv, list(rbb.points[1:]), list(rbb.distance[1:]),
            rings(rv, ["RightAtrium", "PulmonaryArtery"]),
            PURKINJE_TARGETS["RightVentricle"], rng, "RightVentricle",
        )
    )

    # Las distancias del His se cuentan desde su origen; las de las ramas y
    # Purkinje, desde el final del His. Así el pulso de un tramo sale de donde
    # terminó el anterior.
    _ = distance_offset
    casts = {"LeftVentricle": lv_cast, "RightVentricle": rv_cast}

    # Solo los trayectos ventriculares se apartan, y solo de los moldes: lo
    # que importa es que el tubo no se meta en la sangre. De la piel exterior
    # ya se ocupa la validación, que mira la superficie del tubo entera.
    surfaces = trimesh.util.concatenate([lv_cast, rv_cast])
    for path in paths:
        if path.chamber in ("LeftVentricle", "RightVentricle"):
            relax_curve(path, surfaces)
    his = next(p for p in paths if p.structure == "his_bundle")
    right = next(p for p in paths if p.structure == "right_bundle_branch")
    landmarks["av_his_junction"] = his.points[0].round(6).tolist()
    landmarks["his_right_bundle_junction"] = right.points[0].round(6).tolist()
    return paths, landmarks, casts


DRIVE_GROUPS = {
    "sa_node": "sa_node",
    "atrial_pathways": "atrial_pathways",
    "av_node": "av_node",
    "his_bundle": "his_bundle",
    "left_bundle_branch": "ventricular_conduction",
    "right_bundle_branch": "ventricular_conduction",
    "purkinje": "ventricular_conduction",
}
"""Qué estructuras comparten normalización de la posición del pulso. Ramas y
Purkinje se recorren como un único trayecto: el reparto del tiempo entre ellas no
tiene fuente (ver `activation-timing.yaml`), así que se les da la misma ventana
y una sola escala de distancia, y el frente avanza continuo de una a otra."""


def serialise(paths: list[Path3D], landmarks, pivots, validation) -> str:
    maxima: dict[str, float] = {}
    for path in paths:
        group = DRIVE_GROUPS[path.structure]
        maxima[group] = max(maxima.get(group, 0.0), float(path.distance.max()))

    structures: dict[str, dict] = {}
    segments = 0
    for path in paths:
        group = DRIVE_GROUPS[path.structure]
        entry = structures.setdefault(
            path.structure,
            {"radius_mm": RADIUS_MM[path.structure], "paths": []},
        )
        progress = path.distance / maxima[group] if maxima[group] > 0 else path.distance
        entry["paths"].append(
            {
                "chamber": path.chamber,
                "points": [[round(float(c), 5) for c in p] for p in path.points],
                "progress": [round(float(v), 4) for v in progress],
            }
        )
        segments += len(path.points) - 1

    purkinje_segments = sum(len(p["points"]) - 1 for p in structures["purkinje"]["paths"])
    if purkinje_segments > PURKINJE_MAX_SEGMENTS:
        raise SystemExit(
            f"Purkinje tiene {purkinje_segments} segmentos, por encima del tope "
            f"{PURKINJE_MAX_SEGMENTS}"
        )

    document = {
        "format_version": FORMAT_VERSION,
        "generator": "docs/fase-h/build-conduction-paths.py",
        "seed": SEED,
        "purkinje_max_segments": PURKINJE_MAX_SEGMENTS,
        "units": "escena (1 unidad = 222,4 mm)",
        "didactic": ["atrial_pathways", "purkinje"],
        "pivots": {
            name: [round(float(c), 9) for c in pivots[name]]
            for name in ("LeftAtrium", "RightAtrium", "LeftVentricle", "RightVentricle")
        },
        "landmarks": landmarks,
        "junction_gap_mm": {
            "av_his": junction_gap_mm(
                np.asarray(landmarks["av_his_junction"]), "RightAtrium", "LeftVentricle", pivots
            ),
            "his_right_bundle": junction_gap_mm(
                np.asarray(landmarks["his_right_bundle_junction"]),
                "LeftVentricle",
                "RightVentricle",
                pivots,
            ),
        },
        "validation": validation,
        "cycle_points": [list(p) for p in cycle_points()],
        "segments": segments,
        "structures": structures,
    }
    return json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--skip-validation", action="store_true")
    args = parser.parse_args()

    nodes = read_nodes(MODEL)
    pivots = read_pivots(MODEL)
    print("Pivotes de los nodos (mm):")
    for name in ("RightAtrium", "LeftAtrium", "RightVentricle", "LeftVentricle"):
        print(f"  {name:15} {np.round(pivots[name] * MM_PER_UNIT, 1)}")
    lv_rv = np.linalg.norm(pivots["LeftVentricle"] - pivots["RightVentricle"]) * MM_PER_UNIT
    print(f"  distancia VI-VD: {lv_rv:.1f} mm — un solo grupo no sigue a los dos")

    paths, landmarks, casts = build(nodes, pivots)
    for structure in RADIUS_MM:
        own = [p for p in paths if p.structure == structure]
        length = sum(float(arc_length(p.points)[-1]) for p in own) * MM_PER_UNIT
        print(f"  {structure:20} trayectos={len(own):4} longitud={length:7.1f} mm")

    if args.skip_validation:
        validation = {"skipped": True}
    else:
        print("Validación (dos pieles, siete puntos del ciclo):")
        validation = validate(paths, nodes, pivots, casts)
        print("  ", validation)

    text = serialise(paths, landmarks, pivots, validation)
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            print("MAL: regenerar no da el mismo fichero")
            return 1
        print("BIEN: la misma semilla da exactamente los mismos datos")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"Escrito {OUTPUT.relative_to(REPO_ROOT)} ({len(text) / 1024:.0f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
