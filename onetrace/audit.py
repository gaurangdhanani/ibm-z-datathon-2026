"""VLT-2: hash-chained access log and GET /api/audit/verify.

``entry_hash = SHA-256(prev_hash || canonical JSON of the row)``; ``prev_hash`` is the previous
row's hash (GENESIS for the first). Editing or deleting any row breaks every hash after it, which
``verify`` reports as ``first_broken_entry``. ``WRITE_LOCK`` keeps appends linear: every route
that may log takes ``get_write_session``, so one request writes at a time (single-process demo).
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, Request
from sqlalchemy import desc
from sqlmodel import Session, select

from onetrace.auth import get_current_user, get_session
from onetrace.models import AccessAction, AccessLog, AccessOutcome, RiskLevel, User, utcnow

router = APIRouter(prefix="/api/audit", tags=["audit"])
WRITE_LOCK = threading.Lock()
GENESIS = "0" * 64


def get_write_session(request: Request) -> Iterator[Session]:
    """A DB session that also holds WRITE_LOCK. Use it on every route that may append to the log."""
    with WRITE_LOCK, Session(request.app.state.engine) as session:
        yield session


def _plain(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):  # stored as UTC wall time; aware on write, aware on read
        return value.replace(tzinfo=None).isoformat(timespec="microseconds")
    return value


def entry_hash(e: AccessLog) -> str:
    fields = [
        e.prev_hash, e.ts, e.actor_user_id, e.hospital_id, e.patient_id, e.record_id, e.action,
        e.outcome, e.summary, e.reason, e.risk_level, e.reasons_json,
    ]  # fmt: skip
    payload = json.dumps([_plain(f) for f in fields], separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def append(
    session: Session,
    *,
    action: AccessAction,
    outcome: AccessOutcome,
    summary: str,
    actor: User | None = None,
    hospital_id: int | None = None,
    patient_id: int | None = None,
    record_id: int | None = None,
    reason: str = "",
    risk_level: RiskLevel = RiskLevel.LOW,
    reasons: Iterable[dict] = (),
    ts: datetime | None = None,
) -> AccessLog:
    """Append one chained entry (flushed, not committed: the caller's transaction owns it)."""
    last = session.exec(select(AccessLog).order_by(desc(AccessLog.id)).limit(1)).first()
    entry = AccessLog(
        ts=(ts or utcnow()).astimezone(timezone.utc),
        actor_user_id=actor.id if actor else None,
        hospital_id=hospital_id,
        patient_id=patient_id,
        record_id=record_id,
        action=action,
        outcome=outcome,
        summary=summary[:200],
        reason=reason[:500],
        risk_level=risk_level,
        reasons_json=json.dumps(list(reasons)),
        prev_hash=last.entry_hash if last else GENESIS,
    )
    entry.entry_hash = entry_hash(entry)
    session.add(entry)
    session.flush()
    return entry


def verify(session: Session) -> dict:
    rows = session.exec(select(AccessLog).order_by(AccessLog.id)).all()
    prev = GENESIS
    for row in rows:
        if row.prev_hash != prev or entry_hash(row) != row.entry_hash:
            return {"valid": False, "entries": len(rows), "first_broken_entry": row.id}
        prev = row.entry_hash
    return {"valid": True, "entries": len(rows), "first_broken_entry": None}


@router.get("/verify")
def verify_chain(
    session: Session = Depends(get_session), _user: User = Depends(get_current_user)
) -> dict:
    """Recompute the whole chain. Any signed-in user may check; the result is not itself logged."""
    return verify(session)
