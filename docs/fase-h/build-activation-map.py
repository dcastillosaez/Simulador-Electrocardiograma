"""Calcula el mapa de activación del tejido para el corazón 3D (fase H4).

Cada vértice de las cinco mallas que se activan —las dos aurículas, los dos
moldes ventriculares y el miocardio sintetizado— recibe un número entre 0 y 1:
dónde cae su activación dentro del tramo eléctrico de su estructura. El
servidor manda cuándo empieza y termina ese tramo (la P para las aurículas, el
QRS para los ventrículos); el sombreador compara el tiempo con el número del
vértice y no guarda estado. Al ser normalizado, el mismo mapa sirve para un QRS
de 80 ms y para uno de 160.

**De dónde sale el orden.** De distancias, no de un modelo electrofisiológico:

- Las aurículas se activan desde el nodo sinusal (la derecha) y desde la
  entrada del haz de Bachmann (la izquierda), los mismos puntos que usa
  `build-conduction-paths.py`.
- Los ventrículos, desde los puntos donde Durrer et al. encontraron la
  activación endocárdica más precoz en corazones humanos aislados (Durrer D,
  et al. Total excitation of the isolated human heart. Circulation.
  1970;41(6):899-912): tres zonas del ventrículo izquierdo —parte alta de la
  pared paraseptal anterior bajo la inserción mitral, centro de la cara
  izquierda del tabique y paraseptal posterior a un tercio del ápex— y, en el
  derecho, la inserción del músculo papilar anterior. Durrer sitúa el inicio
  del ventrículo derecho 5-10 ms después; ese retraso **no** se aplica, porque
  convertirlo en distancia exigiría una velocidad de conducción que no tiene
  fuente en el fichero de tiempos. Queda anotado en `docs/fase-h/estado.md`.

La distancia es geodésica sobre el endocardio —el molde de la cavidad—, porque
una recta atravesaría la cavidad o pasaría de una cámara a otra; a ella se suma
el tramo recto a través de la pared hasta el vértice, que es el único que
cruza tejido. Es un esquema didáctico del orden, no una electrofisiología
numérica, y la interfaz lo dice.

La recuperación (la T) no tiene orden espacial en este mapa: afirmarlo exige
una fuente y queda para después.

**Vértices.** Se leen tal cual vienen en el `.glb`, en el orden de su accesor,
que es el que conserva el cargador de Three.js: el atributo se asigna por
índice. Antes de calcular nada se comprueba que el miocardio tenga vértices
suficientes para que el frente se vea continuo.

Uso:

    uv run --python 3.12 --with trimesh --with numpy --with scipy \\
        --with networkx --with rtree --with embreex \\
        python docs/fase-h/build-activation-map.py [--check]
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("conduction", HERE / "build-conduction-paths.py")
conduction = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(conduction)  # type: ignore[union-attr]

REPO_ROOT = conduction.REPO_ROOT
MODEL = conduction.MODEL
MM = conduction.MM_PER_UNIT
OUTPUT = (
    REPO_ROOT / "apps" / "web" / "src" / "ui" / "Cardiac3D" / "activation" / "activation-map.json"
)
FORMAT_VERSION = 1

MAX_MEAN_EDGE_MM = 3.0
"""Arista media máxima para que el frente se vea continuo en una malla. Por
encima, el sombreado interpolado entre vértices dejaría escalones del tamaño
de un triángulo."""

TISSUES = {
    # malla: (tramo eléctrico, cámaras cuyo endocardio propaga, semillas)
    "RightAtrium": ("right_atrium", ("RightAtrium",), "sa"),
    "LeftAtrium": ("left_atrium", ("LeftAtrium",), "bachmann"),
    "LeftVentricle": ("ventricular_myocardium", ("LeftVentricle", "RightVentricle"), "durrer"),
    "RightVentricle": ("ventricular_myocardium", ("LeftVentricle", "RightVentricle"), "durrer"),
    "Myocardium": ("ventricular_myocardium", ("LeftVentricle", "RightVentricle"), "durrer"),
}


TISSUE_INDEX = {"ventricular_myocardium": 0, "right_atrium": 1, "left_atrium": 2}
"""El índice del tejido que viaja en cada vértice. El sombreador lo usa para
elegir qué ventana temporal compara."""

CAVITY_ORDER = ("LeftVentricle", "RightVentricle", "RightAtrium", "LeftAtrium")


def raw_meshes(path: Path) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Posiciones e índices de cada malla tal como los lee el cliente, en el
    espacio de la escena (con la traslación de su nodo)."""
    data = path.read_bytes()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + json_len])
    binary = data[20 + json_len + 8 :]

    def accessor(index: int) -> np.ndarray:
        acc = doc["accessors"][index]
        view = doc["bufferViews"][acc["bufferView"]]
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[acc["componentType"]]
        width = {"SCALAR": 1, "VEC3": 3}[acc["type"]]
        array = np.frombuffer(binary, dtype=dtype, count=acc["count"] * width, offset=offset)
        return array.reshape(acc["count"], width) if width > 1 else array

    out = {}
    for node in doc["nodes"]:
        if "mesh" not in node:
            continue
        primitive = doc["meshes"][node["mesh"]]["primitives"][0]
        positions = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
        indices = accessor(primitive["indices"]).astype(np.int64).reshape(-1, 3)
        translation = np.array(node["matrix"][12:15]) if "matrix" in node else np.zeros(3)
        out[node["name"]] = (positions + translation, indices)
    return out


def mean_edge_mm(vertices: np.ndarray, faces: np.ndarray) -> float:
    edges = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    return float(np.linalg.norm(vertices[edges[:, 0]] - vertices[edges[:, 1]], axis=1).mean() * MM)


class Endocardium:
    """Las superficies de las cavidades unidas en un grafo. Entre los dos
    ventrículos el grafo salta por el hueco septal, que es tejido: el impulso
    cruza el tabique, no la sangre."""

    def __init__(self, surfaces: list["conduction.Surface"]) -> None:
        self.vertices = np.vstack([s.vertices for s in surfaces])
        blocks = []
        offset = 0
        for surface in surfaces:
            g = surface.graph.tocoo()
            blocks.append((g.data, g.row + offset, g.col + offset))
            offset += len(surface.vertices)
        data = [b[0] for b in blocks]
        rows = [b[1] for b in blocks]
        cols = [b[2] for b in blocks]
        if len(surfaces) == 2:
            a, b = surfaces
            distance, partner = b.tree.query(a.vertices)
            close = np.flatnonzero(distance * MM <= 6.0)
            data.append(np.concatenate([distance[close], distance[close]]))
            rows.append(np.concatenate([close, partner[close] + len(a.vertices)]))
            cols.append(np.concatenate([partner[close] + len(a.vertices), close]))
        n = len(self.vertices)
        self.graph = coo_matrix(
            (np.concatenate(data), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)
        ).tocsr()
        self.tree = cKDTree(self.vertices)

    def distances_from(self, seeds: list[np.ndarray]) -> np.ndarray:
        indices = sorted({int(self.tree.query(p)[1]) for p in seeds})
        return dijkstra(self.graph, directed=False, indices=indices, min_only=True)


def durrer_sites(lv: "conduction.Surface", rv: "conduction.Surface", nodes) -> dict[str, np.ndarray]:
    """Las zonas de activación más precoz de Durrer, localizadas sobre los
    moldes. Las descripciones son las del resumen del artículo; la geometría,
    la del modelo."""
    lv_v = lv.vertices
    gap = cKDTree(rv.vertices).query(lv_v)[0] * MM
    septal = gap <= 6.0
    paraseptal = (gap > 6.0) & (gap <= 18.0)
    mitral = conduction.contact_points(lv_v, np.asarray(nodes["LeftAtrium"].vertices), 3.0).mean(0)
    apex = lv_v[np.argmax(np.linalg.norm(lv_v - mitral, axis=1))]
    axis = (mitral - apex) / np.linalg.norm(mitral - apex)
    height = (lv_v - apex) @ axis / np.linalg.norm(mitral - apex)

    centre = lv_v[septal].mean(0)
    site_septum = lv_v[np.flatnonzero(septal)[np.argmin(np.linalg.norm(lv_v[septal] - centre, axis=1))]]

    high = np.flatnonzero(paraseptal & (height > 0.7) & (height < 0.9))
    site_anterior = lv_v[high[np.argmax(lv_v[high, 2])]]

    third = np.flatnonzero(paraseptal & (np.abs(height - 1.0 / 3.0) < 0.08))
    site_posterior = lv_v[third[np.argmin(lv_v[third, 2])]]

    rv_papillaries = []
    for muscle in conduction.papillary_muscles(nodes["RightVentricle"]):
        vertices = np.asarray(muscle.vertices)
        rv_papillaries.append(vertices[np.argmin(rv.tree.query(vertices)[0])])
    site_rv = max(rv_papillaries, key=lambda p: p[2])
    return {
        "lv_anterior_paraseptal": site_anterior,
        "lv_septum": site_septum,
        "lv_posterior_paraseptal": site_posterior,
        "rv_anterior_papillary": site_rv,
    }


def fractions_for(vertices: np.ndarray, endo: Endocardium, seeds: list[np.ndarray]) -> np.ndarray:
    """Activación normalizada de cada vértice: geodésica por el endocardio
    hasta el punto de la cavidad más próximo, más el tramo recto a través de
    la pared hasta el vértice."""
    along = endo.distances_from(seeds)
    nearest_distance, nearest = endo.tree.query(vertices)
    total = along[nearest] + nearest_distance
    finite = np.isfinite(total)
    if not finite.all():
        # Vértices de un componente suelto sin camino: toman la activación más
        # tardía, que es lo que se ve de un trozo al que el frente no llega.
        total[~finite] = total[finite].max()
    low, high = total.min(), total.max()
    return (total - low) / (high - low) if high > low else np.zeros_like(total)


def visible(points: np.ndarray, skin: trimesh.Trimesh) -> np.ndarray:
    return conduction.visible_from_outside(points, skin)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    meshes = raw_meshes(MODEL)
    nodes = conduction.read_nodes(MODEL)
    pivots = conduction.read_pivots(MODEL)

    print("Arista media por malla (mm):")
    for name in TISSUES:
        vertices, faces = meshes[name]
        edge = mean_edge_mm(vertices, faces)
        print(f"  {name:15} vértices={len(vertices):6} arista media={edge:5.2f}")
    myocardium_edge = mean_edge_mm(*meshes["Myocardium"])
    if myocardium_edge > MAX_MEAN_EDGE_MM:
        print(f"MAL: el miocardio tiene aristas de {myocardium_edge:.1f} mm: hay que subdividirlo")
        return 1

    surfaces = {
        name: conduction.Surface(conduction.cavity(nodes[name]), name)
        for name in ("RightAtrium", "LeftAtrium", "LeftVentricle", "RightVentricle")
    }
    paths, _, _ = conduction.build(nodes, pivots)
    sa_point = next(p for p in paths if p.structure == "sa_node").points[0]
    bachmann_entry = [
        p for p in paths if p.structure == "atrial_pathways" and p.chamber == "LeftAtrium"
    ][-1].points[0]
    sites = durrer_sites(surfaces["LeftVentricle"], surfaces["RightVentricle"], nodes)

    seeds = {
        "sa": [sa_point],
        "bachmann": [bachmann_entry],
        "durrer": list(sites.values()),
    }
    endocardia = {
        key: Endocardium([surfaces[name] for name in chambers])
        for key, chambers in {
            ("RightAtrium",): ("RightAtrium",),
            ("LeftAtrium",): ("LeftAtrium",),
            ("LeftVentricle", "RightVentricle"): ("LeftVentricle", "RightVentricle"),
        }.items()
    }

    maps: dict[str, np.ndarray] = {}
    tissue_of: dict[str, np.ndarray] = {}
    for name, (segment, chambers, seed_key) in TISSUES.items():
        vertices, _ = meshes[name]
        maps[name] = fractions_for(vertices, endocardia[chambers], seeds[seed_key])
        tissue_of[name] = np.full(len(vertices), TISSUE_INDEX[segment], dtype=np.uint8)

    # El miocardio sintetizado envuelve las cuatro cámaras: cada vértice es del
    # tejido de la cavidad más próxima. Sin esto la pared auricular se
    # encendería con el QRS.
    myo_vertices, _ = meshes["Myocardium"]
    owner = np.argmin(
        np.column_stack(
            [surfaces[name].tree.query(myo_vertices)[0] for name in CAVITY_ORDER]
        ),
        axis=1,
    )
    for k, cavity_name in enumerate(CAVITY_ORDER):
        segment, chambers, seed_key = TISSUES[cavity_name]
        mine = owner == k
        if not mine.any() or segment == "ventricular_myocardium":
            continue
        maps["Myocardium"][mine] = fractions_for(
            myo_vertices[mine], endocardia[chambers], seeds[seed_key]
        )
        tissue_of["Myocardium"][mine] = TISSUE_INDEX[segment]
    print(
        "  miocardio por tejido:",
        {segment: int((tissue_of["Myocardium"] == index).sum()) for segment, index in TISSUE_INDEX.items()},
    )

    # --- Validación -------------------------------------------------------
    failures = []
    for name, values in maps.items():
        if not np.all(np.isfinite(values)) or values.min() < 0 or values.max() > 1:
            failures.append(f"{name}: activaciones fuera de [0, 1]")
    # Del endocardio al epicardio, contra las dos pieles y en los siete puntos
    # del ciclo: lo que se ve desde fuera del órgano se activa más tarde que
    # lo que queda dentro. Con la piel por defecto —sin miocardio— se mide lo
    # mismo sobre los moldes ventriculares.
    stats = []
    for pose in conduction.cycle_points():
        organ = conduction.deformed_skin(nodes, conduction.SKIN_ORGAN, pivots, pose)
        default = conduction.deformed_skin(nodes, conduction.SKIN_DEFAULT_VIEW, pivots, pose)
        myo = conduction.deform(meshes["Myocardium"][0], "Myocardium", pivots, pose)
        ventricular = np.flatnonzero(tissue_of["Myocardium"] == 0)
        sample = ventricular[::7]
        shown = visible(myo[sample], organ)
        outer = float(maps["Myocardium"][sample][shown].mean())
        inner = float(maps["Myocardium"][sample][~shown].mean())
        lv = conduction.deform(meshes["LeftVentricle"][0], "LeftVentricle", pivots, pose)
        lv_shown = visible(lv, default)
        stats.append(
            {
                "pose": list(pose),
                "myocardium_outer_mean": round(outer, 3),
                "myocardium_inner_mean": round(inner, 3),
                "lv_visible_default_mean": round(float(maps["LeftVentricle"][lv_shown].mean()), 3),
                "lv_hidden_default_mean": round(float(maps["LeftVentricle"][~lv_shown].mean()), 3),
            }
        )
        if not outer > inner:
            failures.append(f"{pose}: el epicardio no se activa después que el endocardio")
        print(f"  pose {pose}: miocardio fuera={outer:.3f} dentro={inner:.3f}")
    if failures:
        for failure in failures:
            print("  MAL:", failure)
        return 1

    document = {
        "format_version": FORMAT_VERSION,
        "generator": "docs/fase-h/build-activation-map.py",
        "didactic": True,
        "source": (
            "Orden de activación ventricular: Durrer D, et al. Total excitation of the "
            "isolated human heart. Circulation. 1970;41(6):899-912."
        ),
        "tissues": list(TISSUE_INDEX),
        "seeds": {key: [round(float(c), 5) for c in value] for key, value in sites.items()},
        "validation": stats,
        "meshes": {
            name: {
                "segment": TISSUES[name][0],
                "vertices": int(len(values)),
                # Un byte por vértice basta: 256 escalones dentro de un QRS de
                # 100 ms son 0,4 ms, por debajo de un fotograma.
                "activation": base64.b64encode(
                    np.round(values * 255).astype(np.uint8).tobytes()
                ).decode("ascii"),
                "tissue": base64.b64encode(tissue_of[name].tobytes()).decode("ascii"),
            }
            for name, values in maps.items()
        },
    }
    text = json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        print("BIEN: idéntico" if current == text else "MAL: regenerar no da el mismo fichero")
        return 0 if current == text else 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"Escrito {OUTPUT.relative_to(REPO_ROOT)} ({len(text) / 1024:.0f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
