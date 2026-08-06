"""El contrato que cumple toda molécula del catálogo.

Un `DrugModel` no sabe qué es un ECG, ni un corazón 3D, ni una interfaz.
Solo sabe describir su propia cinética y qué efecto fisiológico produce a
la dosis de referencia. Todo lo demás —cómo se superpone con otros, cómo se
proyecta sobre el motor de señal— vive fuera.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..kinetics import ConcentrationCurve
from ..models import DrugCategory, DrugEffect, Route, scale


@dataclass(frozen=True)
class DrugModel:
    """Una molécula, cargada desde su YAML.

    `effect` es el efecto **a la dosis de referencia**, no a cualquier
    dosis. La escala por dosis y por concentración la hace `effect_at`, para
    que el YAML declare un solo juego de números —los de la dosis que un
    clínico reconoce— y no una tabla dosis-respuesta que nadie mantendría.
    """

    drug_id: str
    display_name: str
    category: DrugCategory
    routes: tuple[Route, ...]
    dose_unit: str
    reference_dose: float
    max_cumulative_dose: float
    onset_s: float
    peak_s: float
    duration_s: float
    half_life_s: float
    effect: DrugEffect
    clinical_note: str = ""
    references: tuple[str, ...] = field(default=())

    # Derivada, no declarada en el YAML. Va fuera de `__init__` y fuera de la
    # comparación: dos modelos con los mismos tiempos tienen por fuerza la
    # misma curva, y compararla sería comparar dos veces lo mismo.
    curve: ConcentrationCurve = field(
        init=False, repr=False, compare=False, default=None  # type: ignore[assignment]
    )

    def __post_init__(self) -> None:
        if self.reference_dose <= 0.0:
            raise ValueError(
                f"{self.drug_id}: reference_dose debe ser positiva"
            )
        if self.max_cumulative_dose < self.reference_dose:
            raise ValueError(
                f"{self.drug_id}: max_cumulative_dose "
                f"({self.max_cumulative_dose}) por debajo de la dosis de "
                f"referencia ({self.reference_dose})"
            )
        if not self.routes:
            raise ValueError(f"{self.drug_id}: sin vías de administración")
        # Construir la curva aquí y no en cada llamada valida los tiempos en
        # el momento de cargar el catálogo: un YAML con el pico antes del
        # inicio falla al arrancar la API, no a mitad de una sesión.
        object.__setattr__(
            self,
            "curve",
            ConcentrationCurve(
                onset_s=self.onset_s,
                peak_s=self.peak_s,
                duration_s=self.duration_s,
                half_life_s=self.half_life_s,
            ),
        )

    @property
    def max_intensity(self) -> float:
        """Techo de acumulación, en múltiplos de la dosis de referencia."""
        return self.max_cumulative_dose / self.reference_dose

    def dose_ratio(self, dose: float) -> float:
        return dose / self.reference_dose

    def effect_at(self, intensity: float) -> DrugEffect:
        """Efecto para una intensidad ya combinada (dosis × concentración)."""
        return scale(self.effect, min(intensity, self.max_intensity))

    def allows(self, route: Route) -> bool:
        return route in self.routes

    def as_dict(self) -> dict:
        return {
            "drug_id": self.drug_id,
            "display_name": self.display_name,
            "category": self.category.value,
            "routes": [r.value for r in self.routes],
            "dose_unit": self.dose_unit,
            "reference_dose": self.reference_dose,
            "max_cumulative_dose": self.max_cumulative_dose,
            "onset_s": self.onset_s,
            "peak_s": self.peak_s,
            "duration_s": self.duration_s,
            "half_life_s": self.half_life_s,
            "clinical_note": self.clinical_note,
            "references": list(self.references),
        }
