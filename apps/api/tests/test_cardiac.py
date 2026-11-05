import pytest

from ecg_api.simulation import SimulationManager


def test_sin_sesion_no_hay_eventos():
    manager = SimulationManager()

    assert manager.cardiac_events() is None
    assert manager.heart_state() is None


def test_una_sesion_sinusal_produce_contracciones():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    # Cuatro segundos de señal: a 72 lpm son unas cinco contracciones.
    for _ in range(40):
        manager.next_chunk()

    payload = manager.cardiac_events()

    assert payload["type"] == "cardiac_events"
    assert len(payload["events"]) > 0


def test_los_eventos_no_se_repiten_entre_llamadas():
    """La ventana avanza: lo que ya se publicó no vuelve a salir. Sin esto,
    cada mensaje reenviaría toda la sesión y el ancho de banda crecería sin
    límite."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()
    primeros = manager.cardiac_events()["events"]

    for _ in range(40):
        manager.next_chunk()
    segundos = manager.cardiac_events()["events"]

    inicios_primeros = {e["t_start_s"] for e in primeros}
    inicios_segundos = {e["t_start_s"] for e in segundos}
    assert inicios_primeros.isdisjoint(inicios_segundos)


def test_los_eventos_publicados_son_de_senal_ya_generada():
    """La invariante que garantiza que lleguen a tiempo: nunca se mira al
    futuro."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    payload = manager.cardiac_events()

    for event in payload["events"]:
        assert event["t_start_s"] <= manager.duration_s


def test_la_fibrilacion_ventricular_no_produce_eventos_pero_si_estado():
    """Su fuente no implementa `events`. No es un fallo: una FV no tiene
    latidos que enumerar. El temblor lo anima el cliente desde el estado."""
    manager = SimulationManager()
    manager.start("ventricular_fibrillation", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    assert manager.cardiac_events()["events"] == []
    assert manager.heart_state()["values"]["ventricular_mode"] == "fibrillating"


def test_el_estado_lleva_el_ritmo_activo():
    manager = SimulationManager()
    manager.start("atrial_fibrillation", None, seed=1)

    values = manager.heart_state()["values"]

    assert values["rhythm_id"] == "atrial_fibrillation"
    assert values["atrial_mode"] == "fibrillating"


def test_arrancar_otro_ritmo_reinicia_la_ventana_de_publicacion():
    """Un `start` nuevo arranca un eje de tiempo nuevo. Sin reinicio, la
    marca de agua vieja se comería los primeros latidos del ritmo nuevo."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()
    manager.cardiac_events()

    manager.start("sinus_bradycardia", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    assert len(manager.cardiac_events()["events"]) > 0


def test_el_payload_declara_su_ventana():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(20):
        manager.next_chunk()

    payload = manager.cardiac_events()

    assert payload["t_start_s"] == 0.0
    assert payload["t_end_s"] == pytest.approx(manager.duration_s)


def test_cada_contraccion_ventricular_lleva_su_coreografia_valvular():
    """Las válvulas viajan en el mismo mensaje que las contracciones. Si
    llegaran por separado podrían desparejarse y el corazón latiría con las
    válvulas del latido anterior."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    payload = manager.cardiac_events()

    ventriculares = [e for e in payload["events"] if e["chamber"] == "ventricles"]
    assert len(payload["valves"]) == len(ventriculares)
    assert {v["index"] for v in payload["valves"]} == {e["index"] for e in ventriculares}


def test_los_cuatro_instantes_valvulares_van_en_orden():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    for valve in manager.cardiac_events()["valves"]:
        assert (
            valve["t_close_av_s"]
            < valve["t_open_semilunar_s"]
            < valve["t_close_semilunar_s"]
            < valve["t_open_av_s"]
        )


def test_las_auriculoventriculares_se_cierran_con_la_sistole_ventricular():
    """La sincronía con el trazado sale de aquí: el instante en que se cierra
    la mitral es el mismo en que arranca la contracción del ventrículo, que a
    su vez arranca con el QRS."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(40):
        manager.next_chunk()
    payload = manager.cardiac_events()

    sistoles = {
        e["index"]: e["t_start_s"]
        for e in payload["events"]
        if e["chamber"] == "ventricles"
    }
    for valve in payload["valves"]:
        assert valve["t_close_av_s"] == sistoles[valve["index"]]


def test_una_fibrilacion_ventricular_no_mueve_ninguna_valvula():
    """Sin sístole organizada no hay presión que cierre nada. Con la lista
    vacía el cliente deja las auriculoventriculares abiertas y las sigmoideas
    cerradas, que es la posición de reposo."""
    manager = SimulationManager()
    manager.start("ventricular_fibrillation", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    assert manager.cardiac_events()["valves"] == []


def test_una_fibrilacion_auricular_no_altera_las_valvulas():
    """La sístole auricular remata el llenado con las auriculoventriculares ya
    abiertas: perderla no cambia un solo instante valvular."""
    manager = SimulationManager()
    manager.start("atrial_fibrillation", None, seed=1)
    for _ in range(40):
        manager.next_chunk()

    payload = manager.cardiac_events()

    assert len(payload["valves"]) > 0


# --- electricidad (fase H2) -------------------------------------------------

from ecg_engine.catalog import RHYTHM_IDS
from ecg_engine.renderer import RENDER_MARGIN_S

from ecg_api.cardiac import ELECTRICAL_LOOKAHEAD_S

MIN_BUFFER_S = 0.3
"""`FrameBuffer.minS` del cliente: por debajo, la reproducción se detiene."""


def _run(manager: SimulationManager, chunks: int, every: tuple[int, ...] = (1, 4)):
    """Avanza el motor a trozos de 100 ms y publica como `stream_cardiac`,
    unas cuatro veces por segundo. Devuelve cada mensaje con el instante de
    generación en que salió."""
    out = []
    for k in range(chunks):
        manager.next_chunk()
        if k % 5 in every:
            out.append((manager.duration_s, manager.cardiac_events()))
    return out


def test_el_mensaje_cardiaco_lleva_la_electricidad():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    payloads = _run(manager, 40)
    impulses = [i for _, p in payloads for i in p["electrical"]]
    assert impulses
    first = impulses[0]
    assert set(first) == {"impulse", "origin", "outcome", "segments"}
    assert first["origin"] == "sinus"
    assert first["outcome"] == "conducted"
    assert first["segments"][0]["structure"] == "sa_node"


def test_la_anticipacion_cabe_en_lo_que_el_motor_ya_fijo():
    assert 0 < ELECTRICAL_LOOKAHEAD_S < RENDER_MARGIN_S


@pytest.mark.parametrize("rhythm_id", [r for r in RHYTHM_IDS if r != "custom_patient"])
def test_ningun_tramo_llega_despues_de_empezar_a_reproducirse(rhythm_id):
    """Con el buffer del cliente en su mínimo, la cabeza de reproducción va
    `minS` por detrás de lo generado. Cada impulso tiene que llegar antes de
    que la cabeza alcance su primer tramo."""
    manager = SimulationManager()
    manager.start(rhythm_id, None, seed=1)
    for generated_s, payload in _run(manager, 300):
        for impulse in payload["electrical"]:
            first = min(s["t_start_s"] for s in impulse["segments"])
            assert first >= generated_s - MIN_BUFFER_S, (rhythm_id, impulse)


@pytest.mark.parametrize("rhythm_id", ["sinus_normal", "av_block_second_mobitz_i", "atrial_fibrillation", "av_block_third"])
def test_lo_anunciado_es_lo_que_se_dibuja(rhythm_id):
    """Los impulsos publicados por adelantado son los de los eventos que la
    señal acaba dibujando: ni uno de más ni uno de menos."""
    manager = SimulationManager()
    manager.start(rhythm_id, None, seed=1)
    published = sorted(
        (i["origin"], i["impulse"], i["segments"][0]["t_start_s"])
        for _, p in _run(manager, 100)
        for i in p["electrical"]
    )
    horizon = manager._electrical_published_until_s  # noqa: SLF001
    from heart_engine import derive_electrical_impulses
    from ecg_engine.catalog import get_rhythm

    definition = get_rhythm(rhythm_id)
    source = manager._engine.source  # noqa: SLF001
    expected = sorted(
        (i.origin.value, i.impulse, round(i.segments[0].t_start_s, 3))
        for i in derive_electrical_impulses(
            source.events(0.0, horizon),
            definition.mechanical_profile,
            atrial_origin=definition.atrial_origin,
            pairs_by_index=source.pairs_by_index,
            dissociated=source.is_dissociated,
        )
    )
    assert published == expected


def test_los_impulsos_no_se_repiten_entre_mensajes():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    keys = [
        (i["origin"], i["impulse"]) for _, p in _run(manager, 100) for i in p["electrical"]
    ]
    assert len(keys) == len(set(keys))


def test_en_pausa_no_se_publica_electricidad_nueva():
    """`stream_cardiac` no llama en pausa; y sin señal nueva tampoco hay nada
    que publicar aunque alguien llamara."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    _run(manager, 30)
    manager.cardiac_events()
    again = manager.cardiac_events()
    assert again["electrical"] == []


def test_cambiar_de_ritmo_reinicia_la_electricidad():
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    _run(manager, 50)
    manager.start("av_block_third", None, seed=1)
    payloads = _run(manager, 30)
    origins = {i["origin"] for _, p in payloads for i in p["electrical"]}
    assert "ventricular" in origins
    first = min(
        s["t_start_s"] for _, p in payloads for i in p["electrical"] for s in i["segments"]
    )
    assert first < 2.0  # el reloj nuevo empieza en cero


def test_una_aurícula_en_flutter_publica_impulsos_aunque_no_se_contraiga():
    manager = SimulationManager()
    manager.start("atrial_flutter", None, seed=1)
    payloads = _run(manager, 40)
    assert any(p["electrical"] for _, p in payloads)


def test_el_estado_del_corazon_lleva_su_instante():
    """Fase H3: el repaso guarda el estado como tramos constantes en el
    tiempo, y para eso cada publicación dice a qué instante corresponde."""
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed=1)
    for _ in range(10):
        manager.next_chunk()
    state = manager.heart_state()
    assert state["t_s"] == pytest.approx(manager.duration_s, abs=1e-3)
