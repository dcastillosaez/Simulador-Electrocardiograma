"""Eventos eléctricos discretos → recorrido del impulso por el sistema de conducción.

Es la tercera línea temporal del corazón, junto a contracciones y válvulas, y
sigue la regla de las válvulas: **el servidor manda los instantes; el cliente,
el viaje**. Aquí se decide cuándo empieza y termina cada tramo y si el impulso
llega; el cliente interpola el pulso dentro de cada tramo y nada más.

Las ventanas salen de la plantilla de cada latido (`target_extent_s`), no de
constantes:

    nodo SA           marca en el inicio de la P
    aurículas         extensión de la P; la izquierda empieza más tarde
    nodo AV           del final de la P al inicio del His
    His               de HV antes del QRS a LB-V antes del QRS
    ramas, Purkinje   de LB-V antes del QRS al inicio del QRS
    miocardio         extensión del QRS
    recuperación      extensión de la T, marcada aparte

El QRS y el PR acotan cada tramo; el reparto dentro de ellos sale del fichero
versionado `data/activation-timing.yaml`, que cita la fuente de cada número.
El nodo AV absorbe el resto del PR, así que un bloqueo de primer grado sale
sin caso especial: su PR es más largo y su nodo AV dura más.

Qué conduce no se decide aquí, sino en la política de conducción del motor de
señal: `BeatBasedSource.events` entrega cada P junto con el QRS que provoca,
aunque ese QRS caiga después del final de la ventana. Una P sin QRS del mismo
índice en la misma llamada es una P bloqueada, y eso se sabe sin mirar al
futuro. Solo vale cuando la política conserva el índice (`pairs_by_index`): en
un bloqueo completo, en una TV o en una FA los QRS se numeran aparte, y
emparejarlos por índice inventaría conducción.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Sequence

import yaml

from ecg_engine.beat import get_template, target_extent_s
from ecg_engine.mechanics import ContractionMode, MechanicalProfile
from ecg_engine.types import CardiacEvent, EventKind, ImpulseOrigin, WaveTarget

logger = logging.getLogger(__name__)

TIMING_FILE = "activation-timing.yaml"


@dataclass(frozen=True, slots=True)
class ActivationTiming:
    """Los números del fichero de tiempos, ya leídos.

    Solo lo que tiene fuente. Lo que no la tiene no tiene campo: el motor usa
    el límite que ya marca el trazado."""

    version: int
    clinical_review: str
    left_atrial_delay_s: float
    hv_interval_s: float
    left_bundle_to_ventricle_s: float


@lru_cache(maxsize=1)
def load_activation_timing() -> ActivationTiming:
    """Lee `data/activation-timing.yaml` del propio paquete."""
    text = resources.files("heart_engine").joinpath("data", TIMING_FILE).read_text(
        encoding="utf-8"
    )
    data = yaml.safe_load(text)
    atria = data["auriculas"]
    his = data["his_purkinje"]
    timing = ActivationTiming(
        version=int(data["version"]),
        clinical_review=str(data["revision_clinica"]),
        left_atrial_delay_s=float(atria["retraso_auricula_izquierda_s"]["valor"]),
        hv_interval_s=float(his["intervalo_hv_s"]["valor"]),
        left_bundle_to_ventricle_s=float(his["rama_izquierda_a_ventriculo_s"]["valor"]),
    )
    if not 0.0 < timing.left_bundle_to_ventricle_s < timing.hv_interval_s:
        raise ValueError(
            "activation-timing.yaml: LB-V tiene que ser positivo y menor que HV"
        )
    return timing


class Structure:
    """Nombres de los tramos, tal como viajan en el contrato."""

    SA_NODE = "sa_node"
    RIGHT_ATRIUM = "right_atrium"
    LEFT_ATRIUM = "left_atrium"
    AV_NODE = "av_node"
    HIS_BUNDLE = "his_bundle"
    BUNDLE_BRANCHES = "bundle_branches"
    PURKINJE = "purkinje"
    VENTRICULAR_MYOCARDIUM = "ventricular_myocardium"
    VENTRICULAR_RECOVERY = "ventricular_recovery"


CONDUCTED = "conducted"
BLOCKED = "blocked"


@dataclass(frozen=True, slots=True)
class Segment:
    structure: str
    t_start_s: float
    t_end_s: float

    def as_payload(self) -> dict:
        return {
            "structure": self.structure,
            "t_start_s": round(self.t_start_s, 3),
            "t_end_s": round(self.t_end_s, 3),
        }


@dataclass(frozen=True, slots=True)
class ElectricalImpulse:
    """Un impulso con todos sus tramos, sin referencias que resolver.

    La identidad es la pareja (`impulse`, época de la fuente), la misma que
    usan contracciones y válvulas. Un impulso auricular y uno de escape pueden
    compartir número —son dos trenes con su propia cuenta—, y por eso el
    cliente añade el origen a la clave.

    `outcome` admite solo `conducted` y `blocked`. No existe «retrasado»: el
    retraso es la duración del tramo AV."""

    impulse: int
    origin: ImpulseOrigin
    outcome: str
    segments: tuple[Segment, ...]
    compressed: bool = False

    def as_payload(self) -> dict:
        return {
            "impulse": self.impulse,
            "origin": self.origin.value,
            "outcome": self.outcome,
            "segments": [segment.as_payload() for segment in self.segments],
        }


def _extent(event: CardiacEvent, target: WaveTarget) -> tuple[float, float]:
    start, end = target_extent_s(get_template(event.template_id), target)
    return event.t_s + start, event.t_s + end


def _atrial_segments(
    p: CardiacEvent, origin: ImpulseOrigin, timing: ActivationTiming
) -> list[Segment]:
    p_on, p_end = _extent(p, WaveTarget.P)
    segments: list[Segment] = []
    if origin is ImpulseOrigin.SINUS:
        # Una marca, no un tramo: el disparo del nodo sinusal no se ve en
        # superficie y no hay fuente para adelantarlo (ver `sin_fuente`).
        segments.append(Segment(Structure.SA_NODE, p_on, p_on))
    segments.append(Segment(Structure.RIGHT_ATRIUM, p_on, p_end))
    left_start = min(p_on + timing.left_atrial_delay_s, p_end)
    segments.append(Segment(Structure.LEFT_ATRIUM, left_start, p_end))
    return segments


def _ventricular_segments(
    qrs: CardiacEvent,
    timing: ActivationTiming,
    av_from_s: float | None,
    through_his: bool,
) -> tuple[list[Segment], bool]:
    """Los tramos de un QRS. `av_from_s` es el final de la onda auricular que
    lo provoca, si la hay: de ahí sale el nodo AV. Devuelve también si hubo
    que comprimir His-Purkinje para que cupiera en el PR."""
    qrs_on, qrs_end = _extent(qrs, WaveTarget.QRS)
    t_on, t_end = _extent(qrs, WaveTarget.T)
    segments: list[Segment] = []
    compressed = False
    if through_his:
        his_start = qrs_on - timing.hv_interval_s
        branches_start = qrs_on - timing.left_bundle_to_ventricle_s
        if av_from_s is not None and his_start < av_from_s:
            # Un PR muy corto no deja sitio a la duración fija de His-Purkinje.
            # Se comprime en proporción y se registra: nunca se adelanta el
            # nodo AV sobre el final de la P sin que quede constancia.
            available = max(0.0, qrs_on - av_from_s)
            factor = available / timing.hv_interval_s
            his_start = qrs_on - available
            branches_start = qrs_on - timing.left_bundle_to_ventricle_s * factor
            compressed = True
        if av_from_s is not None:
            segments.append(Segment(Structure.AV_NODE, av_from_s, his_start))
        segments.append(Segment(Structure.HIS_BUNDLE, his_start, branches_start))
        segments.append(Segment(Structure.BUNDLE_BRANCHES, branches_start, qrs_on))
        segments.append(Segment(Structure.PURKINJE, branches_start, qrs_on))
    segments.append(Segment(Structure.VENTRICULAR_MYOCARDIUM, qrs_on, qrs_end))
    segments.append(Segment(Structure.VENTRICULAR_RECOVERY, t_on, t_end))
    return segments, compressed


@lru_cache(maxsize=64)
def _report_compression(template_pair: tuple[str, str], available_ms: int) -> None:
    """Deja constancia una vez por combinación de plantillas y PR, no una vez
    por latido: el mismo PR corto se repetiría cuatro veces por segundo."""
    logger.info(
        "His-Purkinje comprimido: solo caben %d ms entre el final de la P y el "
        "QRS (plantillas %s)",
        available_ms,
        "/".join(template_pair),
    )


def derive_electrical_impulses(
    events: Sequence[CardiacEvent],
    profile: MechanicalProfile,
    *,
    atrial_origin: ImpulseOrigin,
    pairs_by_index: bool,
    dissociated: bool = False,
    timing: ActivationTiming | None = None,
) -> list[ElectricalImpulse]:
    """Traduce los eventos de una llamada a `events` en impulsos completos.

    - Aurícula organizada (modo síncrono): cada P es un impulso. Si su QRS
      viene en la misma llamada con su mismo índice, conduce y lleva todos los
      tramos; si no, se queda en el nodo AV y sale `blocked`.
    - Aurícula en flutter o fibrilación: su actividad es continua y la
      describe `heart_state`, no este campo. Los QRS sí son impulsos, de origen
      auricular, y cruzan el nodo AV; si la política conserva el índice —el
      flutter—, el tramo AV empieza al final de la onda F que conduce.
    - Un QRS sin onda auricular que lo explique es ventricular: no pasa por el
      His y solo activa el miocardio.

    `pairs_by_index` falso cubre el bloqueo completo, la TV y la FA: ninguna
    P conduce por índice. `dissociated` (`BeatBasedSource.is_dissociated`)
    distingue el bloqueo completo de la FA cuando la aurícula no está
    organizada: en la FA los QRS vienen de arriba; en una disociación, no.
    """
    timing = timing or load_activation_timing()
    atrial_organized = profile.atrial_mode is ContractionMode.SYNCHRONOUS
    atrial_by_index = {e.index: e for e in events if e.kind is EventKind.ATRIAL}
    ventricular = [e for e in events if e.kind is EventKind.VENTRICULAR]
    conducted_by_index = (
        {e.index: e for e in ventricular if e.index in atrial_by_index}
        if pairs_by_index
        else {}
    )

    impulses: list[ElectricalImpulse] = []

    if atrial_organized:
        for p in atrial_by_index.values():
            segments = _atrial_segments(p, atrial_origin, timing)
            qrs = conducted_by_index.get(p.index)
            _, p_end = _extent(p, WaveTarget.P)
            if qrs is None:
                # Llega al nodo AV y ahí se queda: el tramo AV es una marca en
                # el final de la P, sin nada detrás.
                segments.append(Segment(Structure.AV_NODE, p_end, p_end))
                impulses.append(
                    ElectricalImpulse(p.index, atrial_origin, BLOCKED, tuple(segments))
                )
                continue
            more, compressed = _ventricular_segments(qrs, timing, p_end, True)
            if compressed:
                _report_compression(
                    (p.template_id, qrs.template_id),
                    round((_extent(qrs, WaveTarget.QRS)[0] - p_end) * 1000),
                )
            impulses.append(
                ElectricalImpulse(
                    p.index,
                    atrial_origin,
                    CONDUCTED,
                    tuple(segments + more),
                    compressed,
                )
            )

    for qrs in ventricular:
        if atrial_organized and qrs.index in conducted_by_index:
            continue  # ya va dentro del impulso de su P
        from_atria = (
            not atrial_organized
            and not dissociated
            and _atria_drive_ventricles(profile)
        )
        if from_atria:
            f_wave = atrial_by_index.get(qrs.index) if pairs_by_index else None
            av_from = _extent(f_wave, WaveTarget.P)[1] if f_wave is not None else None
            segments, compressed = _ventricular_segments(qrs, timing, av_from, True)
            impulses.append(
                ElectricalImpulse(
                    qrs.index, atrial_origin, CONDUCTED, tuple(segments), compressed
                )
            )
        else:
            segments, _ = _ventricular_segments(qrs, timing, None, False)
            impulses.append(
                ElectricalImpulse(
                    qrs.index, ImpulseOrigin.VENTRICULAR, CONDUCTED, tuple(segments)
                )
            )

    impulses.sort(key=lambda item: (item.segments[0].t_start_s, item.origin.value))
    return impulses


def _atria_drive_ventricles(profile: MechanicalProfile) -> bool:
    """En flutter y fibrilación auricular, la aurícula manda sobre el
    ventrículo a través del nodo AV aunque no se contraiga de forma
    organizada. En una aurícula ausente no hay nada arriba que conduzca."""
    return profile.atrial_mode in (ContractionMode.FLUTTERING, ContractionMode.FIBRILLATING)
