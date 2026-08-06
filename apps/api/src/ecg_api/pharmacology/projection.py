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

from dataclasses import replace

from ecg_engine import EngineParams
from pharmacology_engine import PatientBaseline, PhysiologyState

#: Constantes del adulto sano, para los ejes que ni el catálogo de ritmos ni
#: `EngineParams` declaran. No son configurables todavía: la Fase F2, con
#: sus casos clínicos, es la que traerá pacientes con basales propios.
DEFAULT_PR_MS = 160.0
DEFAULT_QRS_MS = 90.0
DEFAULT_QT_MS = 400.0


def baseline_from_params(params: EngineParams) -> PatientBaseline:
    """El paciente antes de cualquier fármaco, tal y como lo manda la UI.

    La frecuencia basal es la **de mando** (`heart_rate_hz`), no el pulso
    ventricular del ritmo. Es lo correcto porque es esa misma frecuencia la
    que devuelve `project`: si el basal se tomara del pulso, un bloqueo AV
    completo entraría a 40 y saldría mandando 40 a un nodo sinusal que iba a
    75, y el ritmo cambiaría solo por conectar la farmacología.
    """
    return PatientBaseline(
        state=PhysiologyState(
            heart_rate_bpm=params.heart_rate_hz * 60.0,
            sinus_rate_bpm=params.heart_rate_hz * 60.0,
            pr_interval_ms=DEFAULT_PR_MS,
            qrs_duration_ms=DEFAULT_QRS_MS,
            qt_interval_ms=DEFAULT_QT_MS,
            axis_deg=params.axis.orientation_deg,
        )
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
    )
