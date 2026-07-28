"""Crear rhythms y sessions

Revision ID: 0001
Revises:
Create Date: 2026-07-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rhythms",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("spec", postgresql.JSONB(), nullable=False),
        sa.Column("engine_semver", sa.String(), nullable=False),
        sa.Column("engine_commit", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "rhythm_id",
            sa.String(),
            sa.ForeignKey("rhythms.id"),
            nullable=False,
        ),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("engine_semver", sa.String(), nullable=False),
        sa.Column("engine_commit", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_s", sa.Numeric(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_table("rhythms")
