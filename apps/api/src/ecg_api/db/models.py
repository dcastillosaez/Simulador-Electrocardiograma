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

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# JSON portable que NO renuncia a nada en Postgres.
#
# El escritorio persiste en SQLite (fase G) y el servidor en Postgres, así que
# el esquema tiene que hablar los dos idiomas. La variante es lo que evita
# pagarlo con el servidor: compilado contra Postgres sigue emitiendo `JSONB`
# —con sus operadores y sus índices— y contra SQLite emite `JSON`. Un `JSON`
# genérico a secas habría degradado Postgres a `json` sin que se notara hasta
# la primera consulta que lo indexara.
_PORTABLE_JSON = JSON().with_variant(JSONB(), "postgresql")

# `Uuid` genérico ya emite el tipo nativo de Postgres, así que aquí no hace
# falta variante: `UUID` en Postgres, `CHAR(32)` en SQLite, y en Python sigue
# siendo `uuid.UUID` a los dos lados.
_PORTABLE_UUID = Uuid(as_uuid=True)

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
    spec: Mapped[dict] = mapped_column(_PORTABLE_JSON, nullable=False)
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    engine_commit: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        _TZ_DATETIME, nullable=False, server_default=func.now()
    )


class SessionRow(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(_PORTABLE_UUID, primary_key=True)
    rhythm_id: Mapped[str] = mapped_column(
        ForeignKey("rhythms.id"), nullable=False
    )
    params: Mapped[dict] = mapped_column(_PORTABLE_JSON, nullable=False)
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

    id: Mapped[uuid.UUID] = mapped_column(_PORTABLE_UUID, primary_key=True)
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


class CustomPatientRow(Base):
    """Un paciente inventado, guardado con nombre para volver a usarlo.

    La cuarta tabla, y la primera que guarda contenido docente en vez de
    registro de lo ocurrido. Por eso es la única que el usuario edita y
    borra: `sessions` y `drug_administrations` son historia clínica de una
    simulación y no se tocan.

    `spec` guarda el paciente **entero**, con sus constantes, y no un puntero
    a nada: es lo que permite cargarlo dentro de un año aunque el editor haya
    ganado campos por el camino. Los que falten toman su valor por defecto al
    validarse, que es exactamente el comportamiento que se quiere.

    El nombre es único porque es la forma en que un docente lo busca. Dos
    «Bloqueo para la clase del martes» distintos serían un problema de quien
    los guardó, no de quien los lee.
    """

    __tablename__ = "custom_patients"

    id: Mapped[uuid.UUID] = mapped_column(_PORTABLE_UUID, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    spec: Mapped[dict] = mapped_column(_PORTABLE_JSON, nullable=False)
    # La versión del motor con la que se guardó. No restringe la carga --un
    # paciente es una descripción, no una señal-- pero deja constancia de con
    # qué se dibujaba cuando alguien lo dio por bueno.
    engine_semver: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        _TZ_DATETIME, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        _TZ_DATETIME, nullable=False, server_default=func.now()
    )
