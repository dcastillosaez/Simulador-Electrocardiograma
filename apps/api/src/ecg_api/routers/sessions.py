"""Historial de sesiones. Lectura pura de Postgres.

El único escritor es `persist_session`, llamado desde el handler del
WebSocket al cerrarse — esta capa no escribe nada.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from ..db.models import DrugAdministrationRow, SessionRow
from ..schemas import AdministrationRecord, SessionDetail, SessionSummary

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

LIST_LIMIT = 50


def _to_summary(row: SessionRow) -> SessionSummary:
    return SessionSummary(
        id=row.id,
        rhythm_id=row.rhythm_id,
        started_at=row.started_at,
        duration_s=float(row.duration_s) if row.duration_s is not None else None,
    )


def _to_detail(
    row: SessionRow, administrations: list[DrugAdministrationRow]
) -> SessionDetail:
    return SessionDetail(
        **_to_summary(row).model_dump(),
        params=row.params,
        seed=row.seed,
        engine_semver=row.engine_semver,
        engine_commit=row.engine_commit,
        ended_at=row.ended_at,
        pharmacology_semver=row.pharmacology_semver,
        administrations=[
            AdministrationRecord(
                id=a.id,
                drug_id=a.drug_id,
                dose=float(a.dose),
                dose_unit=a.dose_unit,
                route=a.route,
                t_s=float(a.t_s),
                operator=a.operator,
                notes=a.notes,
            )
            for a in administrations
        ],
    )


@router.get("", response_model=list[SessionSummary])
async def list_sessions(request: Request) -> list[SessionSummary]:
    session_factory = request.app.state.session_factory
    async with session_factory() as db:
        rows = (
            await db.execute(
                select(SessionRow)
                .order_by(SessionRow.started_at.desc())
                .limit(LIST_LIMIT)
            )
        ).scalars().all()
    return [_to_summary(r) for r in rows]


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, request: Request) -> SessionDetail:
    try:
        parsed_id = uuid.UUID(session_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404, detail="id de sesión inválido"
        ) from exc

    session_factory = request.app.state.session_factory
    async with session_factory() as db:
        row = await db.get(SessionRow, parsed_id)
        if row is None:
            raise HTTPException(status_code=404, detail="sesión no encontrada")
        # Ordenadas por `t_s`: es el orden en que ocurrieron y el orden en
        # que un replay debe reinyectarlas.
        administrations = list(
            (
                await db.execute(
                    select(DrugAdministrationRow)
                    .where(DrugAdministrationRow.session_id == parsed_id)
                    .order_by(DrugAdministrationRow.t_s)
                )
            )
            .scalars()
            .all()
        )
    return _to_detail(row, administrations)
