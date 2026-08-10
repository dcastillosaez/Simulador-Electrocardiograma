"""Construye `apps/web/public/models/heart.glb` desde BodyParts3D.

El modelo anatómico de la fase D no se versiona como binario opaco: se
reconstruye desde su fuente original con este script, que es lo que hace
auditable de dónde sale cada malla. Los 136 MB de BodyParts3D no entran en el
repositorio; se descargan a un directorio temporal y se descartan.

Uso:

    uv run --with trimesh --with numpy python docs/fase-d/build-heart-model.py
    uv run --with trimesh --with numpy python docs/fase-d/build-heart-model.py --validate-only

Fuente: BodyParts3D, Copyright(c) The Database Center for Life Science
licensed by CC Attribution-Share Alike 2.1 Japan. Ver `attribution.md`.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import trimesh

BASE_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"
MESH_ARCHIVE = "isa_BP3D_4.0_obj_99.zip"
ELEMENT_MAPS = ("partof_element_parts.txt", "isa_element_parts.txt")

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = REPO_ROOT / "apps" / "web" / "public" / "models" / "heart.glb"

# Los diez nombres son el contrato con `heart-nodes.ts`. Cambiar uno aquí sin
# cambiarlo allí hace que `bindHeartNodes` falle en la carga, que es
# exactamente el comportamiento que se quiere: ruidoso y temprano.
#
# `tree` dice de cuál de las dos jerarquías de BodyParts3D sale la estructura.
# Las cavidades y los grandes vasos sistémicos viven en la jerarquía PART-OF
# ("la aurícula izquierda es parte del corazón"); las arterias y venas
# pulmonares, en la IS-A. Las mallas de elemento (`FJ*.obj`) son las mismas en
# ambas: solo cambia cómo se agrupan.
#
# `priority` resuelve los elementos que pertenecen a dos estructuras a la vez.
# No es un defecto de los datos: las valvas mitral y tricúspide separan una
# aurícula de su ventrículo, así que BodyParts3D las lista en ambos. Se
# asignan al ventrículo —el plano valvular desciende con la sístole
# ventricular, que es el movimiento dominante— y se restan de la aurícula,
# para que ninguna geometría acabe duplicada en dos nodos que se animan por
# separado.
#
# `exclude` quita subconceptos completos. Se usa solo para los árboles
# pulmonares, y ahí es más honesto que cualquier criterio geométrico: la
# distinción entre la parte extrapulmonar de una arteria pulmonar y la
# intrapulmonar es anatómica y está en la propia ontología. Lo que cuelga
# dentro del pulmón no pinta nada en un corazón.
STRUCTURES = [
    ("LeftVentricle", ("FMA7101",), "partof", 0, ()),
    ("RightVentricle", ("FMA7098",), "partof", 0, ()),
    ("LeftAtrium", ("FMA7097",), "partof", 1, ()),
    ("RightAtrium", ("FMA7096",), "partof", 1, ()),
    # Aorta ascendente y cayado, no "aorta" a secas: ese concepto baja hasta el
    # abdomen y son 37 cm de vaso que no pintan nada en un corazón.
    ("Aorta", ("FMA3736", "FMA3768"), "partof", 2, ()),
    # Tronco pulmonar y las dos ramas, menos lo que entra en el pulmón.
    (
        "PulmonaryArtery",
        ("FMA8612", "FMA50872", "FMA50873"),
        "partof",
        2,
        ("FMA67994", "FMA67995"),
    ),
    # Las cuatro venas pulmonares por separado y no el concepto genérico
    # "pulmonary vein": ese, en la jerarquía IS-A, son 84 elementos que se
    # quedan en cero al restarles lo intrapulmonar, porque agrupa las ramas y
    # no las desembocaduras. Los troncos que llegan a la aurícula izquierda
    # cuelgan de las cuatro venas nombradas.
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

# `Septum` (FMA7133) NO aparece aquí, y no por descuido: BodyParts3D no trae
# malla del tabique interventricular. Se comprobó en las dos jerarquías, y
# también sus vecinos FMA7134 (parte muscular) y FMA7132. Los 61 elementos del
# corazón que no son cavidad son todos vasos coronarios. Ver `anatomy-source.md`.

# Las cuatro cavidades definen la región cardíaca; todo lo demás se recorta a
# ella con este margen, en milímetros.
#
# Hace falta porque los conceptos de BodyParts3D son anatómicos, no
# escenográficos: "aorta" es la aorta entera, con su porción descendente de 37
# cm, y "arteria pulmonar" son 99 elementos que llegan hasta el último
# subsegmento de ambos pulmones. Dejarlos enteros daría un corazón perdido
# dentro de una maraña de vasos.
#
# Es una regla espacial y no una lista de exclusiones por identificador: una
# lista habría que mantenerla vaso a vaso, y con la regla el criterio queda
# escrito una vez y se aplica igual a la aorta descendente, al árbol
# intrapulmonar y a la porción abdominal de la cava inferior. El recorte es
# por elemento entero —se conserva o se descarta— así que ninguna malla queda
# cortada por la mitad ni con agujeros.
CARDIAC_MARGIN_MM = 60.0

# El modelo llega en milímetros y descentrado respecto al origen del cuerpo
# entero. Se normaliza a un corazón de altura ~1 centrado en el origen: así la
# escena de Three.js encuadra sin números mágicos y el animador, que trabaja
# con factores de escala relativos, no depende de las unidades de la fuente.
TARGET_HEIGHT = 1.0

TRIANGLE_BUDGET = 3_000_000


def fetch(name: str, cache: Path) -> Path:
    """Descarga a `cache` si no está ya. Idempotente a propósito: reejecutar
    el script no vuelve a bajar 136 MB."""
    target = cache / name
    if target.exists() and target.stat().st_size > 0:
        return target
    cache.mkdir(parents=True, exist_ok=True)
    print(f"  descargando {name} ...", flush=True)
    with urlopen(f"{BASE_URL}/{name}") as response, target.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    return target


def load_element_map(path: Path) -> dict[str, list[str]]:
    """Concepto anatómico -> mallas de elemento que lo componen."""
    mapping: dict[str, list[str]] = defaultdict(list)
    with path.open(encoding="utf-8") as handle:
        next(handle)
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if len(fields) >= 3:
                mapping[fields[0]].append(fields[2])
    return mapping


def resolve_elements(maps: dict[str, dict[str, list[str]]]) -> dict[str, list[str]]:
    """Elementos de cada estructura, ya sin solapes entre estructuras."""
    claimed: dict[str, str] = {}
    resolved: dict[str, list[str]] = {}
    for name, includes, tree, _, exclude in sorted(STRUCTURES, key=lambda row: row[3]):
        # Las exclusiones se buscan en las dos jerarquías: las mallas de
        # elemento son las mismas, solo cambia de qué concepto cuelgan.
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


def load_element(archive: zipfile.ZipFile, element: str) -> trimesh.Trimesh:
    # En memoria y no por `archive.open`: trimesh intenta resolver materiales
    # relativos al `name` del fichero, y el de una entrada de zip no es una
    # ruta del disco.
    raw = io.BytesIO(archive.read(f"isa_BP3D_4.0_obj_99/{element}.obj"))
    mesh = trimesh.load(raw, file_type="obj", process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = mesh.to_geometry()
    return mesh


def cardiac_bounds(
    elements: dict[str, list[str]], loaded: dict[str, trimesh.Trimesh]
) -> tuple[np.ndarray, np.ndarray]:
    """Caja que abarca las cuatro cavidades, ensanchada por el margen."""
    chambers = ["LeftVentricle", "RightVentricle", "LeftAtrium", "RightAtrium"]
    corners = np.vstack(
        [loaded[element].bounds for name in chambers for element in elements[name]]
    )
    return (
        corners.min(axis=0) - CARDIAC_MARGIN_MM,
        corners.max(axis=0) + CARDIAC_MARGIN_MM,
    )


def validate(name: str, mesh: trimesh.Trimesh, elements: list[str]) -> list[str]:
    """Devuelve los problemas encontrados. Vacío significa que pasa."""
    problems = []
    if not elements:
        problems.append("sin elementos en el mapa de BodyParts3D")
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        problems.append("geometría vacía")
        return problems
    extents = mesh.bounding_box.extents
    if float(np.min(extents)) <= 0:
        problems.append(f"caja delimitadora degenerada: {extents}")
    if not np.all(np.isfinite(mesh.vertices)):
        problems.append("vértices no finitos")
    if len(mesh.face_normals) != len(mesh.faces):
        problems.append("normales incompletas")
    return problems


def read_node_names(path: Path) -> list[str]:
    """Nombres de nodo de un GLB, leyendo su cabecera JSON en crudo.

    Sin trimesh a propósito: se trata de comprobar lo que hay en el fichero,
    no lo que la misma librería que lo escribió dice que hay."""
    raw = path.read_bytes()
    length = int.from_bytes(raw[12:16], "little")
    document = json.loads(raw[20 : 20 + length])
    return [node.get("name", "") for node in document.get("nodes", [])]


def write_preview(meshes: dict[str, trimesh.Trimesh], target: Path) -> None:
    """Tres proyecciones ortográficas, una color por estructura.

    Es la inspección visual sin WebGL ni contexto gráfico: dibuja los vértices
    proyectados, que basta para ver si una cavidad está donde debe, si un vaso
    sale por donde toca y si algo quedó suelto en mitad de la nada. Para juzgar
    el aspecto final no sirve —eso es la escena de Three.js—, pero para cazar
    un montaje mal hecho, sí."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    views = [("Frontal", 0, 2), ("Lateral", 1, 2), ("Superior", 0, 1)]
    colours = plt.get_cmap("tab10")
    figure, axes = plt.subplots(1, 3, figsize=(16, 6))
    for axis, (title, i, j) in zip(axes, views):
        for index, (name, mesh) in enumerate(meshes.items()):
            if len(mesh.vertices) == 0:
                continue
            points = np.asarray(mesh.vertices)
            axis.scatter(
                points[:, i],
                points[:, j],
                s=0.4,
                alpha=0.35,
                linewidths=0,
                color=colours(index % 10),
                label=name,
            )
        axis.set_title(title)
        axis.set_aspect("equal")
        axis.grid(alpha=0.2)
    handles, labels = axes[0].get_legend_handles_labels()
    figure.legend(
        handles,
        labels,
        loc="lower center",
        ncol=5,
        markerscale=20,
        frameon=False,
    )
    figure.tight_layout(rect=(0, 0.09, 1, 1))
    figure.savefig(target, dpi=110)
    plt.close(figure)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument(
        "--preview",
        type=Path,
        help="Escribe tres proyecciones ortográficas en este PNG. Requiere matplotlib.",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(__file__).resolve().parent / ".bodyparts3d-cache",
        help="Dónde guardar la descarga. Fuera del repositorio a propósito.",
    )
    args = parser.parse_args()

    print("Fuente")
    archive_path = fetch(MESH_ARCHIVE, args.cache)
    maps = {
        "partof": load_element_map(fetch(ELEMENT_MAPS[0], args.cache)),
        "isa": load_element_map(fetch(ELEMENT_MAPS[1], args.cache)),
    }
    print(f"  {archive_path.name}: {archive_path.stat().st_size / 1e6:.1f} MB")

    resolved = resolve_elements(maps)

    with zipfile.ZipFile(archive_path) as archive:
        loaded = {
            element: load_element(archive, element)
            for elements in resolved.values()
            for element in elements
        }

    low, high = cardiac_bounds(resolved, loaded)
    print(
        f"\nRegión cardíaca (margen {CARDIAC_MARGIN_MM:.0f} mm): "
        f"{np.round(low, 1)} .. {np.round(high, 1)}"
    )

    print("\nValidación")
    meshes: dict[str, trimesh.Trimesh] = {}
    failures = 0
    for name, *_ in STRUCTURES:
        kept = [
            element
            for element in resolved[name]
            if np.all(loaded[element].bounding_box.centroid >= low)
            and np.all(loaded[element].bounding_box.centroid <= high)
        ]
        dropped = len(resolved[name]) - len(kept)
        mesh = (
            trimesh.util.concatenate([loaded[element] for element in kept])
            if kept
            else trimesh.Trimesh()
        )
        problems = validate(name, mesh, kept)
        meshes[name] = mesh
        status = "OK " if not problems else "MAL"
        geometry = ""
        if len(mesh.faces) > 0:
            extents = mesh.bounding_box.extents
            centre = mesh.bounding_box.centroid
            geometry = (
                f"caja={extents[0]:6.1f}x{extents[1]:6.1f}x{extents[2]:6.1f} "
                f"centro=({centre[0]:7.1f},{centre[1]:7.1f},{centre[2]:7.1f})"
            )
        print(
            f"  {status} {name:17} elementos={len(kept):3} (-{dropped:3} fuera) "
            f"vértices={len(mesh.vertices):7} triángulos={len(mesh.faces):7} "
            f"{geometry}"
        )
        for problem in problems:
            print(f"      - {problem}")
            failures += 1

    total = sum(len(mesh.faces) for mesh in meshes.values())
    print(f"\n  total {total} triángulos (presupuesto {TRIANGLE_BUDGET})")
    if total > TRIANGLE_BUDGET:
        print("  MAL: por encima del presupuesto de triángulos")
        failures += 1

    if args.preview:
        write_preview(meshes, args.preview)
        print(f"  vistas en {args.preview}")

    if failures:
        print(f"\n{failures} problema(s). No se escribe nada.")
        return 1
    if args.validate_only:
        print("\nValidación en verde. No se escribe nada (--validate-only).")
        return 0

    # Normalización común: un solo factor y un solo desplazamiento para las
    # nueve. Escalar cada malla por separado las descolocaría entre sí.
    everything = trimesh.util.concatenate(list(meshes.values()))
    scale = TARGET_HEIGHT / float(everything.bounding_box.extents[1])
    offset = np.asarray(everything.bounding_box.centroid, dtype=float)

    scene = trimesh.Scene(base_frame="Heart")
    for name, *_ in STRUCTURES:
        mesh = meshes[name]
        mesh.apply_translation(-offset)
        mesh.apply_scale(scale)
        # El origen de cada nodo, en su propio centro geométrico: es lo que
        # hace que escalar una cavidad la contraiga hacia dentro en vez de
        # arrastrarla hacia el origen de la escena. La malla se centra y el
        # desplazamiento se recupera en la transformación del nodo, así que la
        # posición en el mundo no cambia.
        local = np.asarray(mesh.bounding_box.centroid, dtype=float)
        mesh.apply_translation(-local)
        transform = np.eye(4)
        transform[:3, 3] = local
        scene.add_geometry(mesh, node_name=name, geom_name=name, transform=transform)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(scene.export(file_type="glb"))
    print(f"\nEscrito {OUTPUT.relative_to(REPO_ROOT)}: {OUTPUT.stat().st_size / 1e6:.1f} MB")

    # Releer el fichero y comprobar los nombres de nodo. Es lo único que
    # `bindHeartNodes` va a mirar en el navegador, y que el exportador los
    # escriba como se le pidieron no es algo que convenga dar por supuesto:
    # si se pierden, el fallo aparecería en la carga de la escena y no aquí.
    written = set(read_node_names(OUTPUT))
    expected = {name for name, *_ in STRUCTURES}
    if missing := expected - written:
        print(f"MAL: el GLB no expone estos nodos: {sorted(missing)}")
        return 1
    print(f"Contrato verificado: {len(expected)} nodos con su nombre en el GLB.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
