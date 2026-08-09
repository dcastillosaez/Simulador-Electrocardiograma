"""Persistencia del registro de administraciones.

Requiere Postgres real: `docker compose up -d db` antes de ejecutar.
"""

import pytest
from sqlalchemy import select

import pharmacology_engine
from ecg_api.config import Settings
from ecg_api.db.models import DrugAdministrationRow, SessionRow
from ecg_api.db.seed import seed_catalog
from ecg_api.persistence import persist_session, should_persist
from ecg_api.simulation import SimulationManager


async def _seeded_manager(db_session, seed: int = 20260806):
    settings = Settings(_env_file=None, engine_commit="8c4b92f")
    await seed_catalog(db_session, settings)  # la FK exige la fila del ritmo
    manager = SimulationManager()
    manager.start("sinus_normal", None, seed)
    return manager, settings


async def test_administrations_are_written_with_the_session(db_session):
    manager, settings = await _seeded_manager(db_session)
    for _ in range(50):  # 5,0 s simulados
        manager.next_chunk()
    manager.administer("amiodarone", 300.0, "IV", operator="dra. ruiz", notes="TV")
    for _ in range(50):
        manager.next_chunk()
    manager.stop()

    await persist_session(db_session, manager, settings)

    rows = (
        (
            await db_session.execute(
                select(DrugAdministrationRow).where(
                    DrugAdministrationRow.session_id == manager.session_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.drug_id == "amiodarone"
    assert float(row.dose) == pytest.approx(300.0)
    assert row.dose_unit == "mg"
    assert row.route == "IV"
    assert float(row.t_s) == pytest.approx(5.0)
    assert row.operator == "dra. ruiz"
    assert row.notes == "TV"


async def test_the_session_records_the_pharmacology_version(db_session):
    """Sin ella, un replay futuro no puede saber si la curva de
    concentración con la que corrió la sesión es la que tiene delante."""
    manager, settings = await _seeded_manager(db_session)
    for _ in range(50):
        manager.next_chunk()
    manager.stop()
    await persist_session(db_session, manager, settings)

    row = (
        await db_session.execute(
            select(SessionRow).where(SessionRow.id == manager.session_id)
        )
    ).scalar_one()
    assert row.pharmacology_semver == pharmacology_engine.__version__


async def test_a_session_without_drugs_writes_no_administrations(db_session):
    manager, settings = await _seeded_manager(db_session)
    for _ in range(50):
        manager.next_chunk()
    manager.stop()
    await persist_session(db_session, manager, settings)

    rows = (
        (
            await db_session.execute(
                select(DrugAdministrationRow).where(
                    DrugAdministrationRow.session_id == manager.session_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


async def test_a_short_session_with_a_drug_is_persisted_anyway(db_session):
    """El umbral de 5 s existe para no llenar la tabla de sesiones abiertas
    por error. Administrar no es un error: es un acto clínico registrado."""
    manager, settings = await _seeded_manager(db_session)
    for _ in range(10):  # 1,0 s simulado
        manager.next_chunk()
    manager.administer("atropine", 1.0, "IV")
    assert should_persist(manager)

    await persist_session(db_session, manager, settings)
    row = (
        await db_session.execute(
            select(SessionRow).where(SessionRow.id == manager.session_id)
        )
    ).scalar_one()
    assert row.id == manager.session_id


async def test_the_session_detail_replays_from_the_registry(db_session):
    """El contrato del replay: la lista guardada reconstruye el estado.

    Las dos administraciones van SEPARADAS en el tiempo simulado. Antes se
    hacían en el mismo instante, y entonces la lista se ordena por un `t_s`
    empatado: Postgres devuelve las filas en el orden que quiere y el test
    pasaba o fallaba según la ejecución. El orden de dos fármacos dados en el
    mismo instante no está en los datos, así que no es algo que este test
    pueda comprobar — ni el replay reproducir.
    """
    manager, settings = await _seeded_manager(db_session)
    for _ in range(50):
        manager.next_chunk()
    manager.administer("verapamil", 5.0, "IV")
    for _ in range(10):
        manager.next_chunk()
    manager.administer("metoprolol", 5.0, "IV")
    manager.stop()
    await persist_session(db_session, manager, settings)

    rows = (
        (
            await db_session.execute(
                select(DrugAdministrationRow)
                .where(DrugAdministrationRow.session_id == manager.session_id)
                .order_by(DrugAdministrationRow.t_s)
            )
        )
        .scalars()
        .all()
    )
    assert [r.drug_id for r in rows] == ["verapamil", "metoprolol"]

    replayed = pharmacology_engine.PharmacologyEngine(manager.pharmacology.baseline)
    replayed.replay(manager.administrations)
    assert replayed.physiology_at(300.0) == manager.pharmacology.physiology_at(300.0)
