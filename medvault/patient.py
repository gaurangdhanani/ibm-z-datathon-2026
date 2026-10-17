"""Patient endpoints: vault and records (VLT-4), grants and requests (VLT-5), key swap (VLT-6),
plus the access log and alerts the patient screens read. Also GET /api/hospitals."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import desc
from sqlmodel import Session, col, select

from medvault import audit, broker
from medvault.audit import get_write_session
from medvault.auth import get_current_user, get_session, get_settings_dep, require_patient
from medvault.config import Settings
from medvault.kms import Kms
from medvault.models import (
    AccessAction,
    AccessLog,
    AccessOutcome,
    AccessRequest,
    Alert,
    AlertStatus,
    Grant,
    GrantStatus,
    Hospital,
    Patient,
    PatientDecision,
    Record,
    RequestStatus,
    RiskLevel,
    User,
    Vault,
    utcnow,
)
from medvault.organizer import group_records, tag_text
from medvault.schemas import (
    AccessEntry,
    Actor,
    DecisionIn,
    GrantIn,
    GrantInfo,
    GroupBy,
    HospitalOut,
    LogFilter,
    PatientAlertOut,
    PatientInfo,
    PatientRequestOut,
    Reason,
    RecordGroup,
    RecordSummary,
    TransferIn,
    VaultSummary,
    grant_info,
    hospital_out,
)

router = APIRouter(prefix="/api/patient", tags=["patient"])
hospitals_router = APIRouter(prefix="/api/hospitals", tags=["hospitals"])


def get_kms(request: Request) -> Kms:
    return request.app.state.kms


def sniff(data: bytes) -> str | None:
    """Magic-byte check: the browser's declared type is not trusted."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return None if "\x00" in text else "text/plain"


def content_response(record: Record, data: bytes) -> Response:
    safe_name = "".join(c for c in record.title if c.isalnum() or c in " ._-").strip() or "record"
    return Response(
        data,
        media_type=record.mime_type,
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


def request_out(session: Session, r: AccessRequest) -> PatientRequestOut:
    return PatientRequestOut(
        id=r.id,
        hospital=hospital_out(session.get(Hospital, r.hospital_id)),
        requested_by=session.get(User, r.requested_by_user_id).full_name,
        reason=r.reason,
        status=r.status,
        created_at=r.created_at,
        decided_at=r.decided_at,
    )


# ---- hospitals -------------------------------------------------------------------------------


@hospitals_router.get("", response_model=list[HospitalOut])
def list_hospitals(
    session: Session = Depends(get_session), _user: User = Depends(get_current_user)
) -> list[HospitalOut]:
    return [hospital_out(h) for h in session.exec(select(Hospital).order_by(Hospital.id)).all()]


# ---- vault and records (VLT-4) ---------------------------------------------------------------


@router.get("/vault", response_model=VaultSummary)
def vault_summary(
    user: User = Depends(require_patient),
    session: Session = Depends(get_session),
    kms: Kms = Depends(get_kms),
) -> VaultSummary:
    patient = broker.own_patient(session, user)
    vault = broker.vault_of(session, patient.id)
    holder = broker.current_holder(session, patient.id)
    past = session.exec(
        select(Grant)
        .where(
            Grant.patient_id == patient.id,
            col(Grant.status).in_([GrantStatus.TRANSFERRED, GrantStatus.REVOKED]),
        )
        .order_by(desc(Grant.ended_at))
    ).all()
    return VaultSummary(
        patient=PatientInfo(
            id=patient.id,
            full_name=user.full_name,
            mrn=patient.mrn,
            date_of_birth=patient.date_of_birth,
        ),
        key_version=vault.key_version,
        rotated_at=vault.rotated_at,
        current_grant=grant_info(session, holder) if holder else None,
        past_grants=[grant_info(session, g) for g in past],
        emergency=None,  # VLT-7
        records=broker.vault_records(session, kms, vault),
    )


@router.get("/records/groups", response_model=list[RecordGroup])
def record_groups(
    by: GroupBy = "body_part",
    user: User = Depends(require_patient),
    session: Session = Depends(get_session),
    kms: Kms = Depends(get_kms),
) -> list[RecordGroup]:
    vault = broker.vault_of(session, broker.own_patient(session, user).id)
    return group_records(broker.vault_records(session, kms, vault), by)


def _record(session: Session, record_id: int) -> Record:
    record = session.get(Record, record_id)
    if record is None:
        raise HTTPException(404, "Record not found")
    return record


@router.get("/records/{record_id}", response_model=RecordSummary)
def record_meta(
    record_id: int,
    user: User = Depends(require_patient),
    session: Session = Depends(get_session),
    kms: Kms = Depends(get_kms),
) -> RecordSummary:
    record = _record(session, record_id)
    vault = broker.authorize_record(session, user, record)
    return broker.record_summary(session, kms, kms.unwrap_vault_key(vault), record)


@router.get("/records/{record_id}/content")
def record_content(
    record_id: int,
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
) -> Response:
    """Decrypted bytes through the broker; the read lands in Access history."""
    record = _record(session, record_id)
    return content_response(record, broker.open_record(session, kms, user, record))


@router.post("/records", response_model=RecordSummary, status_code=201)
def upload_record(
    file: UploadFile = File(...),
    title: str = Form(""),
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
    settings: Settings = Depends(get_settings_dep),
) -> RecordSummary:
    data = file.file.read(settings.max_body_bytes + 1)
    if len(data) > settings.max_body_bytes:
        detail = {
            "code": "file_too_large",
            "message": f"That file is larger than {settings.max_body_mb} MB.",
        }
        raise HTTPException(413, detail)
    mime = sniff(data)
    if mime is None or not data:
        detail = {
            "code": "invalid_file_type",
            "message": "Only PDF, JPG, PNG or TXT files can be uploaded.",
        }
        raise HTTPException(415, detail)
    patient = broker.own_patient(session, user)
    vault = broker.vault_of(session, patient.id)
    name = title.strip() or Path(file.filename or "").stem or "Untitled record"
    text = data.decode("utf-8")[:200_000] if mime == "text/plain" else ""
    result = tag_text(f"{name}\n{file.filename or ''}\n{text}", mime)
    record = Record(
        vault_id=vault.id,
        patient_id=patient.id,
        title=name[:200],
        category=result["category"],
        sensitivity=result["sensitivity"],
        mime_type=mime,
        uploaded_by_user_id=user.id,
    )
    session.add(record)
    session.flush()
    kms.encrypt_record(kms.unwrap_vault_key(vault), record, data, result["tags"], vault.key_version)
    audit.append(
        session,
        action=AccessAction.RECORD_UPLOAD,
        outcome=AccessOutcome.ALLOWED,
        summary=f"Added {record.title}",
        actor=user,
        patient_id=patient.id,
        record_id=record.id,
    )
    session.commit()
    session.refresh(record)
    return broker.record_summary(session, kms, kms.unwrap_vault_key(vault), record)


# ---- grants, requests, key swap (VLT-5, VLT-6) -----------------------------------------------


def _hospital(session: Session, hospital_id: int) -> Hospital:
    hospital = session.get(Hospital, hospital_id)
    if hospital is None:
        raise HTTPException(404, "Hospital not found")
    return hospital


def give_key(
    session: Session, user: User, patient: Patient, vault: Vault, hospital: Hospital
) -> Grant:
    """First key for a vault that has no holder."""
    if broker.current_holder(session, patient.id):
        detail = {
            "code": "already_granted",
            "message": "A hospital already holds your key. Move hospitals instead.",
        }
        raise HTTPException(409, detail)
    grant = Grant(
        patient_id=patient.id,
        hospital_id=hospital.id,
        key_version=vault.key_version,
        granted_by_user_id=user.id,
    )
    session.add(grant)
    session.flush()
    audit.append(
        session,
        action=AccessAction.GRANT_CREATE,
        outcome=AccessOutcome.ALLOWED,
        summary=f"Gave {hospital.name} a key to your vault",
        actor=user,
        hospital_id=hospital.id,
        patient_id=patient.id,
    )
    return grant


def key_swap(
    session: Session, kms: Kms, user: User, patient: Patient, vault: Vault, to: Hospital
) -> Grant:
    """VLT-6: one transaction rotates the KEK and every DEK, ends the old grant, starts the new."""
    old = broker.current_holder(session, patient.id)
    if old is None:
        raise HTTPException(409, {"code": "no_grant", "message": "No hospital holds your key yet."})
    if old.hospital_id == to.id:
        raise HTTPException(
            409, {"code": "same_hospital", "message": "That hospital already holds your key."}
        )
    now = utcnow()
    new_version = vault.key_version + 1
    old_kek = kms.unwrap_vault_key(vault)
    new_kek, wrapped = kms.new_vault_key(vault.id, new_version)
    for record in session.exec(select(Record).where(Record.vault_id == vault.id)).all():
        kms.rotate_record(old_kek, new_kek, record, new_version)
        session.add(record)
    vault.key_version = new_version
    vault.wrapped_kek = wrapped
    vault.rotated_at = now
    session.add(vault)
    old.status = GrantStatus.TRANSFERRED
    old.ended_at = now
    session.add(old)
    grant = Grant(
        patient_id=patient.id,
        hospital_id=to.id,
        key_version=new_version,
        granted_by_user_id=user.id,
        granted_at=now,
    )
    session.add(grant)
    session.flush()
    pending = session.exec(
        select(AccessRequest).where(
            AccessRequest.patient_id == patient.id,
            AccessRequest.hospital_id == to.id,
            AccessRequest.status == RequestStatus.PENDING,
        )
    ).all()
    for req in pending:
        req.status = RequestStatus.APPROVED
        req.decided_at = now
        req.decided_by_user_id = user.id
        req.resulting_grant_id = grant.id
        session.add(req)
    for alert in session.exec(
        select(Alert).where(Alert.grant_id == old.id, Alert.status != AlertStatus.RESOLVED)
    ).all():
        alert.status = AlertStatus.RESOLVED
        alert.resolved_at = now
        session.add(alert)
    old_name = session.get(Hospital, old.hospital_id).name
    audit.append(
        session,
        action=AccessAction.KEY_SWAP,
        outcome=AccessOutcome.ALLOWED,
        summary=(
            f"Moved your vault to {to.name}. {old_name}'s key was destroyed; "
            f"records re-locked with key v{new_version}"
        ),
        actor=user,
        hospital_id=to.id,
        patient_id=patient.id,
    )
    return grant


@router.post("/grant", response_model=GrantInfo)
def grant_access(
    body: GrantIn,
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
) -> GrantInfo:
    patient = broker.own_patient(session, user)
    grant = give_key(
        session,
        user,
        patient,
        broker.vault_of(session, patient.id),
        _hospital(session, body.hospital_id),
    )
    session.commit()
    return grant_info(session, grant)


@router.post("/transfer", response_model=GrantInfo)
def transfer(
    body: TransferIn,
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
) -> GrantInfo:
    patient = broker.own_patient(session, user)
    vault = broker.vault_of(session, patient.id)
    grant = key_swap(session, kms, user, patient, vault, _hospital(session, body.to_hospital_id))
    session.commit()
    return grant_info(session, grant)


@router.get("/requests", response_model=list[PatientRequestOut])
def list_requests(
    user: User = Depends(require_patient), session: Session = Depends(get_session)
) -> list[PatientRequestOut]:
    patient = broker.own_patient(session, user)
    rows = session.exec(
        select(AccessRequest)
        .where(AccessRequest.patient_id == patient.id)
        .order_by(desc(AccessRequest.created_at))
    ).all()
    rows.sort(key=lambda r: r.status != RequestStatus.PENDING)  # pending first, stable
    return [request_out(session, r) for r in rows]


@router.post("/requests/{request_id}/decision", response_model=PatientRequestOut)
def decide_request(
    request_id: int,
    body: DecisionIn,
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
    kms: Kms = Depends(get_kms),
) -> PatientRequestOut:
    """Approve gives the key, or moves the vault if another hospital holds it. Deny just says no."""
    patient = broker.own_patient(session, user)
    req = session.get(AccessRequest, request_id)
    if req is None or req.patient_id != patient.id:
        raise HTTPException(404, "Request not found")
    if req.status != RequestStatus.PENDING:
        raise HTTPException(409, "This request was already decided.")
    hospital = _hospital(session, req.hospital_id)
    now = utcnow()
    if body.decision == "deny":
        req.status = RequestStatus.DENIED
        audit.append(
            session,
            action=AccessAction.REQUEST_DECIDE,
            outcome=AccessOutcome.ALLOWED,
            summary=f"Denied {hospital.name}'s request for access",
            actor=user,
            hospital_id=hospital.id,
            patient_id=patient.id,
        )
    else:
        vault = broker.vault_of(session, patient.id)
        holder = broker.current_holder(session, patient.id)
        if holder is None:
            grant = give_key(session, user, patient, vault, hospital)
        elif holder.hospital_id != hospital.id:
            grant = key_swap(session, kms, user, patient, vault, hospital)  # approves req too
        else:
            grant = holder
        req.status = RequestStatus.APPROVED
        req.resulting_grant_id = grant.id
    req.decided_at = now
    req.decided_by_user_id = user.id
    session.add(req)
    session.commit()
    return request_out(session, req)


# ---- access history and alerts ---------------------------------------------------------------


@router.get("/access-log", response_model=list[AccessEntry])
def access_log(
    filter: LogFilter = "all",
    user: User = Depends(require_patient),
    session: Session = Depends(get_session),
) -> list[AccessEntry]:
    patient = broker.own_patient(session, user)
    query = select(AccessLog).where(AccessLog.patient_id == patient.id)
    if filter == "denied":
        query = query.where(AccessLog.outcome != AccessOutcome.ALLOWED)
    elif filter == "flagged":
        query = query.where(col(AccessLog.risk_level).in_([RiskLevel.MEDIUM, RiskLevel.HIGH]))
    rows = session.exec(query.order_by(desc(AccessLog.ts), desc(AccessLog.id))).all()
    users: dict[int, User] = {}
    hospitals: dict[int, str] = {}

    def actor_of(row: AccessLog) -> Actor:
        if row.actor_user_id is None:
            return Actor(name="System", role_label="OneTrace", hospital=None, is_you=False)
        if row.actor_user_id == user.id:
            return Actor(name="You", role_label="Patient", hospital=None, is_you=True)
        who = users.setdefault(row.actor_user_id, session.get(User, row.actor_user_id))
        hospital = None
        if who.hospital_id:
            hospital = hospitals.setdefault(
                who.hospital_id, session.get(Hospital, who.hospital_id).name
            )
        return Actor(
            name=who.full_name, role_label=broker.role_label(who), hospital=hospital, is_you=False
        )

    return [
        AccessEntry(
            id=row.id,
            ts=row.ts,
            actor=actor_of(row),
            summary=row.summary,
            outcome=row.outcome,
            deny_reason=row.reason or None if row.outcome != AccessOutcome.ALLOWED else None,
            risk_level=row.risk_level,
            reasons=[Reason(**r) for r in json.loads(row.reasons_json or "[]")],
        )
        for row in rows
    ]


@router.get("/alerts", response_model=list[PatientAlertOut])
def alerts(
    user: User = Depends(require_patient), session: Session = Depends(get_session)
) -> list[PatientAlertOut]:
    """Alerts raised by the access rules (RUL-1). Decisions arrive with VLT-10."""
    patient = broker.own_patient(session, user)
    rows = session.exec(
        select(Alert).where(Alert.patient_id == patient.id).order_by(desc(Alert.created_at))
    ).all()
    return [
        PatientAlertOut(
            id=a.id,
            created_at=a.created_at,
            risk_level=a.risk_level,
            title=a.title,
            summary=a.explanation,
            reasons=[],
            status=a.status,
            decision=None
            if a.patient_decision == PatientDecision.NONE
            else a.patient_decision.value,
        )
        for a in rows
    ]
