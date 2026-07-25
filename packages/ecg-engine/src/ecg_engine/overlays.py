"""Overlays morfológicos.

Un overlay modifica **morfología**, nunca ritmo: no crea, elimina ni reordena
eventos cardíacos. Si algo necesita cambiar cuándo late el corazón, eso es
una política de conducción o una fuente de ritmo.

Cada overlay declara explícitamente su alcance —qué componentes toca y en qué
derivaciones— y el motor lo hace cumplir. Un overlay que intente modificar
algo fuera de sus `targets` declarados es un error de construcción, no un
aviso: sin esa barrera, un overlay de isquemia acabaría alterando de rebote
la onda P y ese bug sería endiabladamente difícil de localizar, porque el
trazo seguiría pareciendo plausible.

El IAM con elevación del ST no es un ritmo: es sinusal normal más este
overlay. Ese patrón es el que servirá en fase 2 para pericarditis,
hiperpotasemia e hipopotasemia.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .types import LEAD_ORDER, N_LEADS, GaussianComponent, WaveTarget


class OverlayScopeError(ValueError):
    """Un overlay intentó modificar algo fuera de sus targets declarados."""


@dataclass(frozen=True, slots=True)
class OverlayRule:
    """Contribución aditiva a un componente del latido."""

    target: WaveTarget
    amplitude_v: float
    center_s: float
    width_s: float


@dataclass(frozen=True, slots=True)
class MorphologyOverlay:
    """Modificación morfológica de alcance declarado y verificado."""

    overlay_id: str
    targets: frozenset[WaveTarget]
    leads: tuple[str, ...]
    rules: tuple[OverlayRule, ...]

    def __post_init__(self) -> None:
        if not self.leads:
            raise ValueError(
                f"el overlay {self.overlay_id!r} debe declarar al menos una "
                "derivación"
            )
        unknown = sorted(set(self.leads) - set(LEAD_ORDER))
        if unknown:
            raise ValueError(
                f"el overlay {self.overlay_id!r} declara derivaciones "
                f"desconocidas: {', '.join(unknown)}"
            )
        out_of_scope = sorted(
            {r.target.value for r in self.rules if r.target not in self.targets}
        )
        if out_of_scope:
            declared = ", ".join(sorted(t.value for t in self.targets))
            raise OverlayScopeError(
                f"el overlay {self.overlay_id!r} declara targets [{declared}] "
                f"pero tiene reglas sobre [{', '.join(out_of_scope)}]"
            )

    def components(self) -> tuple[GaussianComponent, ...]:
        return tuple(
            GaussianComponent(
                target=rule.target,
                amplitude_v=rule.amplitude_v,
                center_s=rule.center_s,
                width_s=rule.width_s,
            )
            for rule in self.rules
        )

    def lead_mask(self) -> np.ndarray:
        """Máscara `(12, 1)` con 1,0 en las derivaciones afectadas."""
        mask = np.zeros((N_LEADS, 1), dtype=np.float64)
        for lead in self.leads:
            mask[LEAD_ORDER.index(lead), 0] = 1.0
        return mask


# IAM inferior: elevación del ST en II, III y aVF. 0,2 mV son 2 mm a la
# calibración estándar, muy por encima del umbral diagnóstico de 1 mm.
ST_ELEVATION_INFERIOR: MorphologyOverlay = MorphologyOverlay(
    overlay_id="st_elevation_inferior",
    targets=frozenset({WaveTarget.ST}),
    leads=("II", "III", "aVF"),
    rules=(
        OverlayRule(
            target=WaveTarget.ST, amplitude_v=0.00020, center_s=0.090, width_s=0.045
        ),
    ),
)

OVERLAYS: dict[str, MorphologyOverlay] = {
    ST_ELEVATION_INFERIOR.overlay_id: ST_ELEVATION_INFERIOR,
}


def get_overlay(overlay_id: str) -> MorphologyOverlay:
    try:
        return OVERLAYS[overlay_id]
    except KeyError as exc:
        known = ", ".join(sorted(OVERLAYS)) or "(ninguno)"
        raise KeyError(
            f"overlay desconocido: {overlay_id!r}. Conocidos: {known}"
        ) from exc
