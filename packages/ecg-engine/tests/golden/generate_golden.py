"""Genera los ficheros de referencia de golden signals.

**Ejecutar solo ante un cambio intencional y documentado del motor.**
Regenerar los golden para «arreglar» un test que ha empezado a fallar
equivale a borrar la alarma de incendios porque suena.

    uv run python tests/golden/generate_golden.py
"""

from __future__ import annotations

import json
import math
import sys

import numpy as np

from ecg_engine import list_rhythms

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from conftest import golden_paths, simulate  # noqa: E402


def _json_safe(value: float) -> float | None:
    """NaN no es JSON válido. Un PR no medible se guarda como null."""
    return None if math.isnan(value) else value


def main() -> None:
    written = 0
    for definition in list_rhythms():
        for noisy in (False, True):
            result = simulate(definition.rhythm_id, noisy)
            paths = golden_paths(definition.rhythm_id, noisy)
            paths["signal"].parent.mkdir(parents=True, exist_ok=True)

            np.save(paths["signal"], result["signal"])
            paths["events"].write_text(
                json.dumps(result["events"], indent=2), encoding="utf-8"
            )
            paths["measurements"].write_text(
                json.dumps(
                    {k: _json_safe(v) for k, v in result["measurements"].items()},
                    indent=2,
                ),
                encoding="utf-8",
            )
            written += 3
            suite = "noisy" if noisy else "clean"
            print(f"  {definition.rhythm_id} [{suite}]")

    print(f"\n{written} ficheros escritos en tests/golden/data/")


if __name__ == "__main__":
    main()
