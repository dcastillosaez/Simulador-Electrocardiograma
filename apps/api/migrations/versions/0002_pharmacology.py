"""Fase F — registro de administraciones de fármacos

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable y sin `server_default`: las sesiones anteriores a la fase F no
    # llevaban motor farmacológico, y rellenarlas con la versión actual
    # afirmaría que se pueden reproducir con él. El hueco es la información.
    op.add_column(
        "sessions",
        sa.Column("pharmacology_semver", sa.String(), nullable=True),
    )
    op.create_table(
        "drug_administrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Sin FK contra ninguna tabla de catálogo: el catálogo de fármacos
        # vive en los YAML del motor y una sesión de hace meses debe seguir
        # siendo legible aunque su molécula ya no exista.
        sa.Column("drug_id", sa.String(), nullable=False),
        sa.Column("dose", sa.Numeric(), nullable=False),
        sa.Column("dose_unit", sa.String(), nullable=False),
        sa.Column("route", sa.String(), nullable=False),
        sa.Column("t_s", sa.Numeric(), nullable=False),
        sa.Column("operator", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_drug_administrations_session_id",
        "drug_administrations",
        ["session_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_drug_administrations_session_id", table_name="drug_administrations"
    )
    op.drop_table("drug_administrations")
    op.drop_column("sessions", "pharmacology_semver")
