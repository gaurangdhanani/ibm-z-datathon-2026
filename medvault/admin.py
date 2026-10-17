"""Demo control: the attacker panel (S5) fires the rule-based scenarios server-side as the
persona in question, and the demo reset (S6) reloads the seed without signing anyone out."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc
from sqlmodel import Session, select

from medvault import audit, broker, events, hospital, rules
from medvault.auth import get_session, get_settings_dep, require_admin
from medvault.config import Settings
from medvault.kms import Kms
from medvault.models import AccessLog, GrantStatus, Patient, Record, User, utcnow
from medvault.patient import get_kms
from medvault.schemas import Reason, ScenarioOut, ScenarioResult
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
    events.publish("reset")
    return {"ok": True, **counts}
