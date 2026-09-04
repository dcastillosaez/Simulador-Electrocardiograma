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

# Cuánto se abre cada válvula y hasta dónde arrastra lo que cuelga de ella.
#
# El ángulo es de presentación, como la curva de contracción del cliente: la
# fuente da una pose y una sola, y cuánto se separa de ella una válvula abierta
# no está en el dato. Se eligen ángulos que dejan el orificio abierto casi hasta
# el anillo, que es lo que hay que ver.
#
# `drag_full_mm` y `drag_zero_mm` solo pintan en las auriculoventriculares. La
# malla de una valva mitral o tricúspide de BodyParts3D no es solo el velo:
# lleva pegada la cuerda tendinosa hasta el músculo papilar, cuarenta y tantos
# milímetros más abajo. Girarlo todo en bloque saca la punta fuera del
# ventrículo — comprobado—, así que el giro va a plena amplitud hasta
# `drag_full_mm` por debajo del anillo, que es donde acaba el velo, y se apaga
# suavemente hasta anularse en `drag_zero_mm`, que es donde está el papilar.
# El papilar no se mueve, y esa es exactamente la razón de que la cuerda
# tendinosa exista.
OPENING = {
    "Tricuspid": {"angle_deg": 62.0, "drag_full_mm": 8.0, "drag_zero_mm": 34.0},
    "Mitral": {"angle_deg": 62.0, "drag_full_mm": 9.0, "drag_zero_mm": 36.0},
    "Aortic": {"angle_deg": 58.0, "drag_full_mm": None, "drag_zero_mm": None},
    "Pulmonary": {"angle_deg": 58.0, "drag_full_mm": None, "drag_zero_mm": None},
}

ANNULUS_RADIUS_RANGE_MM = {
    # Rangos anatómicos de referencia para el radio del anillo. No son un
    # adorno: si el ajuste del anillo se va, el eje de giro se va con él y las
    # válvulas se abrirían hacia donde no es. Aquí se corta antes de escribir.
    "Tricuspid": (12.0, 22.0),
    "Mitral": (12.0, 20.0),
    "Aortic": (7.0, 15.0),
    "Pulmonary": (7.0, 15.0),
}

MAX_STRAY_MM = 4.0
"""Cuánto puede asomar una valva abierta por fuera del corazón.

Una válvula que al abrirse se sale del órgano es el fallo que un ángulo
demasiado generoso produce, y es un fallo que una proyección de puntos disimula.
Se mide contra la envolvente convexa de las diez estructuras: por dentro de ella
una valva está dentro del corazón, y lo que sobresalga se cuenta en milímetros.
La envolvente es generosa por definición —no entra en los entrantes del
órgano—, así que lo que se sale de ella se sale de verdad."""


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


def hull_excess(points: np.ndarray):
    """Devuelve una función que mide cuánto sobresale un punto de la
    envolvente convexa de `points`. Negativo o cero significa dentro."""
    hull = trimesh.convex.convex_hull(points)
    normals = np.asarray(hull.face_normals)
    offsets = np.einsum(
        "ij,ij->i", normals, np.asarray(hull.vertices)[hull.faces[:, 0]]
    )

    def excess(query: np.ndarray) -> np.ndarray:
        return (np.asarray(query) @ normals.T - offsets).max(axis=1)

    return excess


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


def opening_angles(
    points: np.ndarray,
    centre: np.ndarray,
    normal: np.ndarray,
    angle_rad: float,
    drag_full_mm: float | None,
    drag_zero_mm: float | None,
    mm_per_unit: float,
) -> np.ndarray:
    if drag_full_mm is None:
        return np.full(len(points), angle_rad)
    depth = ((points - centre) @ normal) * mm_per_unit
    weight = 1.0 - smoothstep((depth - drag_full_mm) / (drag_zero_mm - drag_full_mm))
    return angle_rad * weight


def open_pose(
    mesh: trimesh.Trimesh,
    centre: np.ndarray,
    normal: np.ndarray,
    radius: float,
    opening: dict,
    mm_per_unit: float,
) -> tuple[np.ndarray, float]:
    """Vértices de la valva abierta y el signo de giro que la abre.

    El signo no se escribe a mano: se prueban los dos y se queda el que aleja
    la valva del eje de la válvula, que es lo que significa abrirse. Escribirlo
    a mano son once decisiones que hay que revisar cada vez que se toca la
    geometría; así es una propiedad que se comprueba sola."""
    points = np.asarray(mesh.vertices)
    origin, axis = leaflet_hinge(mesh, centre, normal, radius)
    angles = opening_angles(
        points,
        centre,
        normal,
        np.deg2rad(opening["angle_deg"]),
        opening["drag_full_mm"],
        opening["drag_zero_mm"],
        mm_per_unit,
    )
    moving = angles > angles.max() * 0.5

    def mean_radius(sign: float) -> float:
        posed = rotate_about(points, origin, axis * sign, angles)[moving]
        return float(
            np.mean(
                np.linalg.norm(
                    (posed - centre) - np.outer((posed - centre) @ normal, normal),
                    axis=1,
                )
            )
        )

    sign = 1.0 if mean_radius(1.0) > mean_radius(-1.0) else -1.0
    return rotate_about(points, origin, axis * sign, angles), sign


# ------------------------------------------------------------------ glTF ----


def add_morph_targets(raw: bytes, targets: dict[str, dict[str, np.ndarray]]) -> bytes:
    """Mete una pose alternativa por malla en un GLB ya escrito.

    trimesh no sabe exportar *morph targets*, y son justo lo que hace falta:
    con ellos el cliente anima una válvula con un número y la interpolación la
    hace la GPU, sin tocar un vértice por fotograma ni duplicar materiales.
    Se añaden aquí, sobre el binario que trimesh acaba de escribir, porque el
    formato es abierto y esto son cuarenta líneas — bastante menos que la
    alternativa de escribir el GLB entero a mano.

    `targets` lleva, por nombre de malla, la diferencia entre la pose cerrada y
    la abierta: en `POSITION` la de cada vértice y en `NORMAL` la de su normal.
    glTF guarda los *morph targets* como diferencias, no como valores
    absolutos.

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
        attributes = {name: add_accessor(deltas) for name, deltas in target.items()}
        for primitive in mesh["primitives"]:
            primitive["targets"] = [attributes]
        # El peso inicial: la válvula arranca cerrada, que es la pose de la
        # fuente. El cliente lo sobrescribe en cuanto llega el primer latido.
        mesh["weights"] = [0.0]
        mesh.setdefault("extras", {})["targetNames"] = ["open"]

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
    for row, (poses, title) in enumerate(
        [(closed, "CERRADAS (sístole)"), (opened, "ABIERTAS (diástole)")]
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
    closed: dict[str, np.ndarray] = {}
    opened: dict[str, np.ndarray] = {}
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
        for name, mesh in meshes.items():
            posed, sign = open_pose(
                mesh, centre, normal, radius, OPENING[valve], mm_per_unit
            )
            leaflet_meshes[name] = mesh
            closed[name] = np.asarray(mesh.vertices)
            opened[name] = posed
            travel = np.linalg.norm(posed - mesh.vertices, axis=1) * mm_per_unit
            print(
                f"      {name:20} {spec['leaflets'][name]} "
                f"vértices={len(mesh.vertices):5} giro={sign:+.0f} "
                f"recorrido medio={travel.mean():5.1f} mm máximo={travel.max():5.1f} mm"
            )

    print("\nLa válvula abierta se queda dentro del corazón")
    outside = hull_excess(
        np.vstack([np.asarray(mesh.vertices) for mesh in chambers.values()]
                  + [np.asarray(existing[CARRIED_OVER].vertices)])
    )
    for name, posed in opened.items():
        stray = float(outside(posed).max()) * mm_per_unit
        status = "OK " if stray <= MAX_STRAY_MM else "MAL"
        if status == "MAL":
            failures += 1
        print(f"  {status} {name:20} asoma como mucho {stray:5.1f} mm")

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
    deltas: dict[str, dict[str, np.ndarray]] = {}
    for name, mesh in order:
        mesh = mesh.copy()
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
            posed = trimesh.Trimesh(
                vertices=opened[name] - local, faces=mesh.faces, process=False
            )
            deltas[name] = {
                "POSITION": (opened[name] - closed[name]).astype("<f4"),
                "NORMAL": (
                    np.asarray(posed.vertex_normals) - np.asarray(mesh.vertex_normals)
                ).astype("<f4"),
            }

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
            {"POSITION", "NORMAL"} <= set(p.get("targets", [{}])[0])
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
