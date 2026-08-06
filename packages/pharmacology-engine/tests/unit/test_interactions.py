"""Reglas de interacción."""

from __future__ import annotations

import pytest

from pharmacology_engine import PharmacologyEngine, Route
from pharmacology_engine.interactions import (
    INTERACTION_RULES,
    InteractionRule,
    Participant,
    evaluate,
)
from pharmacology_engine.models import DrugCategory, DrugEffect


def _fired_ids(engine: PharmacologyEngine, t_s: float) -> set[str]:
    _effect, fired = engine.effect_with_interactions(t_s)
    return {f.rule_id for f in fired}


def test_sin_farmacos_no_hay_interacciones() -> None:
    effect, fired = evaluate({})
    assert effect.is_neutral()
    assert fired == ()


def test_un_solo_farmaco_no_dispara_una_regla_de_dos() -> None:
    """La restricción de participantes distintos: una sola amiodarona no
    puede ocupar las dos plazas de una regla."""
    effect, fired = evaluate({"amiodarone": (DrugCategory.ANTIARRHYTHMIC, 1.0)})
    assert effect.is_neutral()
    assert fired == ()


def test_calcioantagonista_y_betabloqueante() -> None:
    engine = PharmacologyEngine()
    engine.administer("verapamil", 5.0, Route.IV, t_s=0.0)
    engine.administer("metoprolol", 5.0, Route.IV, t_s=0.0)
    assert "ccb_beta_blocker_av" in _fired_ids(engine, 300.0)


def test_el_bloqueo_av_combinado_supera_a_la_suma_simple() -> None:
    """La interacción es aditiva sobre lo que ya hacen los dos por su cuenta:
    si no, la regla no estaría aportando nada."""
    solo = PharmacologyEngine()
    solo.administer("verapamil", 5.0, Route.IV, t_s=0.0)
    solo.administer("magnesium_sulfate", 2.0, Route.IV, t_s=0.0)
    combined = PharmacologyEngine()
    combined.administer("verapamil", 5.0, Route.IV, t_s=0.0)
    combined.administer("metoprolol", 5.0, Route.IV, t_s=0.0)
    assert (
        combined.physiology_at(300.0).pr_interval_ms
        > solo.physiology_at(300.0).pr_interval_ms
    )


def test_qt_doblemente_prolongado() -> None:
    engine = PharmacologyEngine()
    engine.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    engine.administer("procainamide", 500.0, Route.IV, t_s=0.0)
    assert "dual_qt_prolongation" in _fired_ids(engine, 900.0)


def test_magnesio_rescata_el_qt() -> None:
    """La única regla que corrige en vez de agravar."""
    without = PharmacologyEngine()
    without.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    with_mg = PharmacologyEngine()
    with_mg.administer("amiodarone", 300.0, Route.IV, t_s=0.0)
    with_mg.administer("magnesium_sulfate", 2.0, Route.IV, t_s=0.0)
    assert "magnesium_rescues_qt" in _fired_ids(with_mg, 600.0)
    assert (
        with_mg.physiology_at(600.0).qt_interval_ms
        < without.physiology_at(600.0).qt_interval_ms
    )


def test_digoxina_potenciada() -> None:
    engine = PharmacologyEngine()
    engine.administer("digoxin", 0.5, Route.IV, t_s=0.0)
    engine.administer("verapamil", 5.0, Route.IV, t_s=0.0)
    assert "digoxin_av_potentiation" in _fired_ids(engine, 2000.0)


def test_el_betabloqueo_atenua_la_atropina() -> None:
    plain = PharmacologyEngine()
    plain.administer("atropine", 1.0, Route.IV, t_s=0.0)
    blocked = PharmacologyEngine()
    blocked.administer("metoprolol", 5.0, Route.IV, t_s=0.0)
    blocked.administer("atropine", 1.0, Route.IV, t_s=0.0)
    assert "beta_blockade_blunts_atropine" in _fired_ids(blocked, 300.0)
    assert (
        blocked.physiology_at(300.0).heart_rate_bpm
        < plain.physiology_at(300.0).heart_rate_bpm
    )


def test_alfa_sin_oposicion() -> None:
    engine = PharmacologyEngine()
    engine.administer("metoprolol", 5.0, Route.IV, t_s=0.0)
    engine.administer("epinephrine", 1.0, Route.IV, t_s=0.0)
    assert "unopposed_alpha" in _fired_ids(engine, 90.0)


def test_la_intensidad_es_la_del_participante_mas_debil() -> None:
    """Con la máxima, una traza residual daría la interacción a plena
    potencia."""
    effect, fired = evaluate(
        {
            "verapamil": (DrugCategory.CALCIUM_BLOCKER, 1.0),
            "metoprolol": (DrugCategory.BETA_BLOCKER, 0.2),
        }
    )
    assert fired[0].intensity == pytest.approx(0.2)
    assert effect.av_conduction == pytest.approx(1.0 + (0.70 - 1.0) * 0.2)


def test_una_regla_no_se_dispara_con_intensidad_cero() -> None:
    _effect, fired = evaluate(
        {
            "verapamil": (DrugCategory.CALCIUM_BLOCKER, 0.0),
            "metoprolol": (DrugCategory.BETA_BLOCKER, 1.0),
        }
    )
    assert fired == ()


def test_las_reglas_declaradas_son_validas() -> None:
    for rule in INTERACTION_RULES:
        assert len(rule.participants) >= 2, rule.rule_id
        assert rule.description, rule.rule_id
        assert not rule.effect.is_neutral(), rule.rule_id


def test_ids_de_regla_unicos() -> None:
    ids = [r.rule_id for r in INTERACTION_RULES]
    assert len(ids) == len(set(ids))


def test_una_regla_necesita_dos_participantes() -> None:
    with pytest.raises(ValueError, match="dos"):
        InteractionRule(
            rule_id="mala",
            description="",
            participants=(Participant(drug_ids=frozenset({"atropine"})),),
            effect=DrugEffect(qt_delta_ms=1.0),
        )


def test_reglas_inyectables() -> None:
    """El catálogo de reglas es un argumento, no un global inevitable: es lo
    que permite testear una regla aislada."""
    rule = InteractionRule(
        rule_id="prueba",
        description="prueba",
        participants=(
            Participant(drug_ids=frozenset({"atropine"})),
            Participant(drug_ids=frozenset({"epinephrine"})),
        ),
        effect=DrugEffect(qt_delta_ms=99.0),
    )
    engine = PharmacologyEngine(rules=(rule,))
    engine.administer("atropine", 1.0, Route.IV, t_s=0.0)
    engine.administer("epinephrine", 1.0, Route.IV, t_s=0.0)
    _effect, fired = engine.effect_with_interactions(90.0)
    assert [f.rule_id for f in fired] == ["prueba"]
