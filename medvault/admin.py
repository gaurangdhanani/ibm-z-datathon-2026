"""Demo control: the attacker panel (S5) fires the rule-based scenarios server-side as the
persona in question, and the demo reset (S6) reloads the seed without signing anyone out."""

from __future__ import annotations

import json
import platform
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, or_
from sqlmodel import Session, col, select

from medvault import audit, broker, events, hospital, rules
from medvault.auth import get_session, get_settings_dep, require_admin
from medvault.config import REPO_ROOT, Settings
from medvault.kms import Kms
from medvault.models import (
    AccessAction,
    AccessLog,
    AccessOutcome,
    GrantStatus,
    Hospital,
    Patient,
    Record,
    RiskLevel,
    User,
    utcnow,
)
from medvault.patient import get_kms
from medvault.schemas import (
    Actor,
    AuditVerify,
    FeedEntry,
    Reason,
    ScenarioOut,
    ScenarioResult,
    TamperChange,
    TamperState,
)
from medvault.seed import reset_and_seed

router = APIRouter(prefix="/api/admin", tags=["admin"])

MAYA = "patient"  # persona keys from seed.USERS
HOSP_A, HOSP_B = 1, 2


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    description: str
    persona: str
    expected: str
    record_title: str
    at_hour: int | None = None  # local hour to replay the read at (off-hours demo by day)
    break_glass: str | None = None  # justification: fire VLT-7 first, then read


SCENARIOS = [
    Scenario(
        id="clerk_sensitive",
        title="Billing clerk opens a psychiatry note",
        description=(
            "Jordan Price, billing clerk at Northside, opens Maya Chen's psychiatry follow-up "
            "note. A clerical role on a sensitivity-3 record is HIGH: the read is blocked, "
            "Northside's key is frozen in the same request and Maya gets an alert to decide."
        ),
        persona="billing_a",
        expected="Blocked and frozen · HIGH",
        record_title="Psychiatry follow-up note",
    ),
    Scenario(
        id="off_hours",
        title="Nurse reads a record at 11:48 PM",
        description=(
            "Sam Lee, nurse at Northside, opens Maya's knee MRI report late at night. "
            "Off-hours is MEDIUM: the read goes through, but Maya is alerted and can freeze."
        ),
        persona="nurse_a",
        expected="Allowed · MEDIUM · patient alerted",
        record_title="Knee MRI report",
        at_hour=23,
    ),
    Scenario(
        id="revoked_read",
        title="Old hospital tries after the key swap",
        description=(
            "Dr. Elena Vasquez at Northside opens Maya's knee MRI after Maya moved her vault "
            "to Riverbend. Northside's key no longer matches the vault version: denied."
        ),
        persona="doctor_a",
        expected="Denied: access revoked · HIGH",
        record_title="Knee MRI report",
    ),
    Scenario(
        id="break_glass",
        title="ER doctor breaks the glass",
        description=(
            "Dr. Amir Haddad at Riverbend has no key for Maya but she is unconscious in his ER. "
            "He uses break-glass access with a justification and reads her prescription. "
            "Allowed for an hour, MEDIUM, and Maya sees the emergency notice at once."
        ),
        persona="doctor_b",
        expected="Allowed · MEDIUM · emergency notice",
        record_title="Prescription: sertraline 50 mg",
        break_glass="ER: unresponsive patient, need current medication list",
    ),
]


def _persona(session: Session, key: str) -> User:
    return session.exec(select(User).where(User.demo_persona == key)).one()


def _maya(session: Session) -> Patient:
    user = _persona(session, MAYA)
    return session.exec(select(Patient).where(Patient.user_id == user.id)).one()


def readiness(session: Session, s: Scenario) -> tuple[bool, str | None]:
    """Can this scenario produce its expected outcome in the current demo state?"""
    maya = _maya(session)
    holder = broker.current_holder(session, maya.id)
    holder_id = holder.hospital_id if holder else None
    if s.id in ("clerk_sensitive", "off_hours"):
        if holder_id != HOSP_A:
            return False, "Northside no longer holds Maya's key. Reset the demo first."
        if holder.status == GrantStatus.FROZEN:
            return (
                True,
                "Northside's key is already frozen, so the read is denied outright. "
                "Maya can restore it under Alerts.",
            )
        return True, None
    if s.id == "revoked_read":
        if holder_id == HOSP_A:
            return (
                False,
                "Northside still holds Maya's key. As Maya, approve Riverbend's request "
                "(Keys tab) first.",
            )
        return True, None
    if s.id == "break_glass":
        if holder_id == HOSP_B and holder.status == GrantStatus.ACTIVE:
            return (
                False,
                "Riverbend already holds Maya's key, so there is nothing to break. "
                "Reset the demo first.",
            )
        if broker.active_emergency(session, maya.id, HOSP_B):
            return True, "Emergency access is already open; this fires another read under it."
        return True, None
    return True, None


def scenario_out(session: Session, s: Scenario) -> ScenarioOut:
    ready, hint = readiness(session, s)
    actor = _persona(session, s.persona)
    return ScenarioOut(
        id=s.id,
        title=s.title,
        description=s.description,
        actor=f"{actor.full_name} · {rules.STAFF_ROLE_LABEL[actor.staff_role]}",
        expected=s.expected,
        ready=ready,
        hint=hint,
    )


@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(
    _user: User = Depends(require_admin), session: Session = Depends(get_session)
) -> list[ScenarioOut]:
    return [scenario_out(session, s) for s in SCENARIOS]


@router.post("/scenarios/{scenario_id}", response_model=ScenarioResult)
def run_scenario(
    scenario_id: str,
    _user: User = Depends(require_admin),
    session: Session = Depends(audit.get_write_session),
    kms: Kms = Depends(get_kms),
    settings: Settings = Depends(get_settings_dep),
) -> ScenarioResult:
    """Fire one scenario as its persona through the real broker; report what the log says."""
    s = next((x for x in SCENARIOS if x.id == scenario_id), None)
    if s is None:
        raise HTTPException(404, "Unknown scenario")
    actor = _persona(session, s.persona)
    maya = _maya(session)
    record = session.exec(
        select(Record).where(Record.patient_id == maya.id, Record.title == s.record_title)
    ).one()
    at: datetime | None = None
    if s.at_hour is not None:
        local = utcnow().astimezone(rules.local_tz(settings))
        at = local.replace(hour=s.at_hour, minute=48, second=0, microsecond=0)
    if s.break_glass:
        hospital.break_glass(session, actor, maya, s.break_glass, settings, at=at)
    code, message = None, "Allowed"
    try:
        broker.open_record(session, kms, actor, record, at=at)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        code, message = detail.get("code"), detail.get("message", "Denied")
    entry = session.exec(
        select(AccessLog)
        .where(AccessLog.patient_id == maya.id, AccessLog.actor_user_id == actor.id)
        .order_by(desc(AccessLog.id))
    ).first()
    return ScenarioResult(
        scenario=s.id,
        actor=actor.full_name,
        outcome=entry.outcome,
        code=code,
        message=message,
        summary=entry.summary,
        risk_level=entry.risk_level,
        reasons=[Reason(**r) for r in json.loads(entry.reasons_json or "[]")],
    )


@router.post("/reset")
def reset_demo(
    request: Request,
    _user: User = Depends(require_admin),
    kms: Kms = Depends(get_kms),
) -> dict:
    """S6: wipe and reload the seed. Sessions survive, so no device has to sign in again."""
    with audit.WRITE_LOCK:
        counts = reset_and_seed(request.app.state.engine, kms, keep_sessions=True)
    _tampered.clear()  # the tampered rows went with the old tables (S3)
    events.publish("reset")
    return {"ok": True, **counts}


# ---- Phase 4: live feed (S1), tamper test (S3), dashboard reports (S2, S4) -------------------

FLAGGED = [RiskLevel.MEDIUM, RiskLevel.HIGH]
TAMPER_FIELDS = ("summary", "outcome", "risk_level", "reasons_json", "reason")
_tampered: dict[int, dict] = {}  # entry id -> fields as they were, plus a description (one process)


def _actor(session: Session, row: AccessLog) -> Actor:
    if row.actor_user_id is None:
        return Actor(name="System", role_label="OneTrace", hospital=None, is_you=False)
    who = session.get(User, row.actor_user_id)
    hospital_name = session.get(Hospital, who.hospital_id).name if who.hospital_id else None
    return Actor(
        name=who.full_name, role_label=broker.role_label(who), hospital=hospital_name, is_you=False
    )


def _patient_name(session: Session, patient_id: int | None) -> str:
    patient = session.get(Patient, patient_id) if patient_id else None
    return session.get(User, patient.user_id).full_name if patient else "—"


def feed_entry(session: Session, row: AccessLog) -> FeedEntry:
    return FeedEntry(
        id=row.id,
        ts=row.ts,
        patient=_patient_name(session, row.patient_id),
        actor=_actor(session, row),
        summary=row.summary,
        outcome=row.outcome,
        deny_reason=row.reason or None if row.outcome != AccessOutcome.ALLOWED else None,
        risk_level=row.risk_level,
        reasons=[Reason(**r) for r in json.loads(row.reasons_json or "[]")],
    )


@router.get("/feed", response_model=list[FeedEntry])
def live_feed(
    filter: Literal["flagged", "all"] = "flagged",
    limit: int = 50,
    _user: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> list[FeedEntry]:
    """S1: flagged or denied access across every patient, newest first. Live through /events."""
    query = select(AccessLog).where(col(AccessLog.patient_id).is_not(None))
    if filter == "flagged":
        query = query.where(
            or_(
                AccessLog.outcome != AccessOutcome.ALLOWED,
                col(AccessLog.risk_level).in_(FLAGGED),
            )
        )
    rows = session.exec(
        query.order_by(desc(AccessLog.ts), desc(AccessLog.id)).limit(max(1, min(limit, 200)))
    ).all()
    return [feed_entry(session, r) for r in rows]


@router.get("/events")
async def admin_events(request: Request, _user: User = Depends(require_admin)):  # noqa: ANN201
    """Every event in the system (VLT-9): the live feed and the demo panel refetch on each."""
    return events.stream_response(request, lambda e: True)


def _describe(entry: AccessLog) -> str:
    return f"{entry.summary} · {entry.outcome.value} · {entry.risk_level.value}"


def _tamper_state(session: Session) -> TamperState:
    changes = []
    for entry_id, saved in _tampered.items():
        entry = session.get(AccessLog, entry_id)
        if entry is not None:
            changes.append(
                TamperChange(
                    entry_id=entry_id,
                    patient=_patient_name(session, entry.patient_id),
                    before=saved["before"],
                    after=_describe(entry),
                )
            )
    return TamperState(verify=AuditVerify(**audit.verify(session)), changes=changes)


@router.get("/tamper", response_model=TamperState)
def tamper_state(
    _user: User = Depends(require_admin), session: Session = Depends(get_session)
) -> TamperState:
    return _tamper_state(session)


@router.post("/tamper", response_model=TamperState)
def tamper(
    _user: User = Depends(require_admin), session: Session = Depends(audit.get_write_session)
) -> TamperState:
    """S3: an insider with database access rewrites the newest hospital read to look routine.
    The hash is not recomputed (an attacker cannot: it chains into every later entry), so
    ``verify`` fails at that entry and the patient's History badge turns red."""
    query = select(AccessLog).where(
        AccessLog.action == AccessAction.RECORD_VIEW, col(AccessLog.hospital_id).is_not(None)
    )
    if _tampered:
        query = query.where(col(AccessLog.id).not_in(list(_tampered)))
    entry = session.exec(query.order_by(desc(AccessLog.id))).first()
    if entry is None:
        raise HTTPException(409, "No hospital read left to tamper with. Repair or reset first.")
    _tampered[entry.id] = {
        "fields": {f: getattr(entry, f) for f in TAMPER_FIELDS},
        "before": _describe(entry),
    }
    entry.summary = "Viewed record list"
    entry.outcome = AccessOutcome.ALLOWED
    entry.risk_level = RiskLevel.LOW
    entry.reasons_json = "[]"
    entry.reason = ""
    session.add(entry)
    session.commit()
    events.publish("access", patient_id=entry.patient_id)
    return _tamper_state(session)


@router.post("/tamper/repair", response_model=TamperState)
def repair(
    _user: User = Depends(require_admin), session: Session = Depends(audit.get_write_session)
) -> TamperState:
    """Put the original fields back so the chain verifies again. A chain broken some other way
    (sqlite3 by hand) needs the demo reset."""
    patients: set[int | None] = set()
    for entry_id, saved in list(_tampered.items()):
        entry = session.get(AccessLog, entry_id)
        if entry is not None:
            for field, value in saved["fields"].items():
                setattr(entry, field, value)
            session.add(entry)
            patients.add(entry.patient_id)
        del _tampered[entry_id]
    session.commit()
    for patient_id in patients:
        events.publish("access", patient_id=patient_id)
    return _tamper_state(session)


@router.get("/reports")
def reports(_user: User = Depends(require_admin)) -> dict:
    """S2 + S4: the organizer evaluation (make eval) and every benchmark (make bench) found in
    reports/."""

    def load(path):  # noqa: ANN001, ANN202
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return None

    folder = REPO_ROOT / "reports"
    benchmarks = [b for b in (load(p) for p in sorted(folder.glob("bench-*.json"))) if b]
    return {
        "this_machine": platform.machine(),
        "eval": load(folder / "eval.json"),
        "benchmarks": benchmarks,
    }
