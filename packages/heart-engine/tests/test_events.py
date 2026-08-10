import pytest

from ecg_engine.mechanics import (
    NORMAL_PROFILE,
    Chamber,
    ContractionMode,
    MechanicalProfile,
)
from ecg_engine.types import CardiacEvent, EventKind

from heart_engine.events import derive_mechanical_events

RR_S = 60.0 / 72.0


def _atrial(t_s: float, index: int = 0) -> CardiacEvent:
    return CardiacEvent(
        kind=EventKind.ATRIAL, t_s=t_s, template_id="sinus_p", index=index
    )


def _ventricular(t_s: float, index: int = 0) -> CardiacEvent:
    # `normal_qrst`, no `normal`: es el identificador real del catálogo de
    # plantillas. Un id inexistente revienta en `get_template` con un mensaje
    # claro, así que el error se habría visto igual — pero más tarde.
    return CardiacEvent(
        kind=EventKind.VENTRICULAR, t_s=t_s, template_id="normal_qrst", index=index
    )


def test_evento_auricular_produce_contraccion_auricular():
    result = derive_mechanical_events([_atrial(1.0)], NORMAL_PROFILE, RR_S)

    assert len(result) == 1
    assert result[0].chamber is Chamber.ATRIA


def test_la_sistole_auricular_empieza_con_la_onda_p_no_en_su_pico():
    """El pico de la P es el instante de referencia del evento; la
    contracción arranca cuando arranca la onda, antes de ese pico."""
    result = derive_mechanical_events([_atrial(1.0)], NORMAL_PROFILE, RR_S)

    assert result[0].t_start_s < 1.0


def test_la_sistole_auricular_dura_lo_que_dice_el_perfil():
    result = derive_mechanical_events([_atrial(1.0)], NORMAL_PROFILE, RR_S)
    event = result[0]

    # `approx` y no igualdad exacta: la ventana se construye sumando la
    # duración al inicio, y restarla después no devuelve el mismo float. Con
    # `==` este test falla por 1e-17, que no es un defecto de nada.
    duration = event.t_end_s - event.t_start_s
    assert duration == pytest.approx(NORMAL_PROFILE.atrial_systole_s)


def test_la_sistole_ventricular_escala_con_el_intervalo_rr():
    lento = derive_mechanical_events([_ventricular(1.0)], NORMAL_PROFILE, 1.0)
    rapido = derive_mechanical_events([_ventricular(1.0)], NORMAL_PROFILE, 0.4)

    duracion_lenta = lento[0].t_end_s - lento[0].t_start_s
    duracion_rapida = rapido[0].t_end_s - rapido[0].t_start_s
    assert duracion_rapida < duracion_lenta


def test_el_pico_cae_dentro_de_la_ventana():
    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], NORMAL_PROFILE, RR_S
    )

    for event in result:
        assert event.t_start_s < event.t_peak_s < event.t_end_s


def test_la_amplitud_sale_del_perfil():
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.SYNCHRONOUS,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.5,
        ventricular_amplitude=0.7,
    )

    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], profile, RR_S
    )

    por_camara = {event.chamber: event.amplitude for event in result}
    assert por_camara[Chamber.ATRIA] == 0.5
    assert por_camara[Chamber.VENTRICLES] == 0.7


def test_una_camara_fibrilando_no_produce_eventos_discretos():
    """En fibrilación no hay contracción organizada que temporizar: el
    movimiento es temblor continuo, y ese lo genera el cliente a partir del
    modo y la frecuencia, no de eventos."""
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.FIBRILLATING,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.06,
        ventricular_amplitude=1.0,
    )

    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], profile, RR_S
    )

    assert all(event.chamber is Chamber.VENTRICLES for event in result)


def test_una_camara_ausente_no_produce_eventos():
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.ABSENT,
        ventricular_mode=ContractionMode.ABSENT,
        atrial_amplitude=0.0,
        ventricular_amplitude=0.0,
    )

    result = derive_mechanical_events(
        [_atrial(1.0), _ventricular(1.16)], profile, RR_S
    )

    assert result == []


def test_la_disociacion_av_conserva_ambos_trenes_independientes():
    """Un bloqueo completo: cuatro Ps y dos QRS sin relación. Las seis
    contracciones tienen que salir, cada una en su instante."""
    events = [
        _atrial(0.0, 0), _atrial(0.8, 1), _atrial(1.6, 2), _atrial(2.4, 3),
        _ventricular(0.3, 0), _ventricular(1.9, 1),
    ]

    result = derive_mechanical_events(events, NORMAL_PROFILE, 1.6)

    auriculares = [e for e in result if e.chamber is Chamber.ATRIA]
    ventriculares = [e for e in result if e.chamber is Chamber.VENTRICLES]
    assert len(auriculares) == 4
    assert len(ventriculares) == 2


def test_el_resultado_sale_ordenado_por_tiempo_de_inicio():
    events = [_ventricular(2.0), _atrial(1.0), _ventricular(1.16)]

    result = derive_mechanical_events(events, NORMAL_PROFILE, RR_S)

    tiempos = [event.t_start_s for event in result]
    assert tiempos == sorted(tiempos)


def test_se_conserva_el_indice_del_evento_electrico():
    """El cliente deduplica por (cámara, índice): los eventos llegan en
    ventanas que pueden solaparse si un chunk se reenvía."""
    result = derive_mechanical_events([_atrial(1.0, index=42)], NORMAL_PROFILE, RR_S)

    assert result[0].index == 42
