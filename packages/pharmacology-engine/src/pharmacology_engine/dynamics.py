"""Farmacodinamia: de un efecto combinado a un estado fisiológico.

Es el único módulo que sabe cómo se traduce cada campo de `DrugEffect` sobre
el basal del paciente. Ni el catálogo ni el motor lo saben: el YAML declara
«el nodo AV conduce al 65 %» y es aquí, en un solo sitio, donde eso se
convierte en un PR más largo.
"""

from __future__ import annotations

import math

from .models import (
    DrugEffect,
    PhysiologyState,
    clamp_physiology,
)


def _qtc_ms(qt_ms: float, heart_rate_bpm: float) -> float:
    """QT corregido por Bazett, en milisegundos."""
    return qt_ms * math.sqrt(max(heart_rate_bpm, 1.0) / 60.0)


def _qt_from_qtc_ms(qtc_ms: float, heart_rate_bpm: float) -> float:
    return qtc_ms / math.sqrt(max(heart_rate_bpm, 1.0) / 60.0)


def apply_effect(baseline: PhysiologyState, effect: DrugEffect) -> PhysiologyState:
    """Aplica un efecto ya combinado sobre el estado basal.

    Tres decisiones que no son obvias:

    **La frecuencia se multiplica antes de sumar.** `sinus_rate` es una
    ganancia sobre el basal y `heart_rate_delta_bpm` un desplazamiento fijo;
    hacerlo al revés haría que el delta de la atropina se amplificase al
    doble en un paciente taquicárdico.

    **Los intervalos se derivan de la conducción, no la sustituyen.** Un
    multiplicador de conducción de 0.65 alarga el intervalo dividiendo:
    conducir al 65 % de velocidad tarda 1/0.65 del tiempo. El `pr_delta_ms`
    del YAML se suma **después**, para las moléculas cuyo efecto sobre el
    intervalo no se explica solo por la velocidad de conducción.

    **El QT se recalcula por Bazett antes de aplicar su delta.** Si no, la
    atropina —que no toca la repolarización— dejaría un QT de 400 ms a 140
    lpm, que es un QTc de 610 y un hallazgo clínico inexistente. Lo que se
    conserva entre estados es el QTc, no el QT.
    """
    heart_rate = (
        baseline.heart_rate_bpm * effect.sinus_rate + effect.heart_rate_delta_bpm
    )
    sinus_rate = (
        baseline.sinus_rate_bpm * effect.sinus_rate + effect.heart_rate_delta_bpm
    )

    av = baseline.av_conduction * effect.av_conduction
    atrial = baseline.atrial_conduction * effect.atrial_conduction
    ventricular = baseline.ventricular_conduction * effect.ventricular_conduction

    pr = baseline.pr_interval_ms / max(effect.av_conduction, 1e-3) + effect.pr_delta_ms
    qrs = (
        baseline.qrs_duration_ms / max(effect.ventricular_conduction, 1e-3)
        + effect.qrs_delta_ms
    )

    qtc = _qtc_ms(baseline.qt_interval_ms, baseline.heart_rate_bpm)
    qt = _qt_from_qtc_ms(qtc, heart_rate) + effect.qt_delta_ms

    systolic = baseline.systolic_bp_mmhg + effect.blood_pressure_delta_mmhg
    # La diastólica sigue a la sistólica pero no a la par: un inotrópico
    # ensancha la presión de pulso. Dos tercios es la proporción que deja la
    # media aproximadamente donde la deja un vasopresor real.
    diastolic = baseline.diastolic_bp_mmhg + effect.blood_pressure_delta_mmhg * 0.6

    return clamp_physiology(
        PhysiologyState(
            heart_rate_bpm=heart_rate,
            sinus_rate_bpm=sinus_rate,
            automaticity=baseline.automaticity * effect.automaticity,
            av_conduction=av,
            atrial_conduction=atrial,
            ventricular_conduction=ventricular,
            pr_interval_ms=pr,
            qrs_duration_ms=qrs,
            qt_interval_ms=qt,
            axis_deg=baseline.axis_deg + effect.axis_delta_deg,
            st_shift_mv=baseline.st_shift_mv + effect.st_shift_mv,
            t_amplitude=baseline.t_amplitude * effect.t_amplitude,
            contractility=baseline.contractility * effect.contractility,
            stroke_volume_ml=baseline.stroke_volume_ml * effect.stroke_volume,
            systolic_bp_mmhg=systolic,
            diastolic_bp_mmhg=diastolic,
            respiratory_rate_bpm=(
                baseline.respiratory_rate_bpm * effect.respiratory_rate
            ),
            oxygen_consumption=(
                baseline.oxygen_consumption * effect.oxygen_consumption
            ),
        )
    )


def qtc_ms(state: PhysiologyState) -> float:
    """QTc de Bazett del estado, para el panel de constantes."""
    return _qtc_ms(state.qt_interval_ms, state.heart_rate_bpm)
