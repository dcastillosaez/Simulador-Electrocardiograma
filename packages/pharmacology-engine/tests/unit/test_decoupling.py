"""El principio arquitectónico de la Fase F, como test ejecutable.

«El motor farmacológico permanece completamente desacoplado del motor ECG.»
Un principio que solo vive en un documento se rompe en el primer atajo; este
test lo convierte en un fallo de la suite.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pharmacology_engine

PACKAGE_ROOT = Path(pharmacology_engine.__file__).parent


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
    return names


def test_ningun_modulo_importa_el_motor_de_ecg() -> None:
    offenders = {
        path.relative_to(PACKAGE_ROOT).as_posix()
        for path in PACKAGE_ROOT.rglob("*.py")
        if any(m.split(".")[0] == "ecg_engine" for m in _imported_modules(path))
    }
    assert offenders == set(), (
        "estos módulos rompen el desacoplamiento de la Fase F: "
        f"{sorted(offenders)}"
    )


def test_el_paquete_no_arrastra_numpy() -> None:
    """No es purismo: el motor farmacológico debe poder ejecutarse en
    cualquier proceso —incluido un test de la capa de escenarios— sin
    arrastrar la pila científica del motor de señal."""
    assert "numpy" not in pharmacology_engine.__dict__


def test_la_version_se_expone() -> None:
    """Se persiste con la sesión: un replay solo es válido si coincide."""
    assert pharmacology_engine.__version__
