"""SQLite data model (SQLModel).

Every table the MUST features need is declared here so later tickets add columns, not files:

* identity: Hospital, User, Patient, AuthSession
* vault:    Vault, Record
* access:   Grant, AccessRequest, EmergencyGrant, CareEpisode
* audit:    AccessLog (hash-chained in VLT-2), Alert

Enum columns store their string *values* (see ``enum_type``) so the DB reads cleanly in sqlite3
and the API returns the same strings the frontend uses. Timestamps are timezone-aware UTC
(``utcnow``); SQLModel 0.0.48+ rejects naive datetimes and returns aware UTC on read.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enum_type(enum_cls: type[Enum]) -> sa.Enum:
    """VARCHAR column that stores enum values (not member names) and rejects unknown strings."""
    return sa.Enum(
        enum_cls,
        values_callable=lambda cls: [member.value for member in cls],
        native_enum=False,
        length=32,
        validate_strings=True,
    )


# --------------------------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------------------------


class Role(str, Enum):
    PATIENT = "patient"
    STAFF = "staff"
    ADMIN = "admin"  # demo control: attacker panel (S5) and demo reset (S6)


class StaffRole(str, Enum):
    """Job title for hospital staff; drives separation-of-duties checks (QA-1)."""

    PHYSICIAN = "physician"
    NURSE = "nurse"
    BILLING_CLERK = "billing_clerk"
    RECORDS_CLERK = "records_clerk"


class RecordCategory(str, Enum):
    IMAGING = "imaging"
    LAB = "lab"
    NOTE = "note"
    PRESCRIPTION = "prescription"
    DISCHARGE = "discharge"
    OTHER = "other"


class GrantStatus(str, Enum):
    ACTIVE = "active"
    FROZEN = "frozen"  # detector froze it; patient decides (P9/P12)
    REVOKED = "revoked"  # patient revoked it
    TRANSFERRED = "transferred"  # ended by a key swap to another hospital (VLT-6)


class RequestStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class AccessAction(str, Enum):
    LOGIN = "login"
    LOGOUT = "logout"
    RECORD_LIST = "record_list"
    RECORD_VIEW = "record_view"
    RECORD_UPLOAD = "record_upload"
    PATIENT_LOOKUP = "patient_lookup"
    GRANT_CREATE = "grant_create"
    GRANT_REVOKE = "grant_revoke"
    GRANT_FREEZE = "grant_freeze"
    GRANT_UNFREEZE = "grant_unfreeze"
    KEY_SWAP = "key_swap"
    REQUEST_CREATE = "request_create"
    REQUEST_DECIDE = "request_decide"
    EMERGENCY_ACCESS = "emergency_access"
    AUDIT_VERIFY = "audit_verify"
    DEMO_RESET = "demo_reset"


class AccessOutcome(str, Enum):
    ALLOWED = "allowed"
    DENIED = "denied"
    FROZEN = "frozen"


class RiskLevel(str, Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class AlertStatus(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class PatientDecision(str, Enum):
    NONE = "none"
    KEEP_FROZEN = "keep_frozen"
    UNFREEZE = "unfreeze"
    REVOKE = "revoke"


# --------------------------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------------------------


class Hospital(SQLModel, table=True):
    __tablename__ = "hospitals"

    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(unique=True, index=True, max_length=16)  # e.g. HOSP-A
    name: str = Field(max_length=120)
    city: str = Field(default="", max_length=80)
    created_at: datetime = Field(default_factory=utcnow)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True, max_length=200)
    full_name: str = Field(max_length=120)
    role: Role = Field(sa_type=enum_type(Role), index=True)
    staff_role: StaffRole | None = Field(default=None, sa_type=enum_type(StaffRole))
    hospital_id: int | None = Field(default=None, foreign_key="hospitals.id", index=True)
    password_hash: str = Field(max_length=255)
    is_active: bool = Field(default=True)
    # Key for one-click demo login (only honoured when settings.demo_mode is on).
    demo_persona: str | None = Field(default=None, unique=True, max_length=40)
    created_at: datetime = Field(default_factory=utcnow)


class Patient(SQLModel, table=True):
    __tablename__ = "patients"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", unique=True)
    mrn: str = Field(unique=True, index=True, max_length=32)  # what hospitals look up (H6)
    date_of_birth: date
    created_at: datetime = Field(default_factory=utcnow)


class AuthSession(SQLModel, table=True):
    """Server-side session. Only an HMAC of the token is stored (security.hash_token)."""

    __tablename__ = "auth_sessions"

    id: int | None = Field(default=None, primary_key=True)
    token_hash: str = Field(unique=True, index=True, max_length=64)
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    last_seen_at: datetime = Field(default_factory=utcnow)
    revoked_at: datetime | None = Field(default=None)
    user_agent: str = Field(default="", max_length=200)


# --------------------------------------------------------------------------------------------
# Vault
# --------------------------------------------------------------------------------------------


class Vault(SQLModel, table=True):
    """One per patient. Holds the wrapped key-encryption key; key_version bumps on key swap."""

    __tablename__ = "vaults"

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", unique=True)
    key_version: int = Field(default=1)
    wrapped_kek: bytes | None = Field(default=None)  # filled by the KMS module (VLT-1)
    created_at: datetime = Field(default_factory=utcnow)
    rotated_at: datetime | None = Field(default=None)


class Record(SQLModel, table=True):
    """An encrypted document. Demo files are small, so ciphertext lives inline.

    ``nonce is None`` means the body is still plaintext placeholder data from the seed;
    VLT-4 replaces it with envelope encryption and sets key_version to the vault's.
    """

    __tablename__ = "records"

    id: int | None = Field(default=None, primary_key=True)
    vault_id: int = Field(foreign_key="vaults.id", index=True)
    patient_id: int = Field(foreign_key="patients.id", index=True)
    title: str = Field(max_length=200)
    category: RecordCategory = Field(
        default=RecordCategory.OTHER, sa_type=enum_type(RecordCategory), index=True
    )
    mime_type: str = Field(default="text/plain", max_length=100)
    size_bytes: int = Field(default=0)
    ciphertext: bytes | None = Field(default=None)
    nonce: bytes | None = Field(default=None)
    wrapped_dek: bytes | None = Field(default=None)
    key_version: int = Field(default=0)  # 0 = not yet encrypted
    encrypted_tags: bytes | None = Field(default=None)  # AI organizer tags (ORG-3)
    uploaded_by_user_id: int | None = Field(default=None, foreign_key="users.id")
    source_hospital_id: int | None = Field(default=None, foreign_key="hospitals.id")
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def is_encrypted(self) -> bool:
        return self.nonce is not None


# --------------------------------------------------------------------------------------------
# Access control
# --------------------------------------------------------------------------------------------


class Grant(SQLModel, table=True):
    """A hospital's standing access to a patient's vault ("who has my key", P7)."""

    __tablename__ = "grants"

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", index=True)
    hospital_id: int = Field(foreign_key="hospitals.id", index=True)
    status: GrantStatus = Field(
        default=GrantStatus.ACTIVE, sa_type=enum_type(GrantStatus), index=True
    )
    key_version: int = Field(default=1)  # which vault key version this grant can unwrap
    granted_by_user_id: int | None = Field(default=None, foreign_key="users.id")
    granted_at: datetime = Field(default_factory=utcnow)
    frozen_at: datetime | None = Field(default=None)
    freeze_reason: str = Field(default="", max_length=500)
    ended_at: datetime | None = Field(default=None)  # revoked or transferred


class AccessRequest(SQLModel, table=True):
    """A hospital asking a patient for access (H6 -> P9)."""

    __tablename__ = "access_requests"

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", index=True)
    hospital_id: int = Field(foreign_key="hospitals.id", index=True)
    requested_by_user_id: int = Field(foreign_key="users.id")
    reason: str = Field(default="", max_length=500)
    status: RequestStatus = Field(
        default=RequestStatus.PENDING, sa_type=enum_type(RequestStatus), index=True
    )
    created_at: datetime = Field(default_factory=utcnow)
    decided_at: datetime | None = Field(default=None)
    decided_by_user_id: int | None = Field(default=None, foreign_key="users.id")
    resulting_grant_id: int | None = Field(default=None, foreign_key="grants.id")


class EmergencyGrant(SQLModel, table=True):
    """Break-glass access (VLT-7 / H7): time-boxed, always logged, patient notified."""

    __tablename__ = "emergency_grants"

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", index=True)
    hospital_id: int = Field(foreign_key="hospitals.id", index=True)
    staff_user_id: int = Field(foreign_key="users.id")
    justification: str = Field(max_length=500)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    revoked_at: datetime | None = Field(default=None)
    patient_notified: bool = Field(default=False)


class CareEpisode(SQLModel, table=True):
    """Is this hospital currently treating this patient? A detector feature (DET-2)."""

    __tablename__ = "care_episodes"

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", index=True)
    hospital_id: int = Field(foreign_key="hospitals.id", index=True)
    reason: str = Field(default="", max_length=200)
    started_at: datetime = Field(default_factory=utcnow)
    ended_at: datetime | None = Field(default=None)


# --------------------------------------------------------------------------------------------
# Audit and alerts
# --------------------------------------------------------------------------------------------


class AccessLog(SQLModel, table=True):
    """Append-only, hash-chained access log. VLT-2 fills prev_hash/entry_hash and verifies."""

    __tablename__ = "access_log"

    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=utcnow, index=True)
    actor_user_id: int | None = Field(default=None, foreign_key="users.id", index=True)
    hospital_id: int | None = Field(default=None, foreign_key="hospitals.id", index=True)
    patient_id: int | None = Field(default=None, foreign_key="patients.id", index=True)
    record_id: int | None = Field(default=None, foreign_key="records.id")
    action: AccessAction = Field(sa_type=enum_type(AccessAction), index=True)
    outcome: AccessOutcome = Field(sa_type=enum_type(AccessOutcome))
    reason: str = Field(default="", max_length=500)
    risk_level: RiskLevel = Field(default=RiskLevel.NONE, sa_type=enum_type(RiskLevel))
    risk_score: float | None = Field(default=None)
    client_ip: str = Field(default="", max_length=64)
    prev_hash: str = Field(default="", max_length=64)
    entry_hash: str = Field(default="", max_length=64, index=True)


class Alert(SQLModel, table=True):
    """A plain-language alert for the patient, raised by the detector (DET-5 -> P12)."""

    __tablename__ = "alerts"

    id: int | None = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", index=True)
    grant_id: int | None = Field(default=None, foreign_key="grants.id")
    access_log_id: int | None = Field(default=None, foreign_key="access_log.id")
    risk_level: RiskLevel = Field(sa_type=enum_type(RiskLevel))
    title: str = Field(max_length=200)
    explanation: str = Field(default="", max_length=2000)
    status: AlertStatus = Field(default=AlertStatus.OPEN, sa_type=enum_type(AlertStatus))
    patient_decision: PatientDecision = Field(
        default=PatientDecision.NONE, sa_type=enum_type(PatientDecision)
    )
    created_at: datetime = Field(default_factory=utcnow)
    resolved_at: datetime | None = Field(default=None)
