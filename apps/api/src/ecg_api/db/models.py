"""Tablas de persistencia.

Tres: `rhythms`, que ancla la FK de `sessions` y se rellena por upsert desde
el catálogo de código (nunca se escribe a mano); `sessions`, las sesiones
cerradas; y `drug_administrations`, el registro de lo administrado en cada
una. Nada más vive en Postgres — el streaming no toca esta capa en ningún
punto de su bucle.

El catálogo de fármacos no tiene tabla, a diferencia del de ritmos: los
ritmos la necesitan para anclar una FK, y las administraciones no la
necesitan porque guardan el `drug_id` como texto. Es deliberado. Una sesión
de hace meses debe seguir siendo legible aunque su molécula ya no esté en
el catálogo, y una FK lo impediría.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import BigInteger, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# `Mapped[dt.datetime]` sin más, en SQLAlchemy 2.0, infiere `DateTime()` SIN
# zona horaria. Como la migración crea las columnas `timestamptz`, dejar el
# tipo implícito habría hecho que el modelo ORM y el esquema real de
# Postgres discreparan en `timezone=True/False` — el tipo de desajuste que
# `alembic revision --autogenerate` detectaría como drift espurio, y que
# aquí además importa de verdad: `started_at` se construye con
# `datetime.now(timezone.utc)` (tarea 12), un datetime con zona.
_TZ_DATETIME = DateTime(timezone=True)


class RhythmRow(Base):
    __tablename__ = "rhythms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        _TZ_DATETIME, nullable=False, server_default=func.now()
    )


class SessionRow(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    rhythm_id: Mapped[str] = mapped_column(
        ForeignKey("rhythms.id"), nullable=False
    )
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[dt.datetime] = mapped_column(_TZ_DATETIME, nullable=False)
    ended_at: Mapped[dt.datetime | None] = mapped_column(
        _TZ_DATETIME, nullable=True
    )
    duration_s: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    # Nullable: las sesiones grabadas antes de la fase F no la tienen, y
    # rellenarlas con la versión actual en la migración habría afirmado algo
    # falso —que aquellas sesiones se pueden reproducir con este motor
    # farmacológico— sobre sesiones que no llevaban ninguno.
    pharmacology_semver: Mapped[str | None] = mapped_column(String, nullable=True)


class DrugAdministrationRow(Base):
    """Una administración. Inmutable: se escribe al cerrar la sesión y no se
    actualiza nunca. Es registro clínico y es la entrada del replay."""

    __tablename__ = "drug_administrations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        # `ondelete="CASCADE"`: una administración sin sesión no significa
        # nada, ni clínicamente ni para el replay.
        ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    drug_id: Mapped[str] = mapped_column(String, nullable=False)
    dose: Mapped[float] = mapped_column(Numeric, nullable=False)
    dose_unit: Mapped[str] = mapped_column(String, nullable=False)
    route: Mapped[str] = mapped_column(String, nullable=False)
    # El instante en el reloj **de simulación**, que es lo que el replay
    # necesita. La marca de pared se deduce de `sessions.started_at`.
    t_s: Mapped[float] = mapped_column(Numeric, nullable=False)
    operator: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        _TZ_DATETIME, nullable=False, server_default=func.now()
    )
