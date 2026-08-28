"""La frontera entre los dos motores.

Este módulo es el **único** punto del sistema donde un `PhysiologyState` se
convierte en `EngineParams`. Ni el motor de ECG conoce la farmacología, ni
el motor farmacológico conoce el ECG: los dos se ignoran y aquí, en
cincuenta líneas, se traduce lo que el primero necesita del segundo.

Dos direcciones:

* `baseline_from_params` toma lo que el usuario manda desde la interfaz —
  frecuencia y eje— y construye el paciente **sin fármacos**.
* `project` toma el estado fisiológico ya medicado y devuelve los
  parámetros con los que el motor de señal debe generar.

Lo que hoy no viaja
-------------------
`EngineParams` acepta frecuencia, eje, ruido y variabilidad. No acepta un
PR, ni un QRS, ni un ST. Así que de todo lo que la farmacología calcula,
al motor de señal solo le llegan la frecuencia y el eje; el resto —PR, QRS,
QT, conducción AV, contractilidad, presión— viaja por el canal JSON de
farmacología hacia el panel de constantes y, cuando exista, hacia el
corazón 3D.

Eso no es una carencia del diseño de la Fase F sino su consecuencia
deliberada: la fase se implementa **sin modificar el EcgEngine**. El día que
el motor de señal acepte intervalos, la ampliación consiste en añadir
líneas a `project` y en ningún otro sitio.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ecg_engine import EngineParams
from ecg_engine.mechanics import ContractionMode, MechanicalProfile
from pharmacology_engine import PatientBaseline, PhysiologyState

#: Constantes del adulto sano, para los ejes que ni el catálogo de ritmos ni
#: `EngineParams` declaran. No son configurables todavía: la Fase F2, con
#: sus casos clínicos, es la que traerá pacientes con basales propios.
DEFAULT_PR_MS = 160.0
DEFAULT_QRS_MS = 90.0
DEFAULT_QT_MS = 400.0


@dataclass(frozen=True, slots=True)
class PatientVitals:
    """Las constantes de un paciente inventado.

    No están en `PatientSpec` porque no son eléctricas: el motor de señal no
    sabe qué es una tensión arterial y no debería. Viajan en el mismo objeto
    que el resto del paciente por el cable —para quien configura, todo esto
    es «el paciente»— y se separan aquí, que es la frontera entre los dos
    motores.
    """

    systolic_bp_mmhg: float = 120.0
    diastolic_bp_mmhg: float = 75.0
    respiratory_rate_bpm: float = 14.0
    stroke_volume_ml: float = 70.0


def baseline_from_params(
    params: EngineParams, vitals: PatientVitals | None = None
) -> PatientBaseline:
    """El paciente antes de cualquier fármaco, tal y como lo manda la UI.

    La frecuencia basal es la **de mando** (`heart_rate_hz`), no el pulso
    ventricular del ritmo. Es lo correcto porque es esa misma frecuencia la
    que devuelve `project`: si el basal se tomara del pulso, un bloqueo AV
    completo entraría a 40 y saldría mandando 40 a un nodo sinusal que iba a
    75, y el ritmo cambiaría solo por conectar la farmacología.

    Con un paciente inventado, los intervalos del basal son los suyos y no
    los del adulto sano: si el editor dice PR de 280 ms, el panel de
    constantes tiene que decir lo mismo desde el primer segundo, sin esperar
    a que la primera medida sobre la señal lo confirme.
    """
    resolved = vitals if vitals is not None else PatientVitals()
    patient = params.patient
    return PatientBaseline(
        state=PhysiologyState(
            heart_rate_bpm=params.heart_rate_hz * 60.0,
            sinus_rate_bpm=(
                patient.atrial_rate_bpm
                if patient is not None
                else params.heart_rate_hz * 60.0
            ),
            pr_interval_ms=patient.pr_ms if patient is not None else DEFAULT_PR_MS,
            qrs_duration_ms=(
                patient.qrs_ms if patient is not None else DEFAULT_QRS_MS
            ),
            qt_interval_ms=patient.qt_ms if patient is not None else DEFAULT_QT_MS,
            axis_deg=params.axis.orientation_deg,
            systolic_bp_mmhg=resolved.systolic_bp_mmhg,
            diastolic_bp_mmhg=resolved.diastolic_bp_mmhg,
            respiratory_rate_bpm=resolved.respiratory_rate_bpm,
            stroke_volume_ml=resolved.stroke_volume_ml,
        )
    )


def circulation_adjusted(
    state: PhysiologyState, profile: MechanicalProfile
) -> PhysiologyState:
    """El estado fisiológico corregido por lo que el ritmo hace mecánicamente.

    La farmacología calcula tensión, gasto y respiración a partir del
    paciente y de lo que lleva puesto; no sabe qué ritmo está corriendo. En
    una fibrilación ventricular eso publicaba 120/75 y 14 rpm sobre un
    trazado de parada cardíaca: la cifra estaba bien calculada y describía a
    alguien que no era este paciente.

    El hecho que manda aquí ya está declarado en el catálogo —el perfil
    mecánico del ritmo— y solo se mira la cámara que expulsa. En una
    fibrilación **auricular** la aurícula no bombea pero el ventrículo sí, y
    hay pulso, tensión y gasto: por eso la condición no es «alguna cámara
    desorganizada» sino «el ventrículo no expulsa».

    Se aplica al publicar y no al calcular. El estado interno sigue siendo el
    que la farmacología dice, porque es sobre él sobre el que actúa el
    siguiente fármaco: en una parada se administra adrenalina y tiene que
    seguir habiendo un paciente al que empujar. Lo que aquí se corrige es lo
    que se enseña en pantalla.
    """
    if profile.ventricular_mode is ContractionMode.SYNCHRONOUS:
        return state
    # Sin sístole ventricular organizada no sale sangre: ni volumen, ni
    # presión, ni pulso. Y sin circulación no hay respiración eficaz — el
    # boqueo agónico de una parada no es una frecuencia respiratoria.
    # `cardiac_output_l_min` y `mean_bp_mmhg` son derivados y caen solos.
    return replace(
        state,
        heart_rate_bpm=0.0,
        stroke_volume_ml=0.0,
        systolic_bp_mmhg=0.0,
        diastolic_bp_mmhg=0.0,
        respiratory_rate_bpm=0.0,
    )


def project(params: EngineParams, state: PhysiologyState) -> EngineParams:
    """Parámetros del motor de señal para un estado fisiológico dado.

    `params` son los de mando: de ellos se conservan intactos el ruido y la
    variabilidad, que describen la medición y no al paciente, y los desfases
    de eje por onda, que describen el ritmo. Solo se sobreescriben la
    frecuencia y la orientación del eje, que son lo único fisiológico que
    `EngineParams` sabe representar.
    """
    return EngineParams(
        heart_rate_hz=state.heart_rate_bpm / 60.0,
        noise=params.noise,
        variability=params.variability,
        axis=replace(params.axis, orientation_deg=state.axis_deg),
        # La descripción del paciente no es un efecto farmacológico: la
        # adrenalina cambia su frecuencia, no lo convierte en otra persona.
        # Sin esto, la primera dosis borraría el paciente inventado y el
        # motor volvería a un sinusal de catálogo.
        patient=params.patient,
    )
