"""Capa de farmacología de la API.

Envuelve `pharmacology_engine` con lo que necesita una sesión de red:
proyección al motor de señal y serialización del estado. No añade
fisiología propia — si un número clínico se calcula aquí, está en el sitio
equivocado.
"""

from __future__ import annotations

from .projection import baseline_from_params, project
from .service import PharmacologySession

__all__ = ["PharmacologySession", "baseline_from_params", "project"]
