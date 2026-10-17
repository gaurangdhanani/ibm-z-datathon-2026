"""API shapes shared by the patient and hospital routers. Mirrors frontend/src/lib/types.ts."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session

from onetrace.models import (
    AccessOutcome,
    AlertStatus,
    Grant,
    GrantStatus,
    Hospital,
    RecordCategory,
    RequestStatus,
    RiskLevel,
)

GroupBy = Literal["doctor", "body_part", "condition", "record_type", "date"]
LogFilter = Literal["all", "denied", "flagged"]


class HospitalOut(BaseModel):
    id: int
    code: str
    name: str
    city: str


class RecordTags(BaseModel):
    body_part: str | None = None
    condition: str | None = None
    doctor: str | None = None
    record_type: str
    date_of_service: str | None = None
    labels: list[str] = []
    tagger: Literal["keyword", "granite", "patient_edit"] = "keyword"
    confidence: float = 0.0


class RecordSummary(BaseModel):
    id: int
    title: str
    category: RecordCategory
    sensitivity: int
    mime_type: str
    size_bytes: int
    created_at: datetime
    source_hospital: str | None
    tags: RecordTags | None


class RecordGroup(BaseModel):
    key: str
    label: str
    count: int
    top_doctor: str | None
    records: list[RecordSummary]


class GrantInfo(BaseModel):
    id: int
    hospital: HospitalOut
    status: GrantStatus
    granted_at: datetime
    frozen_at: datetime | None
    ended_at: datetime | None


class EmergencyInfo(BaseModel):
    id: int
    hospital: HospitalOut
    staff_name: str
    justification: str
    created_at: datetime
    expires_at: datetime


class PatientInfo(BaseModel):
    id: int
    full_name: str
    mrn: str
    date_of_birth: date


class VaultSummary(BaseModel):
    patient: PatientInfo
    key_version: int
    rotated_at: datetime | None
    current_grant: GrantInfo | None
    past_grants: list[GrantInfo]
    emergency: EmergencyInfo | None
    records: list[RecordSummary]


class PatientRequestOut(BaseModel):
    id: int
    hospital: HospitalOut
    requested_by: str
    reason: str
    status: RequestStatus
    created_at: datetime
    decided_at: datetime | None


class Reason(BaseModel):
    kind: str
    text: str


class Actor(BaseModel):
    name: str
    role_label: str
    hospital: str | None
    is_you: bool


class AccessEntry(BaseModel):
    id: int
    ts: datetime
    actor: Actor
    summary: str
    outcome: AccessOutcome
    deny_reason: str | None
    risk_level: RiskLevel
    reasons: list[Reason]


class PatientAlertOut(BaseModel):
    id: int
    created_at: datetime
    risk_level: RiskLevel
    title: str
    summary: str
    reasons: list[Reason]
    status: AlertStatus
    decision: str | None


class HospitalPatient(BaseModel):
    patient_id: int
    full_name: str
    mrn: str
    date_of_birth: date
    key_status: Literal["active", "frozen", "emergency"]
    last_visit: datetime | None
    emergency_expires_at: datetime | None = None  # set while key_status == "emergency"


class HospitalPatientView(BaseModel):
    patient: HospitalPatient
    groups: list[RecordGroup]


class RequestPatient(BaseModel):
    patient_id: int
    full_name: str
    mrn: str


class HospitalRequestOut(BaseModel):
    id: int
    patient: RequestPatient
    requested_by: str
    reason: str
    status: RequestStatus
    created_at: datetime
    decided_at: datetime | None


class LookupResult(BaseModel):
    patient_id: int
    full_name: str
    mrn: str


# ---- request bodies --------------------------------------------------------------------------


class GrantIn(BaseModel):
    hospital_id: int


class TransferIn(BaseModel):
    to_hospital_id: int


class DecisionIn(BaseModel):
    decision: Literal["approve", "deny"]


class RequestAccessIn(BaseModel):
    patient_id: int
    reason: str


class AlertDecisionIn(BaseModel):
    decision: Literal["restore", "keep_frozen", "looks_fine", "freeze"]


class EmergencyIn(BaseModel):
    patient_id: int
    justification: str


# ---- demo control (S5 attacker panel, S6 reset) ----------------------------------------------


class ScenarioOut(BaseModel):
    id: str
    title: str
    description: str
    actor: str
    expected: str
    ready: bool
    hint: str | None


class ScenarioResult(BaseModel):
    scenario: str
    actor: str
    outcome: AccessOutcome
    code: str | None
    message: str
    summary: str
    risk_level: RiskLevel
    reasons: list[Reason]


# ---- builders --------------------------------------------------------------------------------


def hospital_out(h: Hospital) -> HospitalOut:
    return HospitalOut(id=h.id, code=h.code, name=h.name, city=h.city)


def grant_info(session: Session, g: Grant) -> GrantInfo:
    return GrantInfo(
        id=g.id,
        hospital=hospital_out(session.get(Hospital, g.hospital_id)),
        status=g.status,
        granted_at=g.granted_at,
        frozen_at=g.frozen_at,
        ended_at=g.ended_at,
    )


# ---- Phase 4: live feed (S1) and tamper test (S3) --------------------------------------------


class FeedEntry(AccessEntry):
    """One line of the admin's live feed: an access-log entry plus whose vault it concerns."""

    patient: str


class AuditVerify(BaseModel):
    valid: bool
    entries: int
    first_broken_entry: int | None


class TamperChange(BaseModel):
    entry_id: int
    patient: str
    before: str
    after: str


class TamperState(BaseModel):
    verify: AuditVerify
    changes: list[TamperChange]
