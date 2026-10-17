"""Phase 3: access rules (RUL-1), freeze and alert decisions (VLT-10), break-glass (VLT-7),
the event bus (VLT-9) and the demo panel (S5/S6)."""

from __future__ import annotations

import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from onetrace import events, rules
from onetrace.config import Settings
from onetrace.models import Grant, Record, StaffRole, User
from tests.conftest import demo_login

MAYA = 1
HOSP_A, HOSP_B = 1, 2
CHICAGO = ZoneInfo("America/Chicago")


def _record_id(client: TestClient, title: str) -> int:
    demo_login(client, "patient")
    vault = client.get("/api/patient/vault").json()
    return next(r["id"] for r in vault["records"] if r["title"] == title)


def _bearer(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


# ---- RUL-1 -----------------------------------------------------------------------------------


def test_assess_matrix() -> None:
    settings = Settings(_env_file=None)
    clerk = User(
        email="c",
        full_name="C",
        role="staff",
        staff_role=StaffRole.BILLING_CLERK,
        password_hash="x",
    )
    nurse = User(
        email="n", full_name="N", role="staff", staff_role=StaffRole.NURSE, password_hash="x"
    )
    doctor = User(
        email="d", full_name="D", role="staff", staff_role=StaffRole.PHYSICIAN, password_hash="x"
    )
    psych = Record(vault_id=1, patient_id=1, title="Psychiatry note", sensitivity=3)
    knee = Record(vault_id=1, patient_id=1, title="Knee MRI", sensitivity=1)
    noon = datetime(2026, 10, 17, 12, 0, tzinfo=CHICAGO)
    late = datetime(2026, 10, 17, 23, 48, tzinfo=CHICAGO)

    v = rules.assess(clerk, psych, {"condition": "Psychiatry"}, at=noon, settings=settings)
    assert v.risk == "high" and v.freeze
    assert [r["kind"] for r in v.reasons] == ["role_mismatch", "sensitive_record"]
    assert v.reasons[1]["text"] == "Sensitive record (Psychiatry)"
    assert not rules.assess(clerk, knee, at=noon, settings=settings).freeze
    assert rules.assess(doctor, psych, at=noon, settings=settings).risk == "low"

    v = rules.assess(nurse, knee, at=late, settings=settings)
    assert v.risk == "medium" and not v.freeze
    assert v.reasons == [{"kind": "off_hours", "text": "Outside normal hours (11:48 PM)"}]
    assert rules.assess(nurse, None, at=late, settings=settings).risk == "medium"
    v = rules.assess(doctor, knee, emergency=True, at=noon, settings=settings)
    assert v.risk == "medium" and v.reasons[0]["kind"] == "emergency"
    # a clerk on a sensitive record at night is still HIGH, with every reason listed
    v = rules.assess(clerk, psych, at=late, settings=settings)
    assert v.risk == "high" and len(v.reasons) == 3


def test_clerk_opening_sensitive_record_freezes_grant_within_the_request(
    app, client: TestClient
) -> None:
    """Phase 3 'done when': one read by a billing clerk freezes the grant and alerts the patient."""
    psych = _record_id(client, "Psychiatry follow-up note")
    knee = _record_id(client, "Knee MRI report")
    before = len(client.get("/api/patient/alerts").json())

    demo_login(client, "billing_a")
    blocked = client.get(f"/api/hospital/records/{psych}/content")
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "access_frozen"
    with Session(app.state.engine) as s:
        grant = s.exec(select(Grant).where(Grant.patient_id == MAYA)).one()
        assert grant.status == "frozen" and grant.frozen_at is not None
        assert "Sensitive record" in grant.freeze_reason
    # the freeze is on the hospital's key: every later read by anyone there is denied
    assert client.get(f"/api/hospital/records/{knee}").json()["detail"]["code"] == "access_frozen"
    maya = next(p for p in client.get("/api/hospital/patients").json() if p["patient_id"] == MAYA)
    assert maya["key_status"] == "frozen"
    demo_login(client, "doctor_a")
    assert client.get(f"/api/hospital/patients/{MAYA}/groups").status_code == 403

    # the patient sees why, and decides
    demo_login(client, "patient")
    vault = client.get("/api/patient/vault").json()
    assert vault["current_grant"]["status"] == "frozen"
    alerts = client.get("/api/patient/alerts").json()
    assert len(alerts) == before + 1
    high = alerts[0]
    assert high["risk_level"] == "high" and high["status"] == "open"
    assert high["title"] == "Unusual access frozen"
    assert high["summary"].startswith("Jordan Price, billing clerk at Northside General Hospital")
    assert [r["kind"] for r in high["reasons"]] == ["role_mismatch", "sensitive_record"]
    flagged = client.get("/api/patient/access-log?filter=flagged").json()
    frozen = next(e for e in flagged if e["outcome"] == "frozen")
    assert frozen["risk_level"] == "high" and frozen["actor"]["role_label"] == "Billing clerk"
    assert frozen["summary"] == "Tried to open Psychiatry follow-up note"
    assert frozen["deny_reason"] == "blocked by your access rules"
    assert [r["kind"] for r in frozen["reasons"]] == ["role_mismatch", "sensitive_record"]

    kept = client.post(
        f"/api/patient/alerts/{high['id']}/decision", json={"decision": "keep_frozen"}
    )
    assert kept.status_code == 200 and kept.json()["status"] == "acknowledged"
    assert kept.json()["decision"] == "keep_frozen"
    demo_login(client, "doctor_a")
    assert client.get(f"/api/hospital/records/{knee}").status_code == 403

    demo_login(client, "patient")
    restored = client.post(
        f"/api/patient/alerts/{high['id']}/decision", json={"decision": "restore"}
    )
    assert restored.status_code == 200 and restored.json()["status"] == "resolved"
    assert client.get("/api/patient/vault").json()["current_grant"]["status"] == "active"
    log = client.get("/api/patient/access-log").json()
    assert log[0]["summary"] == "Restored Northside General Hospital's access"
    again = client.post(f"/api/patient/alerts/{high['id']}/decision", json={"decision": "restore"})
    assert again.status_code == 409
    demo_login(client, "doctor_a")
    assert client.get(f"/api/hospital/records/{knee}/content").status_code == 200
    demo_login(client, "patient")
    assert client.get("/api/audit/verify").json()["valid"] is True


def test_medium_alert_decisions(client: TestClient) -> None:
    """The seed ships one open MEDIUM alert (Sam Lee, late night). looks_fine closes it; freeze
    on a MEDIUM alert freezes the grant."""
    demo_login(client, "patient")
    alerts = client.get("/api/patient/alerts").json()
    assert [a["status"] for a in alerts] == ["open"]
    seeded = alerts[0]
    assert seeded["risk_level"] == "medium" and seeded["reasons"][0]["kind"] == "off_hours"
    assert seeded["title"] == "Late-night access to your records"
    assert (
        client.post(
            f"/api/patient/alerts/{seeded['id']}/decision", json={"decision": "nope"}
        ).status_code
        == 422
    )
    fine = client.post(
        f"/api/patient/alerts/{seeded['id']}/decision", json={"decision": "looks_fine"}
    )
    assert fine.json()["status"] == "resolved" and fine.json()["decision"] == "looks_fine"
    assert client.get("/api/patient/access-log").json()[0]["summary"] == "Marked an alert as fine"

    # another patient cannot touch Maya's alerts
    demo_login(client, "patient2")
    assert (
        client.post(
            f"/api/patient/alerts/{seeded['id']}/decision", json={"decision": "freeze"}
        ).status_code
        == 404
    )

    # off-hours read through the attacker panel -> MEDIUM alert -> patient freezes
    demo_login(client, "admin")
    fired = client.post("/api/admin/scenarios/off_hours").json()
    assert fired["outcome"] == "allowed" and fired["risk_level"] == "medium"
    assert fired["reasons"][0]["kind"] == "off_hours" and "11:48 PM" in fired["reasons"][0]["text"]
    demo_login(client, "patient")
    open_alerts = [a for a in client.get("/api/patient/alerts").json() if a["status"] == "open"]
    assert len(open_alerts) == 1 and open_alerts[0]["title"] == "Unusual access to your records"
    assert "opened your Knee MRI report at 11:48 PM" in open_alerts[0]["summary"]
    frozen = client.post(
        f"/api/patient/alerts/{open_alerts[0]['id']}/decision", json={"decision": "freeze"}
    )
    assert frozen.json()["status"] == "acknowledged"
    assert client.get("/api/patient/vault").json()["current_grant"]["status"] == "frozen"
    assert (
        client.get("/api/patient/access-log").json()[0]["summary"]
        == "Froze Northside General Hospital's access"
    )
    demo_login(client, "nurse_a")
    assert (
        client.get(f"/api/hospital/patients/{MAYA}/groups").json()["detail"]["code"]
        == "access_frozen"
    )


# ---- VLT-7 -----------------------------------------------------------------------------------


def test_break_glass_emergency_access(client: TestClient) -> None:
    rx = _record_id(client, "Prescription: sertraline 50 mg")
    body = {"patient_id": MAYA, "justification": "ER: unresponsive patient, need medication list"}

    demo_login(client, "billing_a")
    assert client.post("/api/hospital/emergency", json=body).status_code == 403  # clerks cannot
    demo_login(client, "doctor_a")
    assert (
        client.post("/api/hospital/emergency", json=body).json()["detail"]["code"]
        == "already_granted"
    )
    demo_login(client, "admin")
    client.post("/api/admin/scenarios/clerk_sensitive")  # freezes Northside's key
    demo_login(client, "doctor_a")
    assert (
        client.post("/api/hospital/emergency", json=body).json()["detail"]["code"]
        == "access_frozen"
    )
    demo_login(client, "admin")
    client.post("/api/admin/reset")

    demo_login(client, "doctor_b")
    assert client.get(f"/api/hospital/records/{rx}").json()["detail"]["code"] == "no_grant"
    short = client.post("/api/hospital/emergency", json={"patient_id": MAYA, "justification": "hi"})
    assert short.status_code == 422
    opened = client.post("/api/hospital/emergency", json=body)
    assert opened.status_code == 201, opened.text
    emergency = opened.json()
    assert (
        emergency["hospital"]["code"] == "HOSP-B" and emergency["staff_name"] == "Dr. Amir Haddad"
    )
    assert client.post("/api/hospital/emergency", json=body).json()["id"] == emergency["id"]

    maya = next(p for p in client.get("/api/hospital/patients").json() if p["patient_id"] == MAYA)
    assert maya["key_status"] == "emergency"
    view = client.get(f"/api/hospital/patients/{MAYA}/groups").json()
    assert view["patient"]["key_status"] == "emergency" and view["groups"]
    assert client.get(f"/api/hospital/records/{rx}/content").status_code == 200

    demo_login(client, "patient")
    vault = client.get("/api/patient/vault").json()
    assert vault["current_grant"]["hospital"]["code"] == "HOSP-A"  # Northside still holds the key
    assert vault["emergency"]["id"] == emergency["id"]
    assert vault["emergency"]["justification"] == body["justification"]
    alerts = client.get("/api/patient/alerts").json()
    assert (
        alerts[0]["title"] == "Emergency access to your records"
        and alerts[0]["risk_level"] == "medium"
    )
    assert alerts[0]["reasons"][0]["kind"] == "emergency"
    flagged = client.get("/api/patient/access-log?filter=flagged").json()
    assert [e["summary"] for e in flagged[:3]] == [
        "Opened Prescription: sertraline 50 mg",
        "Viewed record list",
        "Used emergency access to your vault",
    ]
    assert flagged[0]["actor"]["hospital"] == "Riverbend Medical Center"
    assert all(e["reasons"][0]["kind"] == "emergency" for e in flagged[:3])

    assert client.post(f"/api/patient/emergency/{emergency['id']}/end").status_code == 204
    assert client.get("/api/patient/vault").json()["emergency"] is None
    assert (
        client.get("/api/patient/access-log").json()[0]["summary"]
        == "Ended emergency access for Riverbend Medical Center"
    )
    emergency_alert = next(
        a
        for a in client.get("/api/patient/alerts").json()
        if a["title"] == "Emergency access to your records"
    )
    assert emergency_alert["status"] == "resolved"
    assert client.post(f"/api/patient/emergency/{emergency['id']}/end").status_code == 409
    demo_login(client, "doctor_b")
    assert client.get(f"/api/hospital/records/{rx}").json()["detail"]["code"] == "no_grant"
    assert MAYA not in [p["patient_id"] for p in client.get("/api/hospital/patients").json()]


# ---- VLT-9 -----------------------------------------------------------------------------------


def test_event_bus_fans_out_to_matching_streams() -> None:
    async def scenario() -> list[tuple]:
        patient = events.subscribe(lambda e: e.patient_id == 1)
        hospital = events.subscribe(lambda e: e.hospital_id == 2 or e.kind == "reset")
        try:
            assert events.publish("alert", patient_id=1, hospital_id=1) == 1
            assert events.publish("grant", patient_id=1, hospital_id=2) == 2
            assert events.publish("request", patient_id=3) == 0
            assert events.publish("reset") == 1
            await asyncio.sleep(0)  # let call_soon_threadsafe callbacks run
            got = []
            for q in (patient.queue, hospital.queue):
                items = []
                while not q.empty():
                    items.append(q.get_nowait().kind)
                got.append(tuple(items))
            return got
        finally:
            events.unsubscribe(patient)
            events.unsubscribe(hospital)

    assert asyncio.run(scenario()) == [("alert", "grant"), ("grant", "reset")]
    assert events.subscriber_count() == 0
    assert events.sse("change", {"kind": "alert"}) == 'event: change\ndata: {"kind":"alert"}\n\n'


def test_event_streams_need_the_right_role(client: TestClient) -> None:
    assert client.get("/api/patient/events").status_code == 401
    demo_login(client, "doctor_a")
    assert client.get("/api/patient/events").status_code == 403
    demo_login(client, "patient")
    assert client.get("/api/hospital/events").status_code == 403


# ---- S5 / S6 ---------------------------------------------------------------------------------


def test_demo_panel_scenarios_and_reset(client: TestClient) -> None:
    demo_login(client, "patient")
    assert client.get("/api/admin/scenarios").status_code == 403
    maya_session = demo_login(client, "patient")
    admin = demo_login(client, "admin")
    scenarios = {s["id"]: s for s in client.get("/api/admin/scenarios").json()}
    assert set(scenarios) == {"clerk_sensitive", "off_hours", "revoked_read", "break_glass"}
    assert scenarios["clerk_sensitive"]["ready"] and scenarios["clerk_sensitive"]["hint"] is None
    assert scenarios["clerk_sensitive"]["actor"] == "Jordan Price · Billing clerk"
    assert (
        not scenarios["revoked_read"]["ready"]
        and "approve Riverbend" in scenarios["revoked_read"]["hint"]
    )
    assert client.post("/api/admin/scenarios/nope").status_code == 404

    fired = client.post("/api/admin/scenarios/clerk_sensitive").json()
    assert fired["outcome"] == "frozen" and fired["risk_level"] == "high"
    assert fired["code"] == "access_frozen" and fired["actor"] == "Jordan Price"
    assert [r["kind"] for r in fired["reasons"]] == ["role_mismatch", "sensitive_record"]
    assert "already frozen" in client.get("/api/admin/scenarios").json()[0]["hint"]
    again = client.post("/api/admin/scenarios/clerk_sensitive").json()
    assert again["outcome"] == "denied" and again["code"] == "access_frozen"

    glass = client.post("/api/admin/scenarios/break_glass").json()
    assert glass["outcome"] == "allowed" and glass["risk_level"] == "medium"
    assert glass["summary"] == "Opened Prescription: sertraline 50 mg"
    # Maya, still signed in on her phone, sees both
    vault = client.get("/api/patient/vault", headers=_bearer(maya_session)).json()
    assert vault["current_grant"]["status"] == "frozen" and vault["emergency"] is not None

    # reset: seed state is back and nobody was signed out
    assert client.post("/api/admin/reset", headers=_bearer(admin)).json()["ok"] is True
    assert client.get("/api/auth/me", headers=_bearer(admin)).status_code == 200
    vault = client.get("/api/patient/vault", headers=_bearer(maya_session)).json()
    assert vault["current_grant"]["status"] == "active" and vault["emergency"] is None
    alerts = client.get("/api/patient/alerts", headers=_bearer(maya_session)).json()
    assert len(alerts) == 1 and alerts[0]["status"] == "open"
    assert client.get("/api/audit/verify", headers=_bearer(admin)).json()["valid"] is True
