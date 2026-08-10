from ecg_engine.mechanics import NORMAL_PROFILE, ContractionMode, MechanicalProfile

from heart_engine.heart_state import HeartState


def test_recoge_los_modos_del_perfil():
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.FIBRILLATING,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.06,
        ventricular_amplitude=1.0,
    )

    state = HeartState.from_profile(profile, "atrial_fibrillation", 88.0)

    assert state.atrial_mode is ContractionMode.FIBRILLATING
    assert state.ventricular_mode is ContractionMode.SYNCHRONOUS


def test_el_payload_serializa_los_modos_como_texto():
    state = HeartState.from_profile(NORMAL_PROFILE, "sinus_normal", 72.0)

    payload = state.as_payload()

    assert payload["values"]["atrial_mode"] == "synchronous"
    assert payload["values"]["ventricular_mode"] == "synchronous"


def test_el_payload_lleva_el_tipo_del_mensaje():
    state = HeartState.from_profile(NORMAL_PROFILE, "sinus_normal", 72.0)

    assert state.as_payload()["type"] == "heart_state"


def test_el_payload_lleva_las_amplitudes_y_la_frecuencia_de_temblor():
    """El cliente las necesita para animar una cámara que no manda eventos."""
    profile = MechanicalProfile(
        atrial_mode=ContractionMode.FLUTTERING,
        ventricular_mode=ContractionMode.SYNCHRONOUS,
        atrial_amplitude=0.18,
        ventricular_amplitude=1.0,
        flutter_hz=5.0,
    )

    values = HeartState.from_profile(profile, "atrial_flutter", 75.0).as_payload()[
        "values"
    ]

    assert values["atrial_amplitude"] == 0.18
    assert values["flutter_hz"] == 5.0


def test_una_frecuencia_desconocida_viaja_como_null():
    """`None` y no un cero: cero latidos por minuto es una afirmación
    clínica, y aquí lo que pasa es que todavía no se ha medido."""
    state = HeartState.from_profile(NORMAL_PROFILE, "sinus_normal", None)

    assert state.as_payload()["values"]["heart_rate_bpm"] is None
