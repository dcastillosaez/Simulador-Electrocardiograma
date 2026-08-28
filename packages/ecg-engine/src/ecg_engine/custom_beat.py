"""Plantillas de latido con intervalos a medida.

Las doce plantillas de `beat.py` son morfologías fijas, cada una con su QRS y
su QT: son las que necesitan los ritmos del catálogo, donde los intervalos
son un hecho del ritmo y no una preferencia. El paciente personalizado
invierte esa relación —el usuario dice «QRS de 140 ms, QT de 480»— y para eso
hace falta construir la morfología a partir del número pedido.

**El identificador ES la especificación.** Un evento cardíaco lleva un
`template_id` de texto y el renderer, las medidas y los golden lo resuelven
por ese texto contra un registro. Para una plantilla que nace de cuatro
números había dos caminos: registrarla al vuelo en el diccionario global —un
registro mutable que crece con cada movimiento de un deslizador y que
convierte el motor en algo con memoria— o escribir los números dentro del
propio identificador y reconstruirla al resolverlo. Es lo segundo:

    custom:v;qrs=140.0;qt=480.0;st=0.10;t=-1.0

Nada que registrar, nada que limpiar, y dos motores que reciban el mismo
evento producen la misma onda sin haberse puesto de acuerdo. Un golden que
guarde ese identificador sigue significando exactamente lo mismo dentro de un
año.

Lo que se escala y lo que no
----------------------------
El QRS se escala en el tiempo: sus gaussianas conservan la forma y se
estiran o comprimen juntas. La T no se escala, se **mueve**: alargar un QT no
ensancha la onda T, la aleja: ese es el hallazgo de una hipocalcemia, y una T
estirada sería otra cosa.

Por encima de 120 ms la base deja de ser el complejo estrecho y pasa a ser el
ancho de origen ventricular. Un QRS ancho no es un QRS normal estirado: tiene
otra morfología —R empastada, sin Q ni S diferenciadas, T de polaridad
opuesta— y estirar el estrecho produciría un dibujo que no existe en ningún
paciente.
"""

from __future__ import annotations

from functools import lru_cache

from .types import BeatTemplate, GaussianComponent, WaveTarget

CUSTOM_PREFIX: str = "custom:"

VENTRICULAR_KIND: str = "v"
ATRIAL_KIND: str = "a"

WIDE_QRS_THRESHOLD_MS: float = 120.0
"""A partir de aquí el complejo se dibuja como ventricular.

120 ms es la frontera clínica del QRS ancho, la misma que separa un bloqueo
de rama de una conducción normal. Que el umbral de dibujo y el umbral
diagnóstico sean el mismo número no es casualidad: si difirieran, habría
complejos que se miden anchos y se ven estrechos.
"""

MIN_QRS_MS: float = 60.0
MAX_QRS_MS: float = 220.0
MIN_QT_MS: float = 240.0
MAX_QT_MS: float = 700.0
"""Los mismos límites que `PHYSIOLOGY_BOUNDS` pone a la farmacología. Un
paciente inventado puede ser todo lo enfermo que haga falta, pero sigue
siendo un paciente."""


def _rounded(value: float) -> float:
    """Un decimal. El identificador tiene que ser estable como texto: dos
    especificaciones que solo difieran en el bit dieciséis de un flotante son
    la misma plantilla, y deben producir la misma cadena."""
    return round(float(value), 1)


def custom_ventricular_id(
    *,
    qrs_ms: float,
    qt_ms: float,
    st_shift_mv: float = 0.0,
    t_scale: float = 1.0,
) -> str:
    """Identificador canónico de un complejo ventricular a medida."""
    return (
        f"{CUSTOM_PREFIX}{VENTRICULAR_KIND};"
        f"qrs={_rounded(qrs_ms)};"
        f"qt={_rounded(qt_ms)};"
        f"st={_rounded(st_shift_mv)};"
        f"t={_rounded(t_scale)}"
    )


def custom_atrial_id(*, p_scale: float = 1.0) -> str:
    """Identificador canónico de una onda P a medida.

    Una sola magnitud: la amplitud, relativa a la P sinusal. Aplanarla es lo
    que hace una hiperpotasemia y anularla es no tener onda P; nada de eso
    necesita más parámetros.
    """
    return f"{CUSTOM_PREFIX}{ATRIAL_KIND};p={_rounded(p_scale)}"


def is_custom(template_id: str) -> bool:
    return template_id.startswith(CUSTOM_PREFIX)


def _parse(template_id: str) -> tuple[str, dict[str, float]]:
    body = template_id[len(CUSTOM_PREFIX) :]
    kind, _, rest = body.partition(";")
    fields: dict[str, float] = {}
    for chunk in rest.split(";"):
        if not chunk:
            continue
        name, _, raw = chunk.partition("=")
        try:
            fields[name] = float(raw)
        except ValueError as exc:
            raise KeyError(
                f"plantilla a medida ilegible: {template_id!r} (campo {name!r})"
            ) from exc
    return kind, fields


# La base de cada morfología, tomada de `beat.py` a través de `get_template`
# para no duplicar números clínicos en dos sitios. El import va dentro de la
# función porque `beat` importa este módulo: es el precio de que
# `get_template` sea la única puerta de entrada a las plantillas.
def _base_template(qrs_ms: float) -> BeatTemplate:
    from .beat import get_template

    if qrs_ms >= WIDE_QRS_THRESHOLD_MS:
        return get_template("wide_qrst")
    return get_template("normal_qrst")


def _scaled_components(
    components: tuple[GaussianComponent, ...], factor: float
) -> tuple[GaussianComponent, ...]:
    """Estira o comprime en el tiempo, conservando amplitud y forma."""
    return tuple(
        GaussianComponent(
            target=c.target,
            amplitude_v=c.amplitude_v,
            center_s=c.center_s * factor,
            width_s=c.width_s * factor,
        )
        for c in components
    )


@lru_cache(maxsize=512)
def custom_template(template_id: str) -> BeatTemplate:
    """Reconstruye la plantilla que describe el identificador.

    Cacheada porque el renderer la pide una vez por latido y por trozo: sin
    caché, una tira de diez segundos reconstruiría la misma morfología unas
    doce veces por nada. La caché es pura —misma entrada, misma salida— así
    que no introduce estado observable.
    """
    from .beat import target_extent_s

    kind, fields = _parse(template_id)

    if kind == ATRIAL_KIND:
        from .beat import get_template

        base = get_template("sinus_p")
        scale = fields.get("p", 1.0)
        return BeatTemplate(
            template_id=template_id,
            components=tuple(
                GaussianComponent(
                    target=c.target,
                    amplitude_v=c.amplitude_v * scale,
                    center_s=c.center_s,
                    width_s=c.width_s,
                )
                for c in base.components
            ),
        )

    if kind != VENTRICULAR_KIND:
        raise KeyError(f"plantilla a medida de tipo desconocido: {template_id!r}")

    qrs_ms = fields["qrs"]
    qt_ms = fields["qt"]
    st_shift_v = fields.get("st", 0.0) / 1000.0
    t_scale = fields.get("t", 1.0)

    base = _base_template(qrs_ms)
    qrs_start_s, qrs_end_s = target_extent_s(base, WaveTarget.QRS)
    factor = (qrs_ms / 1000.0) / (qrs_end_s - qrs_start_s)

    qrs = _scaled_components(base.components_for(WaveTarget.QRS), factor)
    new_qrs_start_s = qrs_start_s * factor
    new_qrs_end_s = qrs_end_s * factor

    # La T se traslada hasta que el final de su falda caiga exactamente en el
    # QT pedido. Su anchura no se toca: el QT largo de una hipocalcemia alarga
    # el segmento ST, no la onda.
    t_base = base.components_for(WaveTarget.T)
    _, t_end_s = target_extent_s(base, WaveTarget.T)
    t_target_end_s = new_qrs_start_s + qt_ms / 1000.0
    t_shift_s = t_target_end_s - t_end_s
    t = tuple(
        GaussianComponent(
            target=c.target,
            amplitude_v=c.amplitude_v * t_scale,
            center_s=c.center_s + t_shift_s,
            width_s=c.width_s,
        )
        for c in t_base
    )

    # El ST ocupa lo que queda entre el final del QRS y el pie de la T, que es
    # justo lo que se mide al buscar una elevación. Se centra ahí en vez de
    # heredar la posición de la plantilla base: con un QT movido, esa posición
    # dejaría la elevación pintada encima de la T.
    t_foot_s = min((c.center_s - 2.5 * c.width_s for c in t), default=new_qrs_end_s)
    st_center_s = (new_qrs_end_s + t_foot_s) / 2.0
    st_width_s = max((t_foot_s - new_qrs_end_s) / 2.0, 0.01)
    st = (
        GaussianComponent(
            target=WaveTarget.ST,
            amplitude_v=st_shift_v,
            center_s=st_center_s,
            width_s=st_width_s,
        ),
    )

    return BeatTemplate(template_id=template_id, components=qrs + st + t)
