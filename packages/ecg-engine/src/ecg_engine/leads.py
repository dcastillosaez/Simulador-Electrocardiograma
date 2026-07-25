"""Proyección de una traza canónica a las doce derivaciones.

El MVP no modela el dipolo cardíaco en 3D. Usa una tabla de coeficientes por
derivación, que es suficiente para docencia y deja abierta la migración a un
modelo vectorial en fase 4 sin tocar la API pública.

Los coeficientes respetan dos restricciones clínicas que los tests verifican:
la ley de Einthoven (I + III = II) y la progresión de la onda R de V1 a V5.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from .types import LEAD_ORDER, N_LEADS


@dataclass(frozen=True, slots=True)
class LeadProjection:
    """Coeficiente de proyección por derivación, en orden canónico."""

    coefficients: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.coefficients) != N_LEADS:
            raise ValueError(
                f"se esperaban {N_LEADS} coeficientes, "
                f"recibidos {len(self.coefficients)}"
            )

    def as_column(self) -> np.ndarray:
        """Vector columna `(12, 1)`, listo para multiplicar por una traza."""
        return np.asarray(self.coefficients, dtype=np.float64).reshape(N_LEADS, 1)


def projection_from_mapping(mapping: Mapping[str, float]) -> LeadProjection:
    """Construye una proyección desde un diccionario derivación → coeficiente.

    Exige exactamente las doce derivaciones canónicas: ni una de más, ni una
    de menos. Un typo en el nombre de una derivación es un error, no un
    coeficiente por defecto silencioso.
    """
    unknown = sorted(set(mapping) - set(LEAD_ORDER))
    if unknown:
        raise ValueError(f"derivaciones desconocidas: {', '.join(unknown)}")
    missing = sorted(set(LEAD_ORDER) - set(mapping))
    if missing:
        raise ValueError(f"faltan derivaciones: {', '.join(missing)}")
    return LeadProjection(coefficients=tuple(float(mapping[l]) for l in LEAD_ORDER))


# Eje cardíaco normal, en torno a +60°. II es la derivación dominante y aVR
# es negativa, como en cualquier ECG bien registrado.
NORMAL_AXIS_PROJECTION: LeadProjection = projection_from_mapping(
    {
        "I": 0.50,
        "II": 1.00,
        "III": 0.50,
        "aVR": -0.75,
        "aVL": 0.00,
        "aVF": 0.75,
        "V1": -0.30,
        "V2": 0.10,
        "V3": 0.60,
        "V4": 1.10,
        "V5": 1.20,
        "V6": 0.90,
    }
)

# La despolarización auricular sigue un eje distinto y tiene menos voltaje en
# precordiales derechas. Por eso la P no se proyecta como el QRS.
ATRIAL_PROJECTION: LeadProjection = projection_from_mapping(
    {
        "I": 0.60,
        "II": 1.00,
        "III": 0.40,
        "aVR": -0.80,
        "aVL": 0.10,
        "aVF": 0.70,
        "V1": 0.40,
        "V2": 0.50,
        "V3": 0.45,
        "V4": 0.40,
        "V5": 0.35,
        "V6": 0.30,
    }
)


def project(trace_v: np.ndarray, projection: LeadProjection) -> np.ndarray:
    """Expande una traza `(n,)` a `(12, n)` aplicando los coeficientes."""
    trace = np.asarray(trace_v, dtype=np.float64)
    if trace.ndim != 1:
        raise ValueError(f"se esperaba una traza 1-D, recibida {trace.ndim}-D")
    return projection.as_column() * trace[np.newaxis, :]
