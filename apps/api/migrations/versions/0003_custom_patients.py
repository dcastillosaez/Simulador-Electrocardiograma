"""Pacientes personalizados: la biblioteca de casos inventados

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# Los mismos tipos portables que `db/models.py`, por el mismo motivo que en
# 0002: el servidor persiste en Postgres y el escritorio en SQLite.
PORTABLE_JSON = sa.JSON().with_variant(JSONB(), "postgresql")
PORTABLE_UUID = sa.Uuid(as_uuid=True)

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_patients",
        sa.Column("id", PORTABLE_UUID, primary_key=True),
        # Único: es la forma en que un docente busca lo que guardó. Sin la
        # restricción, dos pacientes con el mismo nombre convierten la lista
        # en una adivinanza.
        sa.Column("name", sa.String(), nullable=False, unique=True),
        # El paciente entero, constantes incluidas. Sin FK contra `rhythms`:
        # un paciente inventado no es un ritmo del catálogo y no debe
        # depender de que ninguna fila exista.
        sa.Column("spec", PORTABLE_JSON, nullable=False),
        sa.Column("engine_semver", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("custom_patients")
