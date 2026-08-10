import pytest

from ecg_engine.catalog import RHYTHM_IDS, get_rhythm
from ecg_engine.mechanics import Chamber, ContractionMode, MechanicalProfile


def test_todo_ritmo_del_catalogo_declara_su_perfil_mecanico():
    """Sin excepciones: un ritmo sin perfil obligaría al corazón 3D a
    inventarse su mecánica, que es justo lo que el diseño prohíbe."""
    for rhythm_id in RHYTHM_IDS:
        profile = get_rhythm(rhythm_id).mechanical_profile
        assert isinstance(profile, MechanicalProfile)


def test_fibrilacion_auricular_no_tiene_sistole_auricular_efectiva():
    profile = get_rhythm("atrial_fibrillation").mechanical_profile
    assert profile.atrial_mode is ContractionMode.FIBRILLATING
    assert profile.atrial_amplitude < 0.15


def test_fibrilacion_ventricular_no_tiene_sistole():
    profile = get_rhythm("ventricular_fibrillation").mechanical_profile
    assert profile.ventricular_mode is ContractionMode.FIBRILLATING
    assert profile.ventricular_amplitude < 0.15


def test_bloqueo_completo_conserva_ambas_contracciones():
    """La disociación AV no anula ninguna cámara: ambas laten, cada una a lo
    suyo. Es precisamente lo que el corazón 3D hace visible."""
    profile = get_rhythm("av_block_third").mechanical_profile
    assert profile.atrial_mode is ContractionMode.SYNCHRONOUS
    assert profile.ventricular_mode is ContractionMode.SYNCHRONOUS


def test_amplitudes_en_rango_unitario():
    for rhythm_id in RHYTHM_IDS:
        profile = get_rhythm(rhythm_id).mechanical_profile
        assert 0.0 <= profile.atrial_amplitude <= 1.0
        assert 0.0 <= profile.ventricular_amplitude <= 1.0


def test_duraciones_positivas():
    for rhythm_id in RHYTHM_IDS:
        profile = get_rhythm(rhythm_id).mechanical_profile
        assert profile.atrial_systole_s > 0
        assert 0.0 < profile.ventricular_systole_fraction <= 1.0


@pytest.mark.parametrize("chamber", list(Chamber))
def test_chamber_serializa_como_texto(chamber):
    """Viaja por JSON: el valor tiene que ser el texto, no el nombre."""
    assert isinstance(chamber.value, str)
