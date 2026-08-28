"""Biblioteca de pacientes personalizados.

La primera tabla del sistema que guarda **contenido docente** en vez de
registro de lo ocurrido, y la única que el usuario edita y borra: una sesión
o una administración son historia de una simulación y no se tocan nunca;
un paciente inventado es material de clase y se corrige, se renombra y se
tira.

Lo que se guarda es el paciente entero, validado como `PatientPayload` a la
entrada y a la salida. Validar también al leer no es paranoia: una fila
escrita por una versión anterior del editor puede no tener todos los campos
de hoy, y hacerla pasar por el esquema actual rellena los que falten con su
valor por defecto en vez de reventar en el navegador.
"""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

import ecg_engine

from ..db.models import CustomPatientRow
from ..schemas import (
    CustomPatientDetail,
    CustomPatientSummary,
    CustomPatientWrite,
)

router = APIRouter(prefix="/api/patients", tags=["patients"])

LIST_LIMIT = 200
"""Un docente acumula decenas de casos, no miles. El tope existe para que una
tabla que crezca sola nunca devuelva una respuesta ilimitada."""


def _require_persistence(request: Request):
    """La fábrica de sesiones, o un 503 que explica por qué no la hay.

    Sin base de datos el simulador funciona igual —se puede configurar un
    paciente y usarlo— pero no se puede guardar. Decirlo con un 503 y un
    motivo permite a la interfaz ofrecer el editor y esconder el botón de
    guardar, en vez de fallar al pulsarlo.
    """
    session_factory = request.app.state.session_factory
    if session_factory is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Los pacientes guardados no están disponibles: la aplicación "
                "arrancó sin base de datos."
            ),
        )
    return session_factory


def _parsed_uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=404, detail="id de paciente inválido"
        ) from exc


def _to_summary(row: CustomPatientRow) -> CustomPatientSummary:
    return CustomPatientSummary(
        id=row.id,
        name=row.name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _to_detail(row: CustomPatientRow) -> CustomPatientDetail:
    return CustomPatientDetail(
        **_to_summary(row).model_dump(),
        engine_semver=row.engine_semver,
        patient=row.spec,
    )


@router.get("", response_model=list[CustomPatientSummary])
async def list_patients(request: Request) -> list[CustomPatientSummary]:
    session_factory = _require_persistence(request)
    async with session_factory() as db:
        rows = (
            await db.execute(
                select(CustomPatientRow)
                .order_by(CustomPatientRow.updated_at.desc())
                .limit(LIST_LIMIT)
            )
        ).scalars().all()
    return [_to_summary(r) for r in rows]


@router.get("/{patient_id}", response_model=CustomPatientDetail)
async def get_patient(patient_id: str, request: Request) -> CustomPatientDetail:
    parsed_id = _parsed_uuid(patient_id)
    session_factory = _require_persistence(request)
    async with session_factory() as db:
        row = await db.get(CustomPatientRow, parsed_id)
        if row is None:
            raise HTTPException(status_code=404, detail="paciente no encontrado")
    return _to_detail(row)


@router.post("", response_model=CustomPatientDetail, status_code=201)
async def create_patient(
    body: CustomPatientWrite, request: Request
) -> CustomPatientDetail:
    session_factory = _require_persistence(request)
    row = CustomPatientRow(
        id=uuid.uuid4(),
        name=body.name,
        spec=body.patient.model_dump(),
        engine_semver=ecg_engine.__version__,
    )
    async with session_factory() as db:
        db.add(row)
        try:
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            # 409 y no 400: la petición es válida, lo que ocurre es que ese
            # nombre ya está ocupado. La interfaz puede ofrecer sobrescribir.
            raise HTTPException(
                status_code=409,
                detail=f"ya existe un paciente llamado {body.name!r}",
            ) from exc
        await db.refresh(row)
    return _to_detail(row)


@router.put("/{patient_id}", response_model=CustomPatientDetail)
async def update_patient(
    patient_id: str, body: CustomPatientWrite, request: Request
) -> CustomPatientDetail:
    parsed_id = _parsed_uuid(patient_id)
    session_factory = _require_persistence(request)
    async with session_factory() as db:
        row = await db.get(CustomPatientRow, parsed_id)
        if row is None:
            raise HTTPException(status_code=404, detail="paciente no encontrado")
        row.name = body.name
        row.spec = body.patient.model_dump()
        # La versión del motor se refresca al guardar: describe con qué se
        # dibujaba este paciente la última vez que alguien lo dio por bueno.
        row.engine_semver = ecg_engine.__version__
        row.updated_at = dt.datetime.now(dt.timezone.utc)
        try:
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(
                status_code=409,
                detail=f"ya existe un paciente llamado {body.name!r}",
            ) from exc
        await db.refresh(row)
    return _to_detail(row)


@router.delete("/{patient_id}", status_code=204)
async def delete_patient(patient_id: str, request: Request) -> None:
    parsed_id = _parsed_uuid(patient_id)
    session_factory = _require_persistence(request)
    async with session_factory() as db:
        row = await db.get(CustomPatientRow, parsed_id)
        if row is None:
            raise HTTPException(status_code=404, detail="paciente no encontrado")
        # Se borra la definición, no las sesiones que lo usaron: cada una
        # guardó su propia copia del paciente en `params`, y por eso siguen
        # siendo reproducibles después de esto.
        await db.delete(row)
        await db.commit()
