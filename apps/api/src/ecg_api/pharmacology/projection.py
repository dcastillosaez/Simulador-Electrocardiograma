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
Al motor de señal le llegan la frecuencia y el eje y, en los ritmos con
mandos propios, la sinusal, la automaticidad y la conducción AV traducidas a
esos mandos (`RHYTHM_DRIVES`, y la aurícula, el escape y el grado de bloqueo
de un paciente inventado). El resto —PR, QRS, QT, contractilidad, presión—
viaja por el canal JSON de farmacología hacia el panel de constantes y el
corazón 3D.

Eso no es una carencia del diseño de la Fase F sino su consecuencia
deliberada: la fase se implementa **sin modificar el EcgEngine**. El día que
el motor de señal acepte intervalos, la ampliación consiste en añadir
líneas a `project` y en ningún otro sitio.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, replace

from ecg_engine import EngineParams
from ecg_engine.catalog import get_rhythm
from ecg_engine.mechanics import ContractionMode, MechanicalProfile
from ecg_engine.patient import MAX_RATE_BPM, AvConduction, PatientSpec
from pharmacology_engine import PatientBaseline, PhysiologyState

#: Constantes del adulto sano, para los ejes que ni el catálogo de ritmos ni
#: `EngineParams` declaran. No son configurables todavía: la Fase F2, con
#: sus casos clínicos, es la que traerá pacientes con basales propios.
DEFAULT_PR_MS = 160.0
DEFAULT_QRS_MS = 90.0
DEFAULT_QT_MS = 400.0

#: Paso al que se redondea el efecto de un fármaco sobre un mando del ritmo.
#: Los mandos de un flutter o de un bloqueo completo son estructurales: cada
#: cambio reconstruye la fuente, y un efecto que se movía de forma continua la
#: reconstruiría en cada chunk. En escalones del 5 % un fármaco atraviesa unas
#: pocas transiciones —las mismas que si el operador moviera el mando— y un
#: efecto despreciable deja el mando exactamente donde estaba.
DRIVE_FACTOR_STEP = 0.05


@dataclass(frozen=True, slots=True)
class RhythmDrive:
    """Qué mando de un ritmo mueve cada eje del estado farmacológico.

    En los ritmos que se manejan con `heart_rate_hz` el fármaco llega por la
    frecuencia. En los que declaran sus propios mandos, esa frecuencia la
    calcula el motor a partir de ellos y un `heart_rate_hz` proyectado no
    llegaba a ningún sitio: el panel decía 63 y el trazado seguía en 35. Aquí
    se declara, ritmo a ritmo, por dónde entra cada efecto:

    * `sinus`: el mando que sigue a la frecuencia sinusal.
    * `automaticity`: los mandos de focos que escalan con la automaticidad.
    * `conduction_ratio`: el grado de bloqueo, que crece cuando el nodo AV
      conduce peor.

    Lo que no se nombra no se toca: la atropina no acelera el escape de un
    bloqueo completo, y nada de esto mueve la aurícula de un flutter.
    """

    sinus: str | None = None
    automaticity: tuple[str, ...] = ()
    conduction_ratio: str | None = None


RHYTHM_DRIVES: Mapping[str, RhythmDrive] = {
    "atrial_flutter": RhythmDrive(conduction_ratio="conduction_ratio"),
    "ventricular_tachycardia": RhythmDrive(automaticity=("ventricular_rate_hz",)),
    "av_block_third": RhythmDrive(
        sinus="atrial_rate_hz", automaticity=("escape_rate_hz",)
    ),
}


@dataclass(frozen=True, slots=True)
class _Factors:
    """El efecto del fármaco como cociente sobre el basal, ya en escalones."""

    sinus: float
    automaticity: float
    av_conduction: float


def _ratio(value: float, base: float) -> float:
    return value / base if base > 0.0 else 1.0


def _step(factor: float) -> float:
    return round(factor / DRIVE_FACTOR_STEP) * DRIVE_FACTOR_STEP


def _factors(state: PhysiologyState, baseline: PhysiologyState) -> _Factors:
    return _Factors(
        sinus=_step(_ratio(state.sinus_rate_bpm, baseline.sinus_rate_bpm)),
        automaticity=_step(_ratio(state.automaticity, baseline.automaticity)),
        # El grado de bloqueo es entero, así que no necesita escalón propio.
        av_conduction=_ratio(state.av_conduction, baseline.av_conduction),
    )


def _blocked_ratio(ratio: float, av_factor: float) -> int:
    """Un nodo que conduce peor deja pasar menos: 2:1 pasa a 3:1 y a 4:1.

    El 1:1 nunca sale de aquí —un fármaco que acelere el nodo deja el 2:1
    donde estaba—; el techo lo pone el rango que declare cada ritmo.
    """
    # Mitad hacia arriba y no `round`, que redondea al par: un nodo al 80 %
    # sobre un 2:1 da 2,5, y con `round` se quedaba en 2.
    return max(2, math.floor(ratio / max(av_factor, 1e-3) + 0.5))


def _rhythm_value(rhythm_id: str, rhythm: Mapping[str, float], name: str) -> float:
    if name in rhythm:
        return float(rhythm[name])
    return get_rhythm(rhythm_id).rhythm_parameters[name].default


def _drive_for(rhythm_id: str | None) -> RhythmDrive | None:
    return RHYTHM_DRIVES.get(rhythm_id) if rhythm_id is not None else None


def _driven_rhythm(
    rhythm_id: str | None, rhythm: Mapping[str, float], factors: _Factors
) -> Mapping[str, float]:
    drive = _drive_for(rhythm_id)
    if drive is None:
        return rhythm
    assert rhythm_id is not None
    driven = dict(rhythm)
    if drive.sinus is not None:
        driven[drive.sinus] = (
            _rhythm_value(rhythm_id, rhythm, drive.sinus) * factors.sinus
        )
    for name in drive.automaticity:
        driven[name] = _rhythm_value(rhythm_id, rhythm, name) * factors.automaticity
    if drive.conduction_ratio is not None:
        driven[drive.conduction_ratio] = float(
            _blocked_ratio(
                _rhythm_value(rhythm_id, rhythm, drive.conduction_ratio),
                factors.av_conduction,
            )
        )
    return driven


def _driven_patient(patient: PatientSpec, factors: _Factors) -> PatientSpec:
    """Un paciente inventado responde como su fisiología: la aurícula sigue
    a la sinusal, el escape a la automaticidad y un bloqueo de grado fijo a
    la conducción AV. Una aurícula o un escape apagados siguen apagados: un
    fármaco no crea un marcapasos que el paciente no tiene."""

    def rate(bpm: float, factor: float) -> float:
        return min(bpm * factor, MAX_RATE_BPM) if bpm > 0.0 else bpm

    ratio = patient.conduction_ratio
    if patient.av_conduction is AvConduction.RATIO:
        ratio = min(_blocked_ratio(ratio, factors.av_conduction), max(ratio, 4))
    return replace(
        patient,
        atrial_rate_bpm=rate(patient.atrial_rate_bpm, factors.sinus),
        escape_rate_bpm=rate(patient.escape_rate_bpm, factors.automaticity),
        conduction_ratio=ratio,
    )


def engine_sinus_bpm(params: EngineParams, rhythm_id: str | None) -> float | None:
    """La sinusal que el motor de señal está generando, si el ritmo la tiene
    como mando propio. `None` cuando la sinusal no es un mando: entonces la
    del estado farmacológico ya es la que se ve."""
    if params.patient is not None:
        return params.patient.atrial_rate_bpm
    drive = _drive_for(rhythm_id)
    if drive is not None and drive.sinus is not None:
        assert rhythm_id is not None
        return _rhythm_value(rhythm_id, params.rhythm, drive.sinus) * 60.0
    return None


def engine_pulse_bpm(params: EngineParams, rhythm_id: str | None) -> float:
    """El pulso que el motor de señal está generando.

    Casi siempre es la frecuencia de mando. En un Mobitz I no: el mando es la
    sinusal y una de cada cuatro P no conduce, y publicar el mando calculaba el
    gasto cardíaco con 75 latidos sobre un trazado que da 56. La proporción la
    declara el catálogo, y un ritmo sin latidos perdidos da 1 exacto.
    """
    pulse_bpm = params.heart_rate_hz * 60.0
    if rhythm_id is None or params.patient is not None:
        return pulse_bpm
    definition = get_rhythm(rhythm_id)
    commanded_hz = definition.default_parameters["heart_rate_hz"]
    if commanded_hz <= 0.0:
        return pulse_bpm
    return pulse_bpm * definition.ventricular_rate_hz / commanded_hz


def _basal_sinus_bpm(params: EngineParams, rhythm_id: str | None) -> float:
    """La sinusal del paciente sin fármacos.

    En un bloqueo completo no es la de mando —que es el escape— sino el mando
    de su aurícula. Tomar el escape como sinusal hacía que la atropina
    calculara su efecto sobre 35 lpm en vez de sobre 75.
    """
    sinus = engine_sinus_bpm(params, rhythm_id)
    return sinus if sinus is not None else params.heart_rate_hz * 60.0

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
    params: EngineParams,
    vitals: PatientVitals | None = None,
    rhythm_id: str | None = None,
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
            sinus_rate_bpm=_basal_sinus_bpm(params, rhythm_id),
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


def project(
    params: EngineParams,
    state: PhysiologyState,
    *,
    rhythm_id: str | None = None,
    baseline: PhysiologyState | None = None,
) -> EngineParams:
    """Parámetros del motor de señal para un estado fisiológico dado.

    `params` son los de mando: de ellos se conservan intactos el ruido y la
    variabilidad, que describen la medición y no al paciente, y los desfases
    de eje por onda y los mandos propios del ritmo, que describen el ritmo.
    Se sobreescriben la frecuencia y la orientación del eje.

    Con `baseline`, además, los mandos que `RHYTHM_DRIVES` declara para el
    ritmo y la aurícula, el escape y el grado de bloqueo de un paciente
    inventado: en esos el pulso lo calcula el motor a partir de los mandos, y
    la frecuencia proyectada sola no llegaba al trazado.
    """
    rhythm = params.rhythm
    patient = params.patient
    if baseline is not None:
        factors = _factors(state, baseline)
        rhythm = _driven_rhythm(rhythm_id, rhythm, factors)
        if patient is not None:
            patient = _driven_patient(patient, factors)
    return EngineParams(
        heart_rate_hz=state.heart_rate_bpm / 60.0,
        noise=params.noise,
        variability=params.variability,
        axis=replace(params.axis, orientation_deg=state.axis_deg),
        # Los mandos propios del ritmo tampoco son farmacología. Un mapa vacío
        # el motor lo lee como «valores de catálogo» y reconstruye la fuente:
        # cualquier fármaco devolvía un flutter 4:1 a 2:1 y un escape de 35 a
        # 40 sin que nadie tocara un control.
        rhythm=rhythm,
        # La descripción del paciente no es un efecto farmacológico: la
        # adrenalina cambia su frecuencia, no lo convierte en otra persona.
        # Sin esto, la primera dosis borraría el paciente inventado y el
        # motor volvería a un sinusal de catálogo.
        patient=patient,
    )
