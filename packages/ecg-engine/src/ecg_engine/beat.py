"""Plantillas morfológicas de latido.

Las plantillas son morfología pura: no saben nada de frecuencia ni de ritmo.
Hay dos familias, y esa separación es lo que sostiene el modelo de dos trenes:

- Auriculares (`sinus_p`, `flutter_f`): solo componentes P.
- Ventriculares (`normal_qrst`, `wide_qrst`, `escape_qrst`): QRS, ST y T.

Todos los `center_s` son relativos al instante de referencia del evento: el
pico de la P en las auriculares, el pico de la R en las ventriculares.

Amplitudes en voltios. Un ECG normal tiene una R de en torno a 1 mV en II,
es decir 0,001 V.
"""

from __future__ import annotations

from .types import BeatTemplate, GaussianComponent, WaveTarget

_SIGMA_EXTENT: float = 2.0
"""Cuántas desviaciones típicas a cada lado se consideran parte de la onda."""


def _p(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.P, amplitude_v=amplitude_v, center_s=center_s, width_s=width_s
    )


def _qrs(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.QRS,
        amplitude_v=amplitude_v,
        center_s=center_s,
        width_s=width_s,
    )


def _st(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.ST,
        amplitude_v=amplitude_v,
        center_s=center_s,
        width_s=width_s,
    )


def _t(amplitude_v: float, center_s: float, width_s: float) -> GaussianComponent:
    return GaussianComponent(
        target=WaveTarget.T, amplitude_v=amplitude_v, center_s=center_s, width_s=width_s
    )


TEMPLATES: dict[str, BeatTemplate] = {
    # --- Auriculares -------------------------------------------------------
    "sinus_p": BeatTemplate(
        template_id="sinus_p",
        components=(_p(0.00012, 0.0, 0.011),),
    ),
    # Onda F de flutter: más amplia y puntiaguda, sin línea isoeléctrica
    # entre ondas cuando el tren va a 300/min.
    "flutter_f": BeatTemplate(
        template_id="flutter_f",
        components=(_p(0.00020, 0.0, 0.018),),
    ),
    # --- Ventriculares -----------------------------------------------------
    "normal_qrst": BeatTemplate(
        template_id="normal_qrst",
        components=(
            _qrs(-0.00005, -0.019, 0.0090),   # Q
            _qrs(0.00100, 0.000, 0.0170),     # R
            _qrs(-0.00015, 0.021, 0.0115),    # S
            _st(0.00000, 0.090, 0.0300),      # segmento ST, isoeléctrico
            _t(0.00025, 0.230, 0.0444),       # T
        ),
    ),
    # QRS ancho de origen ventricular: R ensanchada y T de polaridad opuesta.
    "wide_qrst": BeatTemplate(
        template_id="wide_qrst",
        components=(
            _qrs(0.00110, 0.000, 0.0310),
            _st(0.00000, 0.110, 0.0350),
            _t(-0.00030, 0.280, 0.0520),
        ),
    ),
    # Escape ventricular del bloqueo completo: ancho y de menor voltaje.
    "escape_qrst": BeatTemplate(
        template_id="escape_qrst",
        components=(
            _qrs(0.00080, 0.000, 0.0260),
            _st(0.00000, 0.120, 0.0350),
            _t(-0.00022, 0.300, 0.0550),
        ),
    ),
}


def get_template(template_id: str) -> BeatTemplate:
    try:
        return TEMPLATES[template_id]
    except KeyError as exc:
        known = ", ".join(sorted(TEMPLATES))
        raise KeyError(
            f"plantilla desconocida: {template_id!r}. Conocidas: {known}"
        ) from exc


def target_extent_s(
    template: BeatTemplate, target: WaveTarget
) -> tuple[float, float]:
    """Extensión temporal de un target, a ±2σ, relativa al evento."""
    components = template.components_for(target)
    if not components:
        return (0.0, 0.0)
    start = min(c.center_s - _SIGMA_EXTENT * c.width_s for c in components)
    end = max(c.center_s + _SIGMA_EXTENT * c.width_s for c in components)
    return (start, end)


def qrs_duration_s(template: BeatTemplate) -> float:
    start, end = target_extent_s(template, WaveTarget.QRS)
    return end - start


def qt_duration_s(template: BeatTemplate) -> float:
    """Del inicio del QRS al final de la T."""
    qrs_start, _ = target_extent_s(template, WaveTarget.QRS)
    _, t_end = target_extent_s(template, WaveTarget.T)
    return t_end - qrs_start
