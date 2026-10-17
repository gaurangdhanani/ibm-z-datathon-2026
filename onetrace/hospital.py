"""VLT-8 hospital endpoints: my patients, record read through the broker, patient lookup, the
hospital side of access requests (VLT-5), break-glass emergency access (VLT-7) and the hospital's
live event stream (VLT-9). Every read of a patient's vault is logged."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import desc
from sqlmodel import Session, col, select

from onetrace import audit, broker, events, rules
from onetrace.audit import get_write_session
from onetrace.auth import get_session, get_settings_dep, require_staff, require_staff_roles
from onetrace.config import Settings
from onetrace.kms import Kms
from onetrace.models import (
    AccessAction,
    AccessLog,
    AccessOutcome,
    AccessRequest,
    EmergencyGrant,
    Grant,
    GrantStatus,
    Patient,
    Record,
    RequestStatus,
    RiskLevel,
    StaffRole,
    User,
    utcnow,
)
from onetrace.organizer import group_records
from onetrace.patient import content_response, emergency_info, get_kms
from onetrace.schemas import (
    EmergencyIn,
    EmergencyInfo,
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
MIN_REASON = 10
require_clinician = require_staff_roles(StaffRole.PHYSICIAN, StaffRole.NURSE)


def hospital_patient(
    session: Session,
    hospital_id: int,
    patient: Patient,
    grant: Grant | None,
    emergency: EmergencyGrant | None = None,
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
    if grant is None:
        key_status = "emergency"
    elif grant.status == GrantStatus.FROZEN:
        key_status = "frozen"
    else:
        key_status = "active"
    return HospitalPatient(
        patient_id=patient.id,
        full_name=who.full_name,
        mrn=patient.mrn,
        date_of_birth=patient.date_of_birth,
        key_status=key_status,
        last_visit=last or (grant.granted_at if grant else emergency.created_at),
        emergency_expires_at=emergency.expires_at if grant is None and emergency else None,
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
    """Patients whose vault this hospital holds a key for (active or frozen) or has emergency
    access to."""
    grants = session.exec(
        select(Grant).where(
            Grant.hospital_id == user.hospital_id,
            col(Grant.status).in_([GrantStatus.ACTIVE, GrantStatus.FROZEN]),
        )
    ).all()
    rows = [
        hospital_patient(session, user.hospital_id, session.get(Patient, g.patient_id), g)
        for g in grants
    ]
    seen = {g.patient_id for g in grants}
    for e in session.exec(
        select(EmergencyGrant).where(
            EmergencyGrant.hospital_id == user.hospital_id,
            col(EmergencyGrant.revoked_at).is_(None),
            EmergencyGrant.expires_at > utcnow(),
        )
    ).all():
        if e.patient_id not in seen:
            seen.add(e.patient_id)
            patient = session.get(Patient, e.patient_id)
            rows.append(hospital_patient(session, user.hospital_id, patient, None, e))
    needle = q.strip().lower()
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
    access = broker.check_hospital_access(session, user, vault, "Tried to view record list")
    broker.log_list_view(session, user, vault, access)
    return HospitalPatientView(
        patient=hospital_patient(
            session, user.hospital_id, patient, access.grant, access.emergency
        ),
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
    vault, _ = broker.authorize_record(session, user, record)
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
    events.publish("request", patient_id=patient.id, hospital_id=user.hospital_id)
    return request_out(session, req)


@router.get("/requests", response_model=list[HospitalRequestOut])
def my_requests(
    user: User = Depends(require_staff), session: Session = Depends(get_session)
) -> list[HospitalRequestOut]:
    """Polled every 3 s by the requests page; the event stream also pokes it (VLT-9)."""
    rows = session.exec(
        select(AccessRequest)
        .where(AccessRequest.hospital_id == user.hospital_id)
        .order_by(desc(AccessRequest.created_at))
    ).all()
    return [request_out(session, r) for r in rows]


# ---- break-glass emergency access (VLT-7) ----------------------------------------------------


def break_glass(
    session: Session,
    user: User,
    patient: Patient,
    justification: str,
    settings: Settings,
    *,
    at: datetime | None = None,
) -> EmergencyGrant:
    """Time-boxed access without a key. Always logged, always MEDIUM, the patient is told at once.
    Idempotent: a still-live emergency grant from this hospital is returned as is."""
    justification = justification.strip()
    if len(justification) < MIN_REASON:
        raise HTTPException(422, f"Give a justification of at least {MIN_REASON} characters.")
    holder = broker.current_holder(session, patient.id)
    if holder and holder.hospital_id == user.hospital_id:
        if holder.status == GrantStatus.FROZEN:  # a patient's freeze cannot be broken through
            detail = {
                "code": "access_frozen",
                "message": "The patient froze your hospital's access. Emergency access is not "
                "available until they restore it.",
            }
            raise HTTPException(409, detail)
        detail = {"code": "already_granted", "message": "Your hospital already holds this key."}
        raise HTTPException(409, detail)
    existing = broker.active_emergency(session, patient.id, user.hospital_id)
    if existing is not None:
        return existing
    now = at or utcnow()
    e = EmergencyGrant(
        patient_id=patient.id,
        hospital_id=user.hospital_id,
        staff_user_id=user.id,
        justification=justification[:500],
        created_at=utcnow(),
        expires_at=utcnow() + timedelta(minutes=settings.emergency_ttl_minutes),
        patient_notified=True,
    )
    session.add(e)
    session.flush()
    verdict = rules.assess(user, None, emergency=True, at=now, settings=settings)
    entry = audit.append(
        session,
        action=AccessAction.EMERGENCY_ACCESS,
        outcome=AccessOutcome.ALLOWED,
        summary="Used emergency access to your vault",
        actor=user,
        hospital_id=user.hospital_id,
        patient_id=patient.id,
        reason=justification[:500],
        risk_level=RiskLevel.MEDIUM,
        reasons=verdict.reasons,
    )
    rules.raise_alert(
        session,
        patient_id=patient.id,
        grant_id=None,
        entry=entry,
        risk=RiskLevel.MEDIUM,
        title="Emergency access to your records",
        explanation=(
            f"{rules.describe(session, user)}, used emergency access. "
            f'Reason given: "{justification}". '
            f"It ends at {rules.fmt_time(e.expires_at, settings)} unless you end it sooner."
        ),
    )
    session.commit()
    events.publish("emergency", patient_id=patient.id, hospital_id=user.hospital_id)
    return e


@router.post("/emergency", response_model=EmergencyInfo, status_code=201)
def emergency_access(
    body: EmergencyIn,
    user: User = Depends(require_clinician),
    session: Session = Depends(get_write_session),
    settings: Settings = Depends(get_settings_dep),
) -> EmergencyInfo:
    """H7: physicians and nurses only (separation of duties); clerks get 403."""
    patient = session.get(Patient, body.patient_id)
    if patient is None:
        raise HTTPException(404, "Patient not found")
    return emergency_info(
        session, break_glass(session, user, patient, body.justification, settings)
    )


@router.get("/events")
async def hospital_events(request: Request, user: User = Depends(require_staff)):  # noqa: ANN201
    """VLT-9: Server-Sent Events for this hospital (grants, requests, freezes, resets)."""
    hospital_id = user.hospital_id
    return events.stream_response(
        request, lambda e: e.kind == "reset" or e.hospital_id == hospital_id
    )
