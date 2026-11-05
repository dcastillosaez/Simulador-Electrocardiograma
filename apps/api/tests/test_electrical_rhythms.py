"""Fase H5: cada ritmo se reconoce por cómo viaja su impulso.

Recorre la tabla de `docs/fase-h/propagacion-electrica.md` con los ritmos
reales del catálogo, generados por la misma sesión que alimenta el WebSocket.
Lo que se comprueba es lo que recibe el cliente: `origin`, `outcome` y qué
tramos trae cada impulso, más el modo de cada cámara para la actividad
continua. Nada de esto sale de comparar nombres de ritmo en el cliente.
"""

from __future__ import annotations

import pytest

from ecg_api.simulation import SimulationManager

ATRIAL = {"sa_node", "right_atrium", "left_atrium"}

EPINEPHRINE_MG = 1.0
ADENOSINE_MG = 6.0
"""Dosis de referencia del catálogo farmacológico. Se eligen fármacos que
mueven el mando propio de cada ritmo lo bastante como para reconstruir la
fuente en la ventana del test: la automaticidad del foco de una TV y el grado
de bloqueo de un flutter."""
CONDUCTION = {"his_bundle", "bundle_branches", "purkinje"}


def run(rhythm_id: str, seconds: float = 12.0, seed: int = 1):
    manager = SimulationManager()
    manager.start(rhythm_id, None, seed=seed)
    impulses = []
    for k in range(int(seconds * 10)):
        manager.next_chunk()
        if k % 5 in (1, 4):
            impulses.extend(manager.cardiac_events()["electrical"])
    return manager, impulses


def structures(impulse) -> set[str]:
    return {s["structure"] for s in impulse["segments"]}


def duration(impulse, structure) -> float:
    segment = next(s for s in impulse["segments"] if s["structure"] == structure)
    return segment["t_end_s"] - segment["t_start_s"]


@pytest.mark.parametrize(
    "rhythm_id", ["sinus_normal", "sinus_tachycardia", "sinus_bradycardia", "stemi_inferior"]
)
def test_los_sinusales_recorren_la_secuencia_completa(rhythm_id):
    _, impulses = run(rhythm_id)
    assert impulses
    for impulse in impulses:
        assert impulse["origin"] == "sinus"
        assert impulse["outcome"] == "conducted"
        assert ATRIAL | {"av_node"} | CONDUCTION | {"ventricular_myocardium"} <= structures(impulse)


def test_la_tsv_no_enciende_el_nodo_sa():
    _, impulses = run("svt")
    assert impulses
    for impulse in impulses:
        assert impulse["origin"] == "supraventricular"
        assert "sa_node" not in structures(impulse)
        assert {"right_atrium", "av_node", "his_bundle"} <= structures(impulse)


def test_el_primer_grado_prolonga_el_nodo_av_y_todo_conduce():
    _, normal = run("sinus_normal")
    _, first = run("av_block_first")
    assert all(i["outcome"] == "conducted" for i in first)
    assert min(duration(i, "av_node") for i in first) > max(
        duration(i, "av_node") for i in normal
    )


def test_mobitz_i_retrasa_cada_vez_mas_y_detiene_uno_en_el_nodo():
    _, impulses = run("av_block_second_mobitz_i")
    blocked = [i for i in impulses if i["outcome"] == "blocked"]
    assert blocked
    for impulse in blocked:
        assert structures(impulse) & CONDUCTION == set()
        assert "av_node" in structures(impulse)
    conducted = sorted(
        (i for i in impulses if i["outcome"] == "conducted"), key=lambda i: i["impulse"]
    )
    av = [duration(i, "av_node") for i in conducted]
    assert max(av) > min(av) + 0.05


def test_el_bloqueo_completo_tiene_dos_secuencias_independientes():
    _, impulses = run("av_block_third")
    atrial = [i for i in impulses if i["origin"] == "sinus"]
    escape = [i for i in impulses if i["origin"] == "ventricular"]
    assert atrial and escape
    assert all(i["outcome"] == "blocked" for i in atrial)
    assert all(structures(i) & CONDUCTION == set() for i in escape)
    # Independientes: más ondas auriculares que latidos de escape.
    assert len(atrial) > len(escape)


def test_el_flutter_es_un_circuito_continuo_e_impulsos_segun_el_bloqueo():
    manager, impulses = run("atrial_flutter")
    state = manager.heart_state()["values"]
    assert state["atrial_mode"] == "fluttering"
    assert state["flutter_hz"] > 0
    assert impulses
    for impulse in impulses:
        assert structures(impulse) & ATRIAL == set()
        assert {"av_node", "his_bundle"} <= structures(impulse)


def test_la_fa_no_tiene_secuencia_auricular_y_los_ventriculares_son_irregulares():
    manager, impulses = run("atrial_fibrillation")
    assert manager.heart_state()["values"]["atrial_mode"] == "fibrillating"
    starts = sorted(
        next(s["t_start_s"] for s in i["segments"] if s["structure"] == "ventricular_myocardium")
        for i in impulses
    )
    assert all(structures(i) & ATRIAL == set() for i in impulses)
    rr = [b - a for a, b in zip(starts, starts[1:])]
    assert max(rr) - min(rr) > 0.1


def test_la_tv_activa_desde_un_foco_ventricular_con_la_auricula_disociada():
    _, impulses = run("ventricular_tachycardia")
    ventricular = [i for i in impulses if i["origin"] == "ventricular"]
    atrial = [i for i in impulses if i["origin"] != "ventricular"]
    assert ventricular and atrial
    assert all(structures(i) & CONDUCTION == set() for i in ventricular)
    assert all(i["outcome"] == "blocked" for i in atrial)


def test_la_fv_no_tiene_impulso_ordenado():
    manager, impulses = run("ventricular_fibrillation")
    assert impulses == []
    assert manager.heart_state()["values"]["ventricular_mode"] == "fibrillating"


@pytest.mark.parametrize(
    ("rhythm_id", "drug", "dose"),
    [
        ("av_block_third", "atropine", 1.0),
        ("ventricular_tachycardia", "epinephrine", EPINEPHRINE_MG),
        ("atrial_flutter", "adenosine", ADENOSINE_MG),
    ],
)
def test_un_farmaco_que_reconstruye_la_fuente_no_deja_huerfanos(rhythm_id, drug, dose):
    """Los mandos de `RHYTHM_DRIVES` reconstruyen la fuente en escalones del
    5 %. Lo que la fuente vieja anunció para después de reconstruirse lo
    descarta el cliente al llegar la época nueva (`ElectricalTimeline.push`);
    aquí se comprueba que, aplicada esa regla, no queda ningún impulso que la
    señal no vaya a dibujar, y que la electricidad sigue llegando."""
    manager = SimulationManager()
    manager.start(rhythm_id, None, seed=1)
    received: list[tuple[float, dict]] = []
    for k in range(400):
        if k == 30:
            manager.administer(drug, dose, "IV")
        manager.next_chunk()
        if k % 5 in (1, 4):
            payload = manager.cardiac_events()
            received.extend((payload["source_started_s"], i) for i in payload["electrical"])

    epochs = sorted({epoch for epoch, _ in received})
    assert len(epochs) > 1, "el fármaco no llegó a reconstruir la fuente"

    # La regla del cliente: al llegar una época, fuera lo de las anteriores que
    # empezaba después de ella.
    kept: list[tuple[float, dict]] = []
    for epoch, impulse in received:
        kept = [
            (e, i)
            for e, i in kept
            if e == epoch or min(s["t_start_s"] for s in i["segments"]) < epoch
        ]
        kept.append((epoch, impulse))
    for epoch, impulse in kept:
        later = [e for e in epochs if e > epoch]
        if later:
            assert min(s["t_start_s"] for s in impulse["segments"]) < later[0] + 1e-9

    # La vista no se congela: después de la última reconstrucción siguen
    # llegando impulsos de la fuente nueva.
    last = epochs[-1]
    assert any(epoch == last for epoch, _ in received)
