"""VLT-8 hospital endpoints: my patients, record read through the broker, patient lookup, and
the hospital side of access requests (VLT-5). Every read of a patient's vault is logged."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import desc
from sqlmodel import Session, col, select

from medvault import audit, broker
from medvault.audit import get_write_session
from medvault.auth import get_session, require_staff
from medvault.kms import Kms
from medvault.models import (
    AccessAction,
    AccessLog,
    AccessOutcome,
    AccessRequest,
    Grant,
    GrantStatus,
    Patient,
    Record,
    RequestStatus,
    User,
    utcnow,
)
from medvault.organizer import group_records
from medvault.patient import content_response, get_kms
from medvault.schemas import (
    GroupBy,
    HospitalPatient,
    HospitalPatientView,
    HospitalRequestOut,
    LookupResult,
    RecordSummary,
    RequestAccessIn,
    RequestPatient,
)

router = APIRouter(prefix="/api/hospital", tags=["hospital"])
LIST_LOG_WINDOW = timedelta(
    minutes=10
)  # one "Viewed record list" entry per staff member per window
MIN_REASON = 10


def hospital_patient(
    session: Session, hospital_id: int, patient: Patient, grant: Grant
) -> HospitalPatient:
    who = session.get(User, patient.user_id)
    last = session.exec(
        select(AccessLog.ts)
        .where(
            AccessLog.patient_id == patient.id,
            AccessLog.hospital_id == hospital_id,
            AccessLog.outcome == AccessOutcome.ALLOWED,
            col(AccessLog.action).in_(
                [AccessAction.RECORD_VIEW, AccessAction.RECORD_LIST, AccessAction.RECORD_UPLOAD]
            ),
        )
        .order_by(desc(AccessLog.ts))
    ).first()
    return HospitalPatient(
        patient_id=patient.id,
        full_name=who.full_name,
        mrn=patient.mrn,
        date_of_birth=patient.date_of_birth,
        key_status="frozen" if grant.status == GrantStatus.FROZEN else "active",
        last_visit=last or grant.granted_at,
    )


def request_out(session: Session, r: AccessRequest) -> HospitalRequestOut:
    patient = session.get(Patient, r.patient_id)
    return HospitalRequestOut(
        id=r.id,
        patient=RequestPatient(
            patient_id=patient.id,
            full_name=session.get(User, patient.user_id).full_name,
            mrn=patient.mrn,
        ),
        requested_by=session.get(User, r.requested_by_user_id).full_name,
        reason=r.reason,
        status=r.status,
        created_at=r.created_at,
        decided_at=r.decided_at,
    )


@router.get("/patients", response_model=list[HospitalPatient])
def my_patients(
    q: str = "", user: User = Depends(require_staff), session: Session = Depends(get_session)
) -> list[HospitalPatient]:
    """Patients whose vault this hospital holds a key for (active or frozen)."""
    grants = session.exec(
        select(Grant).where(
            Grant.hospital_id == user.hospital_id,
            col(Grant.status).in_([GrantStatus.ACTIVE, GrantStatus.FROZEN]),
        )
    ).all()
    needle = q.strip().lower()
    rows = [
        hospital_patient(session, user.hospital_id, session.get(Patient, g.patient_id), g)
        for g in grants
    ]
    rows = [
        p for p in rows if not needle or needle in p.full_name.lower() or needle in p.mrn.lower()
    ]
    return sorted(rows, key=lambda p: p.full_name)


@router.get("/patients/{patient_id}/groups", response_model=HospitalPatientView)
def patient_groups(
    patient_id: int,
    by: GroupBy = "body_part",
    user: User = Depends(require_staff),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
) -> HospitalPatientView:
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(404, "Patient not found")
    vault = broker.vault_of(session, patient.id)
    grant = broker.check_hospital_access(session, user, vault, "Tried to view record list")
    recent = session.exec(
        select(AccessLog.id).where(
            AccessLog.patient_id == patient.id,
            AccessLog.actor_user_id == user.id,
            AccessLog.action == AccessAction.RECORD_LIST,
            AccessLog.outcome == AccessOutcome.ALLOWED,
            AccessLog.ts > utcnow() - LIST_LOG_WINDOW,
        )
    ).first()
    if recent is None:
        audit.append(
            session,
            action=AccessAction.RECORD_LIST,
            outcome=AccessOutcome.ALLOWED,
            summary="Viewed record list",
            actor=user,
            hospital_id=user.hospital_id,
            patient_id=patient.id,
        )
        session.commit()
    return HospitalPatientView(
        patient=hospital_patient(session, user.hospital_id, patient, grant),
        groups=group_records(broker.vault_records(session, kms, vault), by),
    )


def _record(session: Session, record_id: int) -> Record:
    record = session.get(Record, record_id)
    if record is None:
        raise HTTPException(404, "Record not found")
    return record


@router.get("/records/{record_id}", response_model=RecordSummary)
def record_meta(
    record_id: int,
    user: User = Depends(require_staff),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
) -> RecordSummary:
    """Metadata only. A denial is logged; a successful open is logged by the content call."""
    record = _record(session, record_id)
    vault = broker.authorize_record(session, user, record)
    return broker.record_summary(session, kms, kms.unwrap_vault_key(vault), record)


@router.get("/records/{record_id}/content")
def record_content(
    record_id: int,
    user: User = Depends(require_staff),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
) -> Response:
    record = _record(session, record_id)
    return content_response(record, broker.open_record(session, kms, user, record))


@router.get("/patient-lookup", response_model=list[LookupResult])
def patient_lookup(
    q: str = "", _user: User = Depends(require_staff), session: Session = Depends(get_session)
) -> list[LookupResult]:
    """H6: name and MRN only, never records. Two characters minimum, five results at most."""
    needle = q.strip().lower()
    if len(needle) < 2:
        return []
    pairs = session.exec(select(Patient, User).join(User, User.id == Patient.user_id)).all()
    hits = [
        LookupResult(patient_id=p.id, full_name=u.full_name, mrn=p.mrn)
        for p, u in pairs
        if needle in u.full_name.lower() or needle in p.mrn.lower()
    ]
    return sorted(hits, key=lambda h: h.full_name)[:5]


@router.post("/request-access", response_model=HospitalRequestOut, status_code=201)
def request_access(
    body: RequestAccessIn,
    user: User = Depends(require_staff),
    session: Session = Depends(get_write_session),
) -> HospitalRequestOut:
    reason = body.reason.strip()
    if len(reason) < MIN_REASON:
        raise HTTPException(422, f"Give a reason of at least {MIN_REASON} characters.")
    patient = session.get(Patient, body.patient_id)
    if patient is None:
        raise HTTPException(404, "Patient not found")
    holder = broker.current_holder(session, patient.id)
    if holder and holder.hospital_id == user.hospital_id:
        detail = {
            "code": "already_granted",
            "message": "Your hospital already holds this patient's key.",
        }
        raise HTTPException(409, detail)
    duplicate = session.exec(
        select(AccessRequest.id).where(
            AccessRequest.patient_id == patient.id,
            AccessRequest.hospital_id == user.hospital_id,
            AccessRequest.status == RequestStatus.PENDING,
        )
    ).first()
    if duplicate is not None:
        detail = {
            "code": "duplicate_request",
            "message": "A request to this patient is already pending.",
        }
        raise HTTPException(409, detail)
    req = AccessRequest(
        patient_id=patient.id,
        hospital_id=user.hospital_id,
        requested_by_user_id=user.id,
        reason=reason[:500],
    )
    session.add(req)
    session.flush()
    audit.append(
        session,
        action=AccessAction.REQUEST_CREATE,
        outcome=AccessOutcome.ALLOWED,
        summary="Requested access to your vault",
        actor=user,
        hospital_id=user.hospital_id,
        patient_id=patient.id,
    )
    session.commit()
    return request_out(session, req)


@router.get("/requests", response_model=list[HospitalRequestOut])
def my_requests(
    user: User = Depends(require_staff), session: Session = Depends(get_session)
) -> list[HospitalRequestOut]:
    """The frontend polls this every 3 s for status changes (DECISIONS.md, VLT-5)."""
    rows = session.exec(
        select(AccessRequest)
        .where(AccessRequest.hospital_id == user.hospital_id)
        .order_by(desc(AccessRequest.created_at))
    ).all()
    return [request_out(session, r) for r in rows]
