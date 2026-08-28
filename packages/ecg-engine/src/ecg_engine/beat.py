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

from .custom_beat import custom_template, is_custom
from .types import BeatTemplate, GaussianComponent, WaveTarget

_SIGMA_EXTENT: float = 2.5
"""Cuántas desviaciones típicas a cada lado se consideran parte de la onda.

A ±2,5σ una gaussiana ha caído al 4,4 % de su pico, que es aproximadamente
donde el ojo clínico sitúa el inicio y el final de una onda sobre el papel.
Con ±2σ la extensión se queda corta y los intervalos medidos salen por debajo
del rango fisiológico aunque la morfología sea correcta.
"""


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
    # Onda f de fibrilación auricular: mucho menor que la F del flutter, que
    # es lo que las distingue en el papel. Su irregularidad no está aquí sino
    # en el tren que las emite: son las ondas las que llegan a destiempo, no
    # su forma la que cambia.
    "af_f": BeatTemplate(
        template_id="af_f",
        components=(_p(0.00007, 0.0, 0.013),),
    ),
    # --- Ventriculares -----------------------------------------------------
    # Las posiciones de Q y S importan tanto como sus anchuras: en un ECG real
    # la Q cae unos 26 ms antes del pico de la R y la S unos 28 ms después.
    # Acercarlas comprime el QRS por debajo del rango fisiológico por mucho que
    # se ensanchen las ondas, y ensancharlas para compensar produce un complejo
    # gordo y redondeado que ya no parece un latido normal.
    "normal_qrst": BeatTemplate(
        template_id="normal_qrst",
        components=(
            _qrs(-0.00005, -0.026, 0.0055),   # Q
            _qrs(0.00100, 0.000, 0.0090),     # R
            _qrs(-0.00015, 0.028, 0.0075),    # S
            _st(0.00000, 0.090, 0.0300),      # segmento ST, isoeléctrico
            _t(0.00025, 0.2525, 0.0430),      # T
        ),
    ),
    # QRS ancho de origen ventricular: R ensanchada y T de polaridad opuesta.
    "wide_qrst": BeatTemplate(
        template_id="wide_qrst",
        components=(
            _qrs(0.00110, 0.000, 0.0290),
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
    # Las plantillas a medida no están en el diccionario: se reconstruyen del
    # identificador, que es donde vive su especificación. Ver `custom_beat`.
    if is_custom(template_id):
        return custom_template(template_id)
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
    """Extensión temporal de un target, a ±2,5σ, relativa al evento."""
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
