"""Phase 2: KMS (VLT-1), hash chain (VLT-2), broker (VLT-3), records (VLT-4), grants and requests
(VLT-5), key swap (VLT-6), hospital endpoints (VLT-8)."""

from __future__ import annotations

from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from onetrace import audit
from onetrace.kms import Kms
from onetrace.models import AccessLog, Record, Vault
from tests.conftest import demo_login

MAYA = 1  # patient ids follow seed.PATIENTS order
DANIEL = 2
HOSP_A, HOSP_B = 1, 2


def _record_id(client: TestClient, title: str) -> int:
    vault = client.get("/api/patient/vault").json()
    return next(r["id"] for r in vault["records"] if r["title"] == title)


# ---- VLT-1 -----------------------------------------------------------------------------------


def test_kms_envelope_roundtrip_and_binding() -> None:
    kms = Kms("secret-a")
    kek, wrapped = kms.new_vault_key(vault_id=7, version=1)
    vault = Vault(id=7, patient_id=1, key_version=1, wrapped_kek=wrapped)
    assert kms.unwrap_vault_key(vault) == kek
    record = Record(id=3, vault_id=7, patient_id=1, title="t")
    kms.encrypt_record(kek, record, b"hello", {"labels": ["x"]}, version=1)
    assert record.ciphertext != b"hello" and record.key_version == 1 and record.size_bytes == 5
    assert kms.decrypt_record(kek, record) == b"hello"
    assert kms.decrypt_tags(kek, record) == {"labels": ["x"]}
    # another secret, another vault version or a moved blob all fail closed
    try:
        Kms("secret-b").unwrap_vault_key(vault)
        raise AssertionError("wrong master key must not unwrap")
    except InvalidTag:
        pass
    record.key_version = 2
    try:
        kms.decrypt_record(kek, record)
        raise AssertionError("AAD binds the key version")
    except InvalidTag:
        pass


def test_seeded_records_are_encrypted_and_readable_only_via_broker(app, client: TestClient) -> None:
    with Session(app.state.engine) as s:
        rows = s.exec(select(Record)).all()
        assert all(r.is_encrypted and r.wrapped_dek and r.key_version == 1 for r in rows)
        assert not any(b"meniscus" in (r.ciphertext or b"") for r in rows)
    demo_login(client, "patient")
    rid = _record_id(client, "Knee MRI report")
    content = client.get(f"/api/patient/records/{rid}/content")
    assert content.status_code == 200 and b"meniscus" in content.content
    assert content.headers["content-type"].startswith("text/plain")


# ---- VLT-2 -----------------------------------------------------------------------------------


def test_audit_chain_verifies_and_detects_tampering(app, client: TestClient) -> None:
    demo_login(client, "patient")
    ok = client.get("/api/audit/verify").json()
    assert ok["valid"] is True and ok["entries"] >= 13 and ok["first_broken_entry"] is None
    with Session(app.state.engine) as s:
        rows = s.exec(select(AccessLog).order_by(AccessLog.id)).all()
        assert rows[0].prev_hash == audit.GENESIS
        assert all(b.prev_hash == a.entry_hash for a, b in zip(rows, rows[1:], strict=False))
        victim = rows[3]
        victim.summary = "Nothing to see here"
        s.add(victim)
        s.commit()
        broken_id = victim.id
    bad = client.get("/api/audit/verify").json()
    assert bad["valid"] is False and bad["first_broken_entry"] == broken_id


# ---- VLT-3, VLT-4, VLT-8: reads through the broker ------------------------------------------


def test_patient_vault_groups_and_logged_read(client: TestClient) -> None:
    demo_login(client, "patient")
    vault = client.get("/api/patient/vault").json()
    assert vault["patient"]["mrn"] == "MRN-100-2231" and vault["key_version"] == 1
    assert vault["current_grant"]["hospital"]["code"] == "HOSP-A"
    assert vault["current_grant"]["status"] == "active" and vault["past_grants"] == []
    assert len(vault["records"]) == 5 and all(r["tags"] for r in vault["records"])
    psych = next(r for r in vault["records"] if r["title"].startswith("Psychiatry"))
    assert psych["sensitivity"] == 3 and psych["tags"]["condition"] == "Psychiatry"

    groups = client.get("/api/patient/records/groups?by=body_part").json()
    knee = next(g for g in groups if g["label"] == "Knee")
    assert knee["count"] == 2 and knee["top_doctor"] == "Dr. Elena Vasquez"
    assert groups[-1]["label"] == "Other / Unknown"
    for by in ("doctor", "condition", "record_type", "date"):
        assert client.get(f"/api/patient/records/groups?by={by}").status_code == 200

    rid = _record_id(client, "Knee MRI report")
    assert client.get(f"/api/patient/records/{rid}").json()["title"] == "Knee MRI report"
    before = len(client.get("/api/patient/access-log?filter=all").json())
    assert client.get(f"/api/patient/records/{rid}/content").status_code == 200
    log = client.get("/api/patient/access-log?filter=all").json()
    assert len(log) == before + 1
    assert log[0]["actor"]["is_you"] and log[0]["summary"] == "Opened Knee MRI report"
    # another patient's record is invisible, not forbidden
    demo_login(client, "patient2")
    assert client.get(f"/api/patient/records/{rid}").status_code == 404


def test_upload_is_encrypted_tagged_and_sniffed(app, client: TestClient) -> None:
    demo_login(client, "patient")
    note = b"Follow-up with Dr. Lina Park on 2026-10-01. Right knee MRI shows the meniscus healing."
    created = client.post(
        "/api/patient/records",
        files={"file": ("knee.txt", note, "text/plain")},
        data={"title": "Knee check-up"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["title"] == "Knee check-up" and body["mime_type"] == "text/plain"
    assert body["tags"]["body_part"] == "Knee" and body["tags"]["doctor"] == "Dr. Lina Park"
    assert body["tags"]["date_of_service"] == "2026-10-01" and body["category"] == "imaging"
    with Session(app.state.engine) as s:
        row = s.get(Record, body["id"])
        assert row.is_encrypted and b"meniscus" not in row.ciphertext
    assert client.get(f"/api/patient/records/{body['id']}/content").content == note

    fake_pdf = client.post(
        "/api/patient/records", files={"file": ("x.pdf", b"MZ\x00\x01binary", "application/pdf")}
    )
    assert fake_pdf.status_code == 415 and fake_pdf.json()["detail"]["code"] == "invalid_file_type"
    summaries = [e["summary"] for e in client.get("/api/patient/access-log").json()[:2]]
    assert summaries == ["Opened Knee check-up", "Added Knee check-up"]


def test_hospital_patients_lookup_and_record_read(client: TestClient) -> None:
    demo_login(client, "doctor_a")
    patients = client.get("/api/hospital/patients").json()
    assert [p["full_name"] for p in patients] == ["Daniel Okafor", "Maya Chen"]
    assert patients[1]["key_status"] == "active" and patients[1]["last_visit"]
    assert [p["mrn"] for p in client.get("/api/hospital/patients?q=2231").json()] == [
        "MRN-100-2231"
    ]

    assert client.get("/api/hospital/patient-lookup?q=m").json() == []
    found = client.get("/api/hospital/patient-lookup?q=raman").json()
    assert found == [{"patient_id": 3, "full_name": "Priya Raman", "mrn": "MRN-100-7782"}]

    view = client.get(f"/api/hospital/patients/{MAYA}/groups?by=record_type").json()
    assert view["patient"]["mrn"] == "MRN-100-2231" and len(view["groups"]) == 5
    first = view["groups"][0]["records"][0]
    rid, title = first["id"], first["title"]
    assert client.get(f"/api/hospital/records/{rid}").status_code == 200
    assert client.get(f"/api/hospital/records/{rid}/content").status_code == 200

    # Hospital B holds no key for Maya: denied with a code, and the patient sees the attempt.
    demo_login(client, "doctor_b")
    denied = client.get(f"/api/hospital/patients/{MAYA}/groups")
    assert denied.status_code == 403 and denied.json()["detail"]["code"] == "no_grant"
    assert client.get(f"/api/hospital/records/{rid}").json()["detail"]["code"] == "no_grant"
    demo_login(client, "patient")
    denied_log = client.get("/api/patient/access-log?filter=denied").json()
    assert [e["summary"] for e in denied_log[:2]] == [
        f"Tried to open {title}",
        "Tried to view record list",
    ]
    assert denied_log[0]["actor"]["hospital"] == "Riverbend Medical Center"
    assert denied_log[0]["reasons"][0]["kind"] == "no_grant"
    # patients cannot use hospital routes and staff cannot use patient routes
    assert client.get("/api/hospital/patients").status_code == 403
    demo_login(client, "billing_a")
    assert client.get("/api/patient/vault").status_code == 403


# ---- VLT-5, VLT-6: the Phase 2 demo ---------------------------------------------------------


def test_key_swap_moves_vault_and_locks_out_old_hospital(app, client: TestClient) -> None:
    demo_login(client, "patient")
    rid = _record_id(client, "Knee MRI report")
    with Session(app.state.engine) as s:
        old_cipher = {r.id: (r.ciphertext, r.wrapped_dek) for r in s.exec(select(Record)).all()}

    # Hospital A reads fine today...
    demo_login(client, "doctor_a")
    assert client.get(f"/api/hospital/records/{rid}/content").status_code == 200

    # ...then Maya approves Riverbend's pending request, which is a key swap.
    demo_login(client, "patient")
    requests = client.get("/api/patient/requests").json()
    assert len(requests) == 1 and requests[0]["status"] == "pending"
    assert requests[0]["hospital"]["code"] == "HOSP-B"
    decided = client.post(
        f"/api/patient/requests/{requests[0]['id']}/decision", json={"decision": "approve"}
    )
    assert decided.status_code == 200 and decided.json()["status"] == "approved"

    vault = client.get("/api/patient/vault").json()
    assert vault["key_version"] == 2 and vault["rotated_at"]
    assert vault["current_grant"]["hospital"]["code"] == "HOSP-B"
    assert vault["past_grants"][0]["hospital"]["code"] == "HOSP-A"
    assert vault["past_grants"][0]["status"] == "transferred"
    assert (
        client.get("/api/patient/access-log")
        .json()[0]["summary"]
        .startswith("Moved your vault to Riverbend")
    )
    with Session(app.state.engine) as s:
        for r in s.exec(select(Record).where(Record.patient_id == MAYA)).all():
            assert r.key_version == 2
            assert (r.ciphertext, r.wrapped_dek) != old_cipher[r.id]  # new DEKs, new bytes
        for r in s.exec(select(Record).where(Record.patient_id != MAYA)).all():
            assert (r.ciphertext, r.wrapped_dek) == old_cipher[r.id]  # other vaults untouched
    assert client.get(f"/api/patient/records/{rid}/content").status_code == 200  # still readable

    # Hospital A is locked out and the attempt is logged for Maya.
    demo_login(client, "doctor_a")
    assert MAYA not in [p["patient_id"] for p in client.get("/api/hospital/patients").json()]
    blocked = client.get(f"/api/hospital/records/{rid}")
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "access_revoked"
    assert client.get(f"/api/hospital/patients/{MAYA}/groups").status_code == 403

    # Hospital B is in, and the request shows approved on its side.
    demo_login(client, "doctor_b")
    assert MAYA in [p["patient_id"] for p in client.get("/api/hospital/patients").json()]
    assert client.get(f"/api/hospital/records/{rid}/content").status_code == 200
    assert client.get("/api/hospital/requests").json()[0]["status"] == "approved"

    demo_login(client, "patient")
    denied = client.get("/api/patient/access-log?filter=denied").json()
    assert denied[0]["actor"]["name"] == "Dr. Elena Vasquez"
    assert denied[0]["deny_reason"] == "access revoked" and denied[0]["risk_level"] == "high"
    assert client.get("/api/audit/verify").json()["valid"] is True


def test_grant_transfer_and_request_rules(client: TestClient) -> None:
    demo_login(client, "patient")
    dup = client.post("/api/patient/grant", json={"hospital_id": HOSP_B})
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "already_granted"
    same = client.post("/api/patient/transfer", json={"to_hospital_id": HOSP_A})
    assert same.status_code == 409
    moved = client.post("/api/patient/transfer", json={"to_hospital_id": HOSP_B})
    assert moved.status_code == 200 and moved.json()["hospital"]["code"] == "HOSP-B"
    # the pending request from B was approved by the move
    assert client.get("/api/patient/requests").json()[0]["status"] == "approved"

    # Daniel: Riverbend asks, Daniel says no; Riverbend sees the denial.
    demo_login(client, "doctor_b")
    short = client.post("/api/hospital/request-access", json={"patient_id": DANIEL, "reason": "hi"})
    assert short.status_code == 422
    sent = client.post(
        "/api/hospital/request-access",
        json={"patient_id": DANIEL, "reason": "New patient, cardiology consult"},
    )
    assert sent.status_code == 201 and sent.json()["patient"]["full_name"] == "Daniel Okafor"
    again = client.post(
        "/api/hospital/request-access",
        json={"patient_id": DANIEL, "reason": "New patient, cardiology consult"},
    )
    assert again.status_code == 409 and again.json()["detail"]["code"] == "duplicate_request"
    demo_login(client, "doctor_a")
    own = client.post(
        "/api/hospital/request-access",
        json={"patient_id": DANIEL, "reason": "We already treat Daniel here"},
    )
    assert own.status_code == 409 and own.json()["detail"]["code"] == "already_granted"

    demo_login(client, "patient2")
    pending = client.get("/api/patient/requests").json()
    assert pending[0]["requested_by"] == "Dr. Amir Haddad" and pending[0]["status"] == "pending"
    denied = client.post(
        f"/api/patient/requests/{pending[0]['id']}/decision", json={"decision": "deny"}
    )
    assert denied.json()["status"] == "denied"
    twice = client.post(
        f"/api/patient/requests/{pending[0]['id']}/decision", json={"decision": "deny"}
    )
    assert twice.status_code == 409
    assert client.get("/api/patient/access-log").json()[0]["summary"].startswith("Denied Riverbend")
    demo_login(client, "doctor_b")
    assert client.get("/api/hospital/requests").json()[0]["status"] == "denied"
    assert client.get("/api/hospitals").json()[0]["code"] == "HOSP-A"
