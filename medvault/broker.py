"""VLT-3: the access broker, the single read path for record bytes and tags.

Nothing else decrypts. Every read authorizes (the patient owns the vault, or the hospital's grant
is active *and* on the vault's current key version), appends to the hash-chained log, then
decrypts. Denials are logged first and returned as ``403 {"code", "message"}``; the hospital UI
maps the code to the frozen (H4) or revoked (H5) screen.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import desc
from sqlmodel import Session, col, select

from medvault import audit
from medvault.kms import Kms
from medvault.models import (
    AccessAction,
    AccessOutcome,
    Grant,
    GrantStatus,
    Hospital,
    Patient,
    Record,
    RiskLevel,
    Role,
    StaffRole,
    User,
    Vault,
)
from medvault.schemas import RecordSummary, RecordTags

STAFF_ROLE_LABEL = {
    StaffRole.PHYSICIAN: "Physician",
    StaffRole.NURSE: "Nurse",
    StaffRole.BILLING_CLERK: "Billing clerk",
    StaffRole.RECORDS_CLERK: "Records clerk",
}

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


def check_hospital_access(
    session: Session, user: User, vault: Vault, what: str, record: Record | None = None
) -> Grant:
    """Staff read of a patient's vault: return the usable grant, or log the denial and raise 403."""
    grant = latest_grant(session, vault.patient_id, user.hospital_id)
    if grant and grant.status == GrantStatus.ACTIVE and grant.key_version == vault.key_version:
        return grant
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
    raise HTTPException(403, {"code": code, "message": message})


def authorize_record(session: Session, user: User, record: Record) -> Vault:
    """Who may see this record's metadata or bytes. Hospital denials are logged here."""
    vault = session.get(Vault, record.vault_id)
    if user.role == Role.PATIENT:
        if own_patient(session, user).id != record.patient_id:
            raise HTTPException(404, "Record not found")
    elif user.role == Role.STAFF and user.hospital_id is not None:
        check_hospital_access(session, user, vault, f"Tried to open {record.title}", record)
    else:
        raise HTTPException(403, "Patients and hospital staff only")
    return vault


def open_record(session: Session, kms: Kms, user: User, record: Record) -> bytes:
    """Decrypt one record for the signed-in user and log it. The only place plaintext leaves."""
    vault = authorize_record(session, user, record)
    plaintext = kms.decrypt_record(kms.unwrap_vault_key(vault), record)
    audit.append(
        session,
        action=AccessAction.RECORD_VIEW,
        outcome=AccessOutcome.ALLOWED,
        summary=f"Opened {record.title}",
        actor=user,
        hospital_id=user.hospital_id,
        patient_id=record.patient_id,
        record_id=record.id,
    )
    session.commit()
    return plaintext


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
