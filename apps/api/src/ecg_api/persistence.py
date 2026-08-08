"""Persistencia de sesiones cerradas.

Se llama exactamente una vez por sesión, al final: con `stop` explícito, o
al desconectar si la sesión llevaba al menos 5 s de tiempo simulado. Nunca
en la ruta caliente del streaming.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.ext.asyncio import AsyncSession

import ecg_engine
import pharmacology_engine

from .config import Settings
from .db.models import DrugAdministrationRow, SessionRow
from .schemas import engine_params_to_dict
from .simulation import SimulationManager

MIN_PERSISTABLE_DURATION_S = 5.0


async def persist_session(
    session: AsyncSession,
    manager: SimulationManager,
    settings: Settings,
) -> None:
    assert manager.session_id is not None
    assert manager.started_at is not None
    duration_s = manager.duration_s
    ended_at = manager.started_at + dt.timedelta(seconds=duration_s)
    session.add(
        SessionRow(
            id=manager.session_id,
            rhythm_id=manager.rhythm_id,
            params=engine_params_to_dict(manager.params),
            seed=manager.seed,
            engine_semver=ecg_engine.__version__,
            engine_commit=settings.engine_commit,
            started_at=manager.started_at,
            ended_at=ended_at,
            duration_s=duration_s,
            # Se graba siempre, aunque no se administrara nada: dice con qué
            # motor farmacológico corrió la sesión, que es lo que hace
            # verificable un replay futuro. Un `None` significa «sin motor
            # farmacológico», no «sin fármacos».
            pharmacology_semver=pharmacology_engine.__version__,
        )
    )
    # La fila de la sesión, ANTES que sus administraciones. Sin `relationship()`
    # entre las dos entidades, SQLAlchemy no conoce la dependencia y ordena los
    # INSERT del flush como quiere: cuando le toca insertar primero
    # `drug_administrations`, la FK lo rechaza, el `commit` entero se cae y
    # `_maybe_persist` se traga el fallo — la sesión con fármacos, que es la que
    # nunca hay que perder, se pierde en silencio.
    await session.flush()

    # En el mismo `commit` que la sesión: una administración cuya sesión no
    # llegó a escribirse es un registro clínico huérfano, y la FK la
    # rechazaría de todos modos.
    for administration in manager.administrations:
        session.add(
            DrugAdministrationRow(
                id=administration.id,
                session_id=manager.session_id,
                drug_id=administration.drug_id,
                dose=administration.dose,
                dose_unit=administration.dose_unit,
                route=administration.route.value,
                t_s=administration.t_s,
                operator=administration.operator,
                notes=administration.notes,
            )
        )
    await session.commit()


def should_persist(manager: SimulationManager) -> bool:
    """La regla de las sesiones sin `stop` explícito: se persiste si el
    cliente desconectó habiendo simulado al menos 5 s. Tiempo simulado, no
    de reloj de pared — determinista y rápido de testear.

    Con una excepción: una sesión en la que se administró algo se persiste
    siempre, dure lo que dure. El umbral de 5 s existe para no llenar la
    tabla de sesiones abiertas por error, y administrar un fármaco no es un
    error: es un acto clínico registrado, y tirarlo porque el operador cerró
    la ventana a los tres segundos sería perder justo el dato que la Fase F
    existe para guardar.
    """
    if manager.session_id is None:
        return False
    return (
        manager.duration_s >= MIN_PERSISTABLE_DURATION_S
        or bool(manager.administrations)
    )
