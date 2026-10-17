"""VLT-3: the access broker, the single read path for record bytes and tags.

Events (VLT-9): log lines and alerts go to the patient's stream only. A hospital's stream hears
about a change only when its access changed (freeze, restore, key swap, emergency), because a
hospital screen refetches on every event and a denied refetch is itself logged.

Nothing else decrypts. Every read authorizes (the patient owns the vault, or the hospital's grant
is active *and* on the vault's current key version, or a break-glass emergency grant is live),
runs the access rules (RUL-1), appends to the hash-chained log, then decrypts. Denials are logged
first and returned as ``403 {"code", "message"}``; the hospital UI maps the code to the frozen
(H4) or revoked (H5) screen. A HIGH verdict freezes the grant inside the same request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import desc
from sqlmodel import Session, col, select

from medvault import audit, events, rules
from medvault.kms import Kms
from medvault.models import (
    AccessAction,
    AccessLog,
    AccessOutcome,
    EmergencyGrant,
    Grant,
    GrantStatus,
    Hospital,
    Patient,
    Record,
    RiskLevel,
    Role,
    User,
    Vault,
    utcnow,
)
from medvault.rules import STAFF_ROLE_LABEL
from medvault.schemas import RecordSummary, RecordTags

LIST_LOG_WINDOW = timedelta(
    minutes=10
)  # one "Viewed record list" entry per staff member per window

# code -> (message for the hospital UI, deny_reason for the log, reason shown to the patient)
DENIALS = {
    "access_frozen": (
        "Access frozen by the patient's security system after unusual activity.",
        "access frozen",
        {"kind": "frozen", "text": "Access was frozen"},
    ),
    "access_revoked": (
        "This patient moved their records to another hospital. Your key no longer works.",
        "access revoked",
        {"kind": "revoked", "text": "Access had been revoked"},
    ),
    "no_grant": (
        "You don't hold a key for this patient.",
        "no access",
        {"kind": "no_grant", "text": "This hospital holds no key to the vault"},
    ),
}
FROZEN_REASON = "blocked by your access rules"


@dataclass
class Access:
    """How a staff member got in: a usable grant, or a live emergency grant."""

    grant: Grant | None
    emergency: EmergencyGrant | None

    @property
    def via_emergency(self) -> bool:
        return self.grant is None and self.emergency is not None


def role_label(user: User) -> str:
    if user.role == Role.PATIENT:
        return "Patient"
    return STAFF_ROLE_LABEL.get(user.staff_role, "Staff") if user.staff_role else "Staff"


def own_patient(session: Session, user: User) -> Patient:
    patient = session.exec(select(Patient).where(Patient.user_id == user.id)).first()
    if patient is None:
        raise HTTPException(403, "No patient profile for this account")
    return patient


def vault_of(session: Session, patient_id: int) -> Vault:
    return session.exec(select(Vault).where(Vault.patient_id == patient_id)).one()


def current_holder(session: Session, patient_id: int) -> Grant | None:
    """The one hospital holding a (possibly frozen) key, or None."""
    return session.exec(
        select(Grant).where(
            Grant.patient_id == patient_id,
            col(Grant.status).in_([GrantStatus.ACTIVE, GrantStatus.FROZEN]),
        )
    ).first()


def latest_grant(session: Session, patient_id: int, hospital_id: int) -> Grant | None:
    return session.exec(
        select(Grant)
        .where(Grant.patient_id == patient_id, Grant.hospital_id == hospital_id)
        .order_by(desc(Grant.granted_at), desc(Grant.id))
    ).first()


def active_emergency(
    session: Session, patient_id: int, hospital_id: int | None = None
) -> EmergencyGrant | None:
    """A break-glass grant that has neither expired nor been ended by the patient (VLT-7)."""
    query = select(EmergencyGrant).where(
        EmergencyGrant.patient_id == patient_id,
        col(EmergencyGrant.revoked_at).is_(None),
        EmergencyGrant.expires_at > utcnow(),
    )
    if hospital_id is not None:
        query = query.where(EmergencyGrant.hospital_id == hospital_id)
    return session.exec(query.order_by(desc(EmergencyGrant.created_at))).first()


def check_hospital_access(
    session: Session, user: User, vault: Vault, what: str, record: Record | None = None
) -> Access:
    """Staff read of a patient's vault: return how they get in, or log the denial and raise 403."""
    grant = latest_grant(session, vault.patient_id, user.hospital_id)
    if grant and grant.status == GrantStatus.ACTIVE and grant.key_version == vault.key_version:
        return Access(grant, None)
    emergency = active_emergency(session, vault.patient_id, user.hospital_id)
    if emergency is not None:
        return Access(None, emergency)
    if grant is None:
        code = "no_grant"
    elif grant.status == GrantStatus.FROZEN:
        code = "access_frozen"
    else:  # transferred, revoked, or an active grant left on an old key version
        code = "access_revoked"
    message, deny_reason, reason = DENIALS[code]
    audit.append(
        session,
        action=AccessAction.RECORD_VIEW if record else AccessAction.RECORD_LIST,
        outcome=AccessOutcome.DENIED,
        summary=what,
        actor=user,
        hospital_id=user.hospital_id,
        patient_id=vault.patient_id,
        record_id=record.id if record else None,
        reason=deny_reason,
        risk_level=RiskLevel.HIGH,
        reasons=[reason],
    )
    session.commit()
    events.publish("access", patient_id=vault.patient_id)  # never the denied hospital: no loop
    raise HTTPException(403, {"code": code, "message": message})


def authorize_record(session: Session, user: User, record: Record) -> tuple[Vault, Access | None]:
    """Who may see this record's metadata or bytes. Hospital denials are logged here.
    Returns the vault and, for staff, how they got in (None for the patient)."""
    vault = session.get(Vault, record.vault_id)
    if user.role == Role.PATIENT:
        if own_patient(session, user).id != record.patient_id:
            raise HTTPException(404, "Record not found")
        return vault, None
    if user.role == Role.STAFF and user.hospital_id is not None:
        access = check_hospital_access(
            session, user, vault, f"Tried to open {record.title}", record
        )
        return vault, access
    raise HTTPException(403, "Patients and hospital staff only")


def freeze_access(session: Session, access: Access, reason: str, now: datetime) -> None:
    """RUL-1 HIGH: the grant (or the emergency grant) stops working in this very request."""
    if access.grant is not None:
        access.grant.status = GrantStatus.FROZEN
        access.grant.frozen_at = now
        access.grant.freeze_reason = reason[:500]
        session.add(access.grant)
    if access.emergency is not None:
        access.emergency.revoked_at = now
        session.add(access.emergency)


def _alert_title(verdict: rules.Verdict, access: Access) -> str:
    if verdict.freeze:
        return "Unusual access frozen"
    if access.via_emergency:
        return "Emergency access to your records"
    return "Unusual access to your records"


def open_record(
    session: Session, kms: Kms, user: User, record: Record, *, at: datetime | None = None
) -> bytes:
    """Decrypt one record for the signed-in user and log it. The only place plaintext leaves.

    ``at`` overrides the clock for the access rules (attacker panel: an off-hours read by day)."""
    vault, access = authorize_record(session, user, record)
    kek = kms.unwrap_vault_key(vault)
    if access is None:  # the patient, reading their own vault
        audit.append(
            session,
            action=AccessAction.RECORD_VIEW,
            outcome=AccessOutcome.ALLOWED,
            summary=f"Opened {record.title}",
            actor=user,
            patient_id=record.patient_id,
            record_id=record.id,
        )
        session.commit()
        events.publish("access", patient_id=record.patient_id)
        return kms.decrypt_record(kek, record)

    now = at or utcnow()
    tags = kms.decrypt_tags(kek, record)
    verdict = rules.assess(user, record, tags, emergency=access.via_emergency, at=now)
    who = rules.describe(session, user)
    when = rules.fmt_time(now)
    if verdict.freeze:
        freeze_access(session, access, "; ".join(r["text"] for r in verdict.reasons), utcnow())
        entry = audit.append(
            session,
            action=AccessAction.RECORD_VIEW,
            outcome=AccessOutcome.FROZEN,
            summary=f"Tried to open {record.title}",
            actor=user,
            hospital_id=user.hospital_id,
            patient_id=record.patient_id,
            record_id=record.id,
            reason=FROZEN_REASON,
            risk_level=RiskLevel.HIGH,
            reasons=verdict.reasons,
        )
        rules.raise_alert(
            session,
            patient_id=record.patient_id,
            grant_id=access.grant.id if access.grant else None,
            entry=entry,
            risk=RiskLevel.HIGH,
            title=_alert_title(verdict, access),
            explanation=(
                f"{who}, tried to open your {record.title} at {when}. "
                "Their access is frozen until you decide."
            ),
        )
        session.commit()
        events.publish("alert", patient_id=record.patient_id, hospital_id=user.hospital_id)
        # The reasons ride along so the hospital screen can say why (UI page 4: "Reason for block").
        raise HTTPException(
            403,
            {
                "code": "access_frozen",
                "message": DENIALS["access_frozen"][0],
                "reasons": verdict.reasons,
            },
        )

    entry = audit.append(
        session,
        action=AccessAction.RECORD_VIEW,
        outcome=AccessOutcome.ALLOWED,
        summary=f"Opened {record.title}",
        actor=user,
        hospital_id=user.hospital_id,
        patient_id=record.patient_id,
        record_id=record.id,
        risk_level=verdict.risk,
        reasons=verdict.reasons,
    )
    if verdict.risk == RiskLevel.MEDIUM:
        rules.raise_alert(
            session,
            patient_id=record.patient_id,
            grant_id=access.grant.id if access.grant else None,
            entry=entry,
            risk=RiskLevel.MEDIUM,
            title=_alert_title(verdict, access),
            explanation=f"{who}, opened your {record.title} at {when}.",
        )
    session.commit()
    events.publish(
        "alert" if verdict.risk == RiskLevel.MEDIUM else "access", patient_id=record.patient_id
    )
    return kms.decrypt_record(kek, record)


def log_list_view(
    session: Session, user: User, vault: Vault, access: Access, *, at: datetime | None = None
) -> None:
    """Staff opened the record list: one log line per 10 minutes, rules applied (off hours)."""
    recent = session.exec(
        select(AccessLog.id).where(
            AccessLog.patient_id == vault.patient_id,
            AccessLog.actor_user_id == user.id,
            AccessLog.action == AccessAction.RECORD_LIST,
            AccessLog.outcome == AccessOutcome.ALLOWED,
            AccessLog.ts > utcnow() - LIST_LOG_WINDOW,
        )
    ).first()
    if recent is not None:
        return
    now = at or utcnow()
    verdict = rules.assess(user, None, emergency=access.via_emergency, at=now)
    entry = audit.append(
        session,
        action=AccessAction.RECORD_LIST,
        outcome=AccessOutcome.ALLOWED,
        summary="Viewed record list",
        actor=user,
        hospital_id=user.hospital_id,
        patient_id=vault.patient_id,
        risk_level=verdict.risk,
        reasons=verdict.reasons,
    )
    if verdict.risk == RiskLevel.MEDIUM:
        rules.raise_alert(
            session,
            patient_id=vault.patient_id,
            grant_id=access.grant.id if access.grant else None,
            entry=entry,
            risk=RiskLevel.MEDIUM,
            title=_alert_title(verdict, access),
            explanation=(
                f"{rules.describe(session, user)}, opened your record list "
                f"at {rules.fmt_time(now)}."
            ),
        )
    session.commit()
    events.publish("access", patient_id=vault.patient_id)


def record_summary(session: Session, kms: Kms, kek: bytes, record: Record) -> RecordSummary:
    tags = kms.decrypt_tags(kek, record) if record.wrapped_dek else None
    hospital = (
        session.get(Hospital, record.source_hospital_id) if record.source_hospital_id else None
    )
    return RecordSummary(
        id=record.id,
        title=record.title,
        category=record.category,
        sensitivity=record.sensitivity,
        mime_type=record.mime_type,
        size_bytes=record.size_bytes,
        created_at=record.created_at,
        source_hospital=hospital.name if hospital else None,
        tags=RecordTags(**tags) if tags else None,
    )


def vault_records(session: Session, kms: Kms, vault: Vault) -> list[RecordSummary]:
    """Metadata plus decrypted tags for every record, newest first (no plaintext bodies)."""
    kek = kms.unwrap_vault_key(vault)
    rows = session.exec(
        select(Record)
        .where(Record.vault_id == vault.id)
        .order_by(desc(Record.created_at), desc(Record.id))
    ).all()
    return [record_summary(session, kms, kek, r) for r in rows]
