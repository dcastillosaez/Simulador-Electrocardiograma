"""Proyección de una traza canónica a las doce derivaciones.

El MVP no modela el dipolo cardíaco en 3D. Usa una tabla de coeficientes por
derivación, que es suficiente para docencia y deja abierta la migración a un
modelo vectorial en fase 4 sin tocar la API pública.

Los coeficientes respetan dos restricciones clínicas que los tests verifican:
la ley de Einthoven (I + III = II) y la progresión de la onda R de V1 a V5.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Mapping

import numpy as np

from .types import AxisParams, LEAD_ORDER, N_LEADS


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


# Eje cardíaco normal, en torno a +50°. II es la derivación dominante y aVR
# es negativa, como en cualquier ECG bien registrado.
#
# El eje está a 50° y no a 60° por un motivo concreto: a 60° exactos, I y III
# valen lo mismo y aVL = (I − III)/2 sale **cero exacto**. Una derivación
# perfectamente isoeléctrica en los doce trazados no existe en ningún
# paciente, y salta a la vista en cuanto se dibuja el ECG en papel. A 50° la
# aVL queda pequeña y positiva, que es lo normal.
#
# En V1 y V2 el complejo es netamente negativo: es el patrón de S dominante
# en precordiales derechas, con la transición en V3. Con V2 casi en cero el
# trazado salía plano justo donde un clínico espera la deflexión más ancha.
NORMAL_AXIS_PROJECTION: LeadProjection = projection_from_mapping(
    {
        "I": 0.653,
        "II": 1.000,
        "III": 0.347,
        "aVR": -0.8265,
        "aVL": 0.153,
        "aVF": 0.6735,
        "V1": -0.45,
        "V2": -0.15,
        "V3": 0.55,
        "V4": 1.15,
        "V5": 1.30,
        "V6": 0.95,
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

# --- Proyección paramétrica en el plano frontal ---------------------------
#
# Las tablas de arriba no son doce números a mano: sus derivaciones de
# miembros son M·cos(ref − ángulo_derivación), y aVR/aVL/aVF salen de las
# relaciones de Goldberger. Esta sección generaliza esa construcción a
# cualquier ángulo, de modo que projection_for_axis(50°) reproduce la tabla.

_LEAD_II_DEG: float = 60.0
"""Ángulo de la derivación II en el plano frontal. Es el eje sobre el que se
normalizó la tabla histórica: por eso II vale 1,000 exacto en la referencia."""

_QRS_REFERENCE_DEG: float = 50.0
_P_REFERENCE_DEG: float = 53.4

_QRS_MAGNITUDE: float = 1.0 / math.cos(math.radians(_QRS_REFERENCE_DEG - _LEAD_II_DEG))
"""Módulo del vector QRS: 1/cos(50°−60°) = 1.01543. Constante. Lo que rota al
mover el eje es la dirección del vector, no su tamaño; renormalizar en cada
ángulo haría que II valiese siempre 1,000 —físicamente falso— y explotaría a
150°, donde cos(II) es cero."""

_P_MAGNITUDE: float = 1.0 / math.cos(math.radians(_P_REFERENCE_DEG - _LEAD_II_DEG))
"""Módulo del vector P: 1/cos(53.4°−60°) = 1.00667. Distinto del módulo del QRS: con
una sola magnitud compartida, el II de la proyección auricular saldría 1,009
en vez del 1,000 de la tabla."""

_LIMB_ANGLE_DEG: dict[str, float] = {"I": 0.0, "II": 60.0, "III": 120.0}
"""Ángulos de las tres derivaciones bipolares. Las aumentadas no están aquí:
se derivan de estas por Goldberger, no por coseno directo sobre su ángulo."""

QRS_PRECORDIAL: dict[str, float] = {
    "V1": -0.45, "V2": -0.15, "V3": 0.55, "V4": 1.15, "V5": 1.30, "V6": 0.95,
}
"""Precordiales del QRS. El eje frontal no las gobierna: V1–V6 están en el
plano horizontal y dependen de la rotación horaria, un giro distinto. ST y T
comparten estas mismas precordiales, como hoy al compartir traza con el QRS."""

ATRIAL_PRECORDIAL: dict[str, float] = {
    "V1": 0.40, "V2": 0.50, "V3": 0.45, "V4": 0.40, "V5": 0.35, "V6": 0.30,
}
"""Precordiales de la P."""


def projection_for_axis(
    angle_deg: float, magnitude: float, precordial: Mapping[str, float]
) -> LeadProjection:
    """Proyección de doce derivaciones para un eje frontal dado.

    Las seis derivaciones de miembros salen de `angle_deg` y `magnitude`; las
    seis precordiales son las de `precordial`, que el eje frontal no toca.
    """
    a = math.radians(angle_deg)
    i = magnitude * math.cos(a - math.radians(_LIMB_ANGLE_DEG["I"]))
    ii = magnitude * math.cos(a - math.radians(_LIMB_ANGLE_DEG["II"]))
    iii = magnitude * math.cos(a - math.radians(_LIMB_ANGLE_DEG["III"]))
    mapping = dict(precordial)
    mapping.update(
        {
            "I": i,
            "II": ii,
            "III": iii,
            "aVR": -(i + ii) / 2.0,
            "aVL": (i - iii) / 2.0,
            "aVF": (ii + iii) / 2.0,
        }
    )
    return projection_from_mapping(mapping)


def project(trace_v: np.ndarray, projection: LeadProjection) -> np.ndarray:
    """Expande una traza `(n,)` a `(12, n)` aplicando los coeficientes."""
    trace = np.asarray(trace_v, dtype=np.float64)
    if trace.ndim != 1:
        raise ValueError(f"se esperaba una traza 1-D, recibida {trace.ndim}-D")
    return projection.as_column() * trace[np.newaxis, :]


class AxisZone(str, Enum):
    """Interpretación clínica de un eje frontal. Helper derivado del ángulo,
    nunca un dato almacenado: guardarlo crearía dos fuentes de verdad."""

    NORMAL = "normal"
    LEFT = "left"
    RIGHT = "right"
    EXTREME = "extreme"


def _normalize_deg(deg: float) -> float:
    """Lleva un ángulo cualquiera a (−180, +180]."""
    d = (deg + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def zone_for(deg: float) -> AxisZone:
    """Zona clínica del eje. Normaliza primero: con orientación en +180 y
    offset en +90 el eje efectivo sale a +270, un ángulo válido que sin
    normalizar caería fuera de los cuatro intervalos."""
    a = _normalize_deg(deg)
    if -30.0 <= a <= 90.0:
        return AxisZone.NORMAL
    if -90.0 <= a < -30.0:
        return AxisZone.LEFT
    if 90.0 < a <= 180.0:
        return AxisZone.RIGHT
    return AxisZone.EXTREME  # −180 < a < −90


@dataclass(frozen=True, slots=True)
class LeadProjectionSet:
    """Proyección por onda. La T puede tener eje propio porque cada onda lleva
    su propia `LeadProjection`. Se llama así, y no `ProjectionSet`, porque el
    nombre tiene que seguir teniendo sentido el día de la onda U."""

    p: LeadProjection
    qrs: LeadProjection
    st: LeadProjection
    t: LeadProjection


DEFAULT_PROJECTION_SET: LeadProjectionSet = LeadProjectionSet(
    p=ATRIAL_PROJECTION,
    qrs=NORMAL_AXIS_PROJECTION,
    st=NORMAL_AXIS_PROJECTION,
    t=NORMAL_AXIS_PROJECTION,
)
"""Conjunto por defecto: las tablas históricas literales, clínicamente
validadas y las que fijan los golden signals. La orientación de referencia
usa estas tablas bit a bit; solo un eje desviado se calcula por trigonometría
(ver projection_set_for_axis). Así el eje eléctrico no obliga a regenerar
ningún golden."""


_REFERENCE_AXIS: AxisParams = AxisParams()


def projection_set_for_axis(axis: AxisParams) -> LeadProjectionSet:
    """Construye las cuatro proyecciones desde el eje. El eje efectivo de cada
    onda es `orientation_deg + su desfase`.

    En la orientación de referencia se devuelven las tablas históricas
    literales, bit a bit: son las validadas y las que fijan los golden
    signals, y `projection_for_axis` solo las reproduce dentro de la
    tolerancia del redondeo. Cualquier desviación del eje sí se calcula por
    trigonometría."""
    if axis == _REFERENCE_AXIS:
        return DEFAULT_PROJECTION_SET
    return LeadProjectionSet(
        p=projection_for_axis(
            axis.orientation_deg + axis.p_offset_deg, _P_MAGNITUDE, ATRIAL_PRECORDIAL
        ),
        qrs=projection_for_axis(
            axis.orientation_deg + axis.qrs_offset_deg, _QRS_MAGNITUDE, QRS_PRECORDIAL
        ),
        st=projection_for_axis(
            axis.orientation_deg + axis.st_offset_deg, _QRS_MAGNITUDE, QRS_PRECORDIAL
        ),
        t=projection_for_axis(
            axis.orientation_deg + axis.t_offset_deg, _QRS_MAGNITUDE, QRS_PRECORDIAL
        ),
    )
