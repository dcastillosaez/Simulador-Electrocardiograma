"""Tablas de persistencia.

Solo dos: `rhythms`, que ancla la FK de `sessions` y se rellena por upsert
desde el catálogo de código (nunca se escribe a mano), y `sessions`, las
sesiones cerradas. Nada más vive en Postgres — el streaming no toca esta
capa en ningún punto de su bucle.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import BigInteger, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RhythmRow(Base):
    __tablename__ = "rhythms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        nullable=False, server_default=func.now()
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
    started_at: Mapped[dt.datetime] = mapped_column(nullable=False)
    ended_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Numeric, nullable=True)
