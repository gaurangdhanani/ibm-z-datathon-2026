"""RUL-1: fixed access rules. Replaces the AI anomaly detector (see DECISIONS.md).

Every hospital read goes through ``assess``; it returns a risk level, plain-language reasons the
patient will see, and whether to freeze the grant in this very request:

* billing or records clerk opening a sensitivity-3 record  -> HIGH, freeze now
* off hours (22:00-06:00 in the configured timezone)       -> MEDIUM, alert the patient
* break-glass emergency access                             -> MEDIUM, alert the patient
* otherwise                                                -> LOW

Revoked or missing grants never reach here: the broker denies them first (HIGH, denied).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from medvault.config import Settings, get_settings
from medvault.models import (
    AccessLog,
    Alert,
    AlertStatus,
    Hospital,
    Record,
    RiskLevel,
    StaffRole,
    User,
    utcnow,
)

CLERICAL = {StaffRole.BILLING_CLERK, StaffRole.RECORDS_CLERK}
RESTRICTED = 3  # Record.sensitivity that clerks must never open

STAFF_ROLE_LABEL = {
    StaffRole.PHYSICIAN: "Physician",
    StaffRole.NURSE: "Nurse",
    StaffRole.BILLING_CLERK: "Billing clerk",
    StaffRole.RECORDS_CLERK: "Records clerk",
}


@dataclass
class Verdict:
    risk: RiskLevel = RiskLevel.LOW
    reasons: list[dict] = field(default_factory=list)  # [{kind, text}] shown by the UI
    freeze: bool = False


def local_tz(settings: Settings | None = None) -> ZoneInfo:
    return ZoneInfo((settings or get_settings()).timezone)


def fmt_time(at: datetime, settings: Settings | None = None) -> str:
    """'11:48 PM' in the demo timezone (the patient's phone shows the same local time)."""
    local = at.astimezone(local_tz(settings))
    return local.strftime("%I:%M %p").lstrip("0")


def is_off_hours(at: datetime, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    hour = at.astimezone(local_tz(settings)).hour
    return hour >= settings.off_hours_start or hour < settings.off_hours_end


def assess(
    user: User,
    record: Record | None,
    tags: dict | None = None,
    *,
    emergency: bool = False,
    at: datetime | None = None,
    settings: Settings | None = None,
) -> Verdict:
    """Judge one staff read (``record`` None = the record list). ``at`` lets the attacker panel
    replay an off-hours read in a daytime demo."""
    at = at or utcnow()
    verdict = Verdict()
    if record is not None and record.sensitivity >= RESTRICTED and user.staff_role in CLERICAL:
        role = STAFF_ROLE_LABEL.get(user.staff_role, "staff").lower()
        what = (tags or {}).get("condition") or "restricted"
        verdict.reasons.append({"kind": "role_mismatch", "text": f"Unrelated to the {role} role"})
        verdict.reasons.append({"kind": "sensitive_record", "text": f"Sensitive record ({what})"})
        verdict.risk = RiskLevel.HIGH
        verdict.freeze = True
    if is_off_hours(at, settings):
        verdict.reasons.append(
            {"kind": "off_hours", "text": f"Outside normal hours ({fmt_time(at, settings)})"}
        )
    if emergency:
        verdict.reasons.append({"kind": "emergency", "text": "Emergency (break-glass) access"})
    if verdict.risk != RiskLevel.HIGH and verdict.reasons:
        verdict.risk = RiskLevel.MEDIUM
    return verdict


def describe(session: Session, user: User) -> str:
    """'Jordan Price, billing clerk at Northside General Hospital' for alert text."""
    role = STAFF_ROLE_LABEL.get(user.staff_role, "staff").lower() if user.staff_role else "staff"
    hospital = session.get(Hospital, user.hospital_id) if user.hospital_id else None
    return (
        f"{user.full_name}, {role} at {hospital.name}" if hospital else f"{user.full_name}, {role}"
    )


def raise_alert(
    session: Session,
    *,
    patient_id: int,
    grant_id: int | None,
    entry: AccessLog,
    risk: RiskLevel,
    title: str,
    explanation: str,
) -> Alert | None:
    """Create the patient-facing alert for a flagged log entry (flushed, not committed).

    MEDIUM alerts are deduplicated: while one with the same title is still open for this patient,
    repeated off-hours reads do not pile up new cards. HIGH alerts are always raised.
    """
    if risk == RiskLevel.MEDIUM:
        existing = session.exec(
            select(Alert).where(
                Alert.patient_id == patient_id,
                Alert.title == title,
                Alert.status == AlertStatus.OPEN,
            )
        ).first()
        if existing is not None:
            return None
    alert = Alert(
        patient_id=patient_id,
        grant_id=grant_id,
        access_log_id=entry.id,
        risk_level=risk,
        title=title,
        explanation=explanation[:2000],
    )
    session.add(alert)
    session.flush()
    return alert
