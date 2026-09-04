import pytest

from ecg_engine.mechanics import (
    NORMAL_PROFILE,
    Chamber,
    ContractionMode,
    MechanicalProfile,
)
from ecg_engine.types import CardiacEvent, EventKind

from heart_engine.events import MechanicalEvent, derive_mechanical_events
from heart_engine.valves import MAX_ISOVOLUMETRIC_FRACTION, derive_valve_events

RR_S = 60.0 / 72.0


def _ventricular_contraction(
    t_start_s: float = 1.0, duration_s: float = 0.33, index: int = 0
) -> MechanicalEvent:
    return MechanicalEvent(
        chamber=Chamber.VENTRICLES,
        t_start_s=t_start_s,
        t_peak_s=t_start_s + duration_s * 0.45,
        t_end_s=t_start_s + duration_s,
        amplitude=1.0,
        index=index,
    )


def _atrial_contraction(t_start_s: float = 0.8) -> MechanicalEvent:
    return MechanicalEvent(
        chamber=Chamber.ATRIA,
        t_start_s=t_start_s,
        t_peak_s=t_start_s + 0.05,
        t_end_s=t_start_s + 0.11,
        amplitude=1.0,
        index=0,
    )


def test_los_cuatro_instantes_van_en_orden():
    (valve,) = derive_valve_events([_ventricular_contraction()], NORMAL_PROFILE)

    assert (
        valve.t_close_av_s
        < valve.t_open_semilunar_s
        < valve.t_close_semilunar_s
        < valve.t_open_av_s
    )


def test_las_auriculoventriculares_se_cierran_al_empezar_la_sistole():
    """El primer ruido cardíaco es el cierre de la mitral y la tricúspide, y
    ocurre cuando el ventrículo empieza a contraerse — no antes."""
    contraction = _ventricular_contraction(t_start_s=2.5)

    (valve,) = derive_valve_events([contraction], NORMAL_PROFILE)

    assert valve.t_close_av_s == contraction.t_start_s


def test_las_sigmoideas_se_cierran_al_acabar_la_sistole():
    contraction = _ventricular_contraction(t_start_s=2.5)

    (valve,) = derive_valve_events([contraction], NORMAL_PROFILE)

    assert valve.t_close_semilunar_s == contraction.t_end_s


def test_hay_una_fase_con_las_cuatro_cerradas_antes_de_expulsar():
    """Contracción isovolumétrica: el ventrículo se contrae con las cuatro
    válvulas cerradas hasta vencer la presión arterial. Sin ella la sangre
    saldría en el mismo instante en que empieza el latido."""
    (valve,) = derive_valve_events([_ventricular_contraction()], NORMAL_PROFILE)

    duracion = valve.t_open_semilunar_s - valve.t_close_av_s

    assert duracion == pytest.approx(NORMAL_PROFILE.isovolumetric_contraction_s)


def test_hay_una_fase_con_las_cuatro_cerradas_antes_de_llenar():
    """Relajación isovolumétrica: la sístole ha terminado pero el ventrículo
    todavía no se llena, porque su presión sigue por encima de la auricular."""
    (valve,) = derive_valve_events([_ventricular_contraction()], NORMAL_PROFILE)

    duracion = valve.t_open_av_s - valve.t_close_semilunar_s

    assert duracion == pytest.approx(NORMAL_PROFILE.isovolumetric_relaxation_s)


def test_la_fase_isovolumetrica_no_se_come_la_eyeccion_en_taquicardia():
    """A 250 lpm la sístole dura 96 ms y los 50 ms de contracción
    isovolumétrica serían más de la mitad. El tope garantiza que siempre queda
    eyección que enseñar."""
    corta = _ventricular_contraction(duration_s=0.096)

    (valve,) = derive_valve_events([corta], NORMAL_PROFILE)

    isovolumetrica = valve.t_open_semilunar_s - valve.t_close_av_s
    assert isovolumetrica < NORMAL_PROFILE.isovolumetric_contraction_s
    assert isovolumetrica == pytest.approx(0.096 * MAX_ISOVOLUMETRIC_FRACTION)
    assert valve.t_open_semilunar_s < valve.t_close_semilunar_s


def test_la_sistole_auricular_no_mueve_ninguna_valvula():
    """Las auriculoventriculares ya están abiertas cuando la aurícula se
    contrae: remata el llenado, no lo inicia."""
    assert derive_valve_events([_atrial_contraction()], NORMAL_PROFILE) == []


def test_un_ventriculo_que_fibrila_no_produce_coreografia():
    """Sin sístole organizada no hay presión que cierre nada. La lista vacía
    es la respuesta, no un caso especial que el cliente tenga que tratar."""
    perfil = MechanicalProfile(
        atrial_mode=ContractionMode.FIBRILLATING,
        ventricular_mode=ContractionMode.FIBRILLATING,
        atrial_amplitude=0.05,
        ventricular_amplitude=0.1,
    )
    events = [
        CardiacEvent(
            kind=EventKind.VENTRICULAR, t_s=1.0, template_id="normal_qrst", index=0
        )
    ]

    mechanical = derive_mechanical_events(events, perfil, RR_S)

    assert derive_valve_events(mechanical, perfil) == []


def test_el_indice_del_latido_viaja_con_la_coreografia():
    """Es la clave con la que el cliente deduplica: los mensajes se solapan en
    el tiempo y el mismo latido llega más de una vez."""
    (valve,) = derive_valve_events([_ventricular_contraction(index=7)], NORMAL_PROFILE)

    assert valve.index == 7


def test_cada_latido_trae_su_coreografia():
    contractions = [
        _ventricular_contraction(t_start_s=1.0, index=0),
        _ventricular_contraction(t_start_s=1.83, index=1),
    ]

    result = derive_valve_events(contractions, NORMAL_PROFILE)

    assert [valve.index for valve in result] == [0, 1]
    assert result[0].t_open_av_s < result[1].t_close_av_s


def test_el_payload_redondea_a_milisegundos():
    (valve,) = derive_valve_events([_ventricular_contraction(t_start_s=1.23456)], NORMAL_PROFILE)

    payload = valve.as_payload()

    assert payload["t_close_av_s"] == 1.235
    assert set(payload) == {
        "t_close_av_s",
        "t_open_semilunar_s",
        "t_close_semilunar_s",
        "t_open_av_s",
        "index",
    }
