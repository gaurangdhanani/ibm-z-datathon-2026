"""Patient endpoints: vault and records (VLT-4), grants and requests (VLT-5), key swap (VLT-6),
access history, alerts and alert decisions (VLT-10), emergency access control (VLT-7) and the
patient's live event stream (VLT-9). Also GET /api/hospitals."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import desc
from sqlmodel import Session, col, select

from medvault import audit, broker, events
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
    EmergencyGrant,
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
from medvault.organizer import extract_text, group_records, tag_text
from medvault.schemas import (
    AccessEntry,
    Actor,
    AlertDecisionIn,
    DecisionIn,
    EmergencyInfo,
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


def emergency_info(session: Session, e: EmergencyGrant) -> EmergencyInfo:
    return EmergencyInfo(
        id=e.id,
        hospital=hospital_out(session.get(Hospital, e.hospital_id)),
        staff_name=session.get(User, e.staff_user_id).full_name,
        justification=e.justification,
        created_at=e.created_at,
        expires_at=e.expires_at,
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
    emergency = broker.active_emergency(session, patient.id)
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
        emergency=emergency_info(session, emergency) if emergency else None,
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
    vault, _ = broker.authorize_record(session, user, record)
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
    text = extract_text(data, mime)  # ORG-2: the organizer runs inside the vault, before encryption
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
    events.publish("record", patient_id=patient.id)
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
        kms.rotate_record(old_kek, new_kek, record, new_version)  # tags re-encrypted too (ORG-3)
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
    for e in session.exec(
        select(EmergencyGrant).where(
            EmergencyGrant.patient_id == patient.id,
            EmergencyGrant.hospital_id == old.hospital_id,
            col(EmergencyGrant.revoked_at).is_(None),
        )
    ).all():
        e.revoked_at = now
        session.add(e)
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


def _publish_grant(patient_id: int, *hospital_ids: int | None) -> None:
    events.publish("grant", patient_id=patient_id)
    for hospital_id in hospital_ids:
        if hospital_id is not None:
            events.publish("grant", hospital_id=hospital_id)


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
    _publish_grant(patient.id, grant.hospital_id)
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
    old = broker.current_holder(session, patient.id)
    grant = key_swap(session, kms, user, patient, vault, _hospital(session, body.to_hospital_id))
    session.commit()
    _publish_grant(patient.id, old.hospital_id if old else None, grant.hospital_id)
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
    old_holder = broker.current_holder(session, patient.id)
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
        if old_holder is None:
            grant = give_key(session, user, patient, vault, hospital)
        elif old_holder.hospital_id != hospital.id:
            grant = key_swap(session, kms, user, patient, vault, hospital)  # approves req too
        else:
            grant = old_holder
        req.status = RequestStatus.APPROVED
        req.resulting_grant_id = grant.id
    req.decided_at = now
    req.decided_by_user_id = user.id
    session.add(req)
    session.commit()
    events.publish("request", patient_id=patient.id, hospital_id=hospital.id)
    if body.decision == "approve":
        _publish_grant(patient.id, old_holder.hospital_id if old_holder else None, hospital.id)
    return request_out(session, req)


# ---- access history, alerts and decisions (VLT-10), emergency access (VLT-7) -----------------


def _reasons(entry: AccessLog | None) -> list[Reason]:
    return [Reason(**r) for r in json.loads(entry.reasons_json or "[]")] if entry else []


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
            reasons=_reasons(row),
        )
        for row in rows
    ]


def alert_out(session: Session, a: Alert) -> PatientAlertOut:
    entry = session.get(AccessLog, a.access_log_id) if a.access_log_id else None
    return PatientAlertOut(
        id=a.id,
        created_at=a.created_at,
        risk_level=a.risk_level,
        title=a.title,
        summary=a.explanation,
        reasons=_reasons(entry),
        status=a.status,
        decision=None if a.patient_decision == PatientDecision.NONE else a.patient_decision.value,
    )


@router.get("/alerts", response_model=list[PatientAlertOut])
def alerts(
    user: User = Depends(require_patient), session: Session = Depends(get_session)
) -> list[PatientAlertOut]:
    """Alerts raised by the access rules (RUL-1): open ones first, newest first."""
    patient = broker.own_patient(session, user)
    rows = session.exec(
        select(Alert).where(Alert.patient_id == patient.id).order_by(desc(Alert.created_at))
    ).all()
    rows.sort(key=lambda a: a.status != AlertStatus.OPEN)
    return [alert_out(session, a) for a in rows]


@router.post("/alerts/{alert_id}/decision", response_model=PatientAlertOut)
def decide_alert(
    alert_id: int,
    body: AlertDecisionIn,
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
) -> PatientAlertOut:
    """VLT-10 / P12: restore or keep_frozen on a HIGH alert, looks_fine or freeze on a MEDIUM one.
    ``freeze`` also ends any break-glass access from that hospital."""
    patient = broker.own_patient(session, user)
    alert = session.get(Alert, alert_id)
    if alert is None or alert.patient_id != patient.id:
        raise HTTPException(404, "Alert not found")
    if alert.status == AlertStatus.RESOLVED:
        raise HTTPException(409, "This alert is already closed.")
    now = utcnow()
    decision = PatientDecision(body.decision)
    grant = session.get(Grant, alert.grant_id) if alert.grant_id else None
    live = grant is not None and grant.status in (GrantStatus.ACTIVE, GrantStatus.FROZEN)
    entry = session.get(AccessLog, alert.access_log_id) if alert.access_log_id else None
    hospital_id = grant.hospital_id if grant else (entry.hospital_id if entry else None)
    hospital = session.get(Hospital, hospital_id) if hospital_id else None
    name = hospital.name if hospital else "the hospital"

    action, summary = AccessAction.ALERT_DECIDE, "Marked an alert as fine"
    if decision == PatientDecision.RESTORE:
        if live and grant.status == GrantStatus.FROZEN:
            grant.status = GrantStatus.ACTIVE
            grant.frozen_at = None
            session.add(grant)
        action, summary = AccessAction.GRANT_UNFREEZE, f"Restored {name}'s access"
        alert.status = AlertStatus.RESOLVED
    elif decision == PatientDecision.KEEP_FROZEN:
        action, summary = AccessAction.GRANT_FREEZE, f"Kept {name}'s access frozen"
        alert.status = AlertStatus.ACKNOWLEDGED
    elif decision == PatientDecision.LOOKS_FINE:
        alert.status = AlertStatus.RESOLVED
    else:  # freeze
        if live:
            grant.status = GrantStatus.FROZEN
            grant.frozen_at = now
            grant.freeze_reason = "frozen by the patient after an alert"
            session.add(grant)
            action, summary = AccessAction.GRANT_FREEZE, f"Froze {name}'s access"
        ended = 0
        if hospital_id is not None:
            for e in session.exec(
                select(EmergencyGrant).where(
                    EmergencyGrant.patient_id == patient.id,
                    EmergencyGrant.hospital_id == hospital_id,
                    col(EmergencyGrant.revoked_at).is_(None),
                )
            ).all():
                e.revoked_at = now
                session.add(e)
                ended += 1
        if ended and not live:
            action, summary = AccessAction.EMERGENCY_END, f"Ended emergency access for {name}"
        alert.status = AlertStatus.ACKNOWLEDGED
    alert.patient_decision = decision
    alert.resolved_at = now if alert.status == AlertStatus.RESOLVED else None
    session.add(alert)
    audit.append(
        session,
        action=action,
        outcome=AccessOutcome.ALLOWED,
        summary=summary,
        actor=user,
        hospital_id=hospital_id,
        patient_id=patient.id,
    )
    session.commit()
    access_changed = action != AccessAction.ALERT_DECIDE and decision != PatientDecision.KEEP_FROZEN
    events.publish("alert", patient_id=patient.id)
    if access_changed:  # the hospital's screens refetch only when their access changed
        events.publish("grant", hospital_id=hospital_id)
    return alert_out(session, alert)


@router.post("/emergency/{emergency_id}/end", status_code=204)
def end_emergency(
    emergency_id: int,
    user: User = Depends(require_patient),
    session: Session = Depends(get_write_session),
) -> None:
    """P13: the patient ends break-glass access early. Everything already opened stays logged."""
    patient = broker.own_patient(session, user)
    e = session.get(EmergencyGrant, emergency_id)
    if e is None or e.patient_id != patient.id:
        raise HTTPException(404, "Emergency access not found")
    if e.revoked_at is not None or e.expires_at <= utcnow():
        raise HTTPException(409, "That emergency access has already ended.")
    e.revoked_at = utcnow()
    session.add(e)
    hospital = session.get(Hospital, e.hospital_id)
    audit.append(
        session,
        action=AccessAction.EMERGENCY_END,
        outcome=AccessOutcome.ALLOWED,
        summary=f"Ended emergency access for {hospital.name}",
        actor=user,
        hospital_id=e.hospital_id,
        patient_id=patient.id,
    )
    for alert in session.exec(
        select(Alert).where(
            Alert.patient_id == patient.id,
            Alert.title == "Emergency access to your records",
            Alert.status != AlertStatus.RESOLVED,
        )
    ).all():
        alert.status = AlertStatus.RESOLVED
        alert.resolved_at = utcnow()
        session.add(alert)
    session.commit()
    events.publish("emergency", patient_id=patient.id, hospital_id=e.hospital_id)


@router.get("/events")
async def patient_events(
    request: Request,
    user: User = Depends(require_patient),
    session: Session = Depends(get_session),
):  # noqa: ANN201
    """VLT-9: Server-Sent Events for this patient's vault. The UI refetches on every `change`."""
    patient_id = broker.own_patient(session, user).id
    return events.stream_response(
        request, lambda e: e.kind == "reset" or e.patient_id == patient_id
    )
