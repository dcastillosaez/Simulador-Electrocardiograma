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
