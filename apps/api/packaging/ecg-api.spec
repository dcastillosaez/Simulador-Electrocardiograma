# Empaquetado del backend para el escritorio (fase G2).
#
#     cd apps/api && uv run --with pyinstaller pyinstaller packaging/ecg-api.spec
#
# Produce `dist/ecg-api/`, un directorio con el ejecutable y sus dependencias,
# que el shell de Tauri lanza como sidecar.
#
# **onedir y no onefile**, a propósito: `--onefile` descomprime todo en un
# temporal en cada arranque —segundos de espera, y un antivirus mirando cada
# vez—. En un servidor da igual; delante de una clase, no.

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

RAIZ = Path(SPECPATH).resolve().parents[2]

datos = []

# Las revisiones de Alembic son DATOS, no código importable: PyInstaller no las
# recogería sola. Sin ellas, `upgrade_to_head` no encuentra ni una revisión y el
# primer arranque en una máquina nueva se queda sin esquema.
datos.append((str(RAIZ / "apps/api/migrations"), "migrations"))

# El catálogo farmacológico son ficheros YAML. Mismo caso: si no viajan, la
# fase F entera se queda sin moléculas dentro del ejecutable.
datos += collect_data_files("pharmacology_engine", includes=["**/*.yaml", "**/*.yml"])

# Los drivers de base de datos se cargan por nombre, así que el análisis
# estático no los ve. Los dos: Postgres para quien conecte a un servidor y
# SQLite para el escritorio.
ocultos = [
    "asyncpg",
    "aiosqlite",
    "sqlalchemy.dialects.postgresql.asyncpg",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]
ocultos += collect_submodules("ecg_engine")
ocultos += collect_submodules("pharmacology_engine")

a = Analysis(
    [str(RAIZ / "apps/api/packaging/entrypoint.py")],
    pathex=[str(RAIZ / "apps/api/src")],
    binaries=[],
    datas=datos,
    hiddenimports=ocultos,
    hookspath=[],
    runtime_hooks=[],
    # Nada de esto hace falta en el escritorio y todo pesa. `tkinter` en
    # particular arrastra media librería gráfica que no se usa jamás.
    excludes=["tkinter", "matplotlib", "pytest", "IPython"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ecg-api",
    debug=False,
    strip=False,
    upx=False,  # UPX dispara falsos positivos de antivirus; no compensa
    console=False,  # sin consola: el usuario no debe ver una terminal
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="ecg-api",
)
