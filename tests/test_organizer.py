"""Phase 3.5: text extraction and tagger (ORG-2), encrypted tags through a key swap and the
access-rule wiring (ORG-3), group-by for patients and hospitals (ORG-4), evaluation (ORG-5)."""

from __future__ import annotations

import json
import zlib
from pathlib import Path

from fastapi.testclient import TestClient

from onetrace.config import REPO_ROOT
from onetrace.organizer import extract_text, tag_text
from onetrace.organizer_eval import evaluate, generate
from tests.conftest import demo_login

MAYA = 1
HOSP_B = 2
KNEE_NOTE = (
    "Knee MRI report\nMRI right knee without contrast, 2026-10-03. Findings: complex tear of the "
    "posterior horn of the medial meniscus. Read by Dr. Lina Park."
)


def _group(groups: list[dict], label: str) -> dict | None:
    return next((g for g in groups if g["label"] == label), None)


# ---- ORG-2 -----------------------------------------------------------------------------------


def test_tagger_fields_and_sensitivity() -> None:
    knee = tag_text(KNEE_NOTE, "text/plain")
    assert knee["tags"]["body_part"] == "Knee" and knee["tags"]["condition"] == "Orthopedics"
    assert knee["tags"]["record_type"] == "Imaging" and knee["category"] == "imaging"
    assert knee["tags"]["doctor"] == "Dr. Lina Park"
    assert knee["tags"]["date_of_service"] == "2026-10-03"
    assert knee["sensitivity"] == 1 and knee["tags"]["labels"][0] == "Knee"
    assert knee["tags"]["confidence"] >= 0.8

    psych = tag_text(
        "Therapy session 10/03/2026. Depressive symptoms improving, GAD-7 down to 8. "
        "Also reports knee pain from running. dr. marcus reed",
        "text/plain",
    )
    assert psych["sensitivity"] == 3 and psych["tags"]["condition"] == "Psychiatry"
    assert psych["tags"]["body_part"] is None  # a passing mention is not the subject
    assert psych["tags"]["doctor"] == "Dr. Marcus Reed"  # lower-cased note, title-cased name
    assert psych["tags"]["date_of_service"] == "2026-10-03"

    # short stems must end the word: "stiffness" is not an STI, "ct" is not in "contrast"
    plain = tag_text("Mild knee stiffness after the contrast injection.", "text/plain")
    assert plain["sensitivity"] == 1 and plain["tags"]["record_type"] == "Visit note"
    onc = tag_text(
        "Oncology consult: biopsy confirmed lymphoma, chemotherapy planned.", "text/plain"
    )
    assert onc["sensitivity"] == 2
    photo = tag_text("knee-xray.jpg", "image/jpeg")
    assert photo["tags"]["record_type"] == "Imaging" and photo["tags"]["confidence"] <= 0.3
    assert tag_text("scan.pdf", "application/pdf")["tags"]["record_type"] == "Imaging"
    assert tag_text("receipt.pdf", "application/pdf")["tags"]["record_type"] == "Document"


def _pdf(text: str, compress: bool) -> bytes:
    content = f"BT /F1 12 Tf 72 712 Td ({text}) Tj ET".encode()
    body = zlib.compress(content) if compress else content
    filt = b"/Filter /FlateDecode " if compress else b""
    return (
        b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n4 0 obj << "
        + filt
        + b"/Length "
        + str(len(body)).encode()
        + b" >>\nstream\n"
        + body
        + b"\nendstream\nendobj\n%%EOF\n"
    )


def test_pdf_text_extraction_and_upload(client: TestClient) -> None:
    assert "medial meniscus" in extract_text(
        _pdf("Knee MRI: medial meniscus tear", False), "application/pdf"
    )
    assert "medial meniscus" in extract_text(
        _pdf("Knee MRI: medial meniscus tear", True), "application/pdf"
    )
    assert extract_text(b"\x89PNG....", "image/png") == ""
    demo_login(client, "patient")
    created = client.post(
        "/api/patient/records",
        files={
            "file": (
                "report.pdf",
                _pdf("MRI right knee: meniscus tear. Dr. Lina Park", True),
                "application/pdf",
            )
        },
    )
    assert created.status_code == 201, created.text
    tags = created.json()["tags"]
    assert tags["body_part"] == "Knee" and tags["record_type"] == "Imaging"
    assert tags["doctor"] == "Dr. Lina Park" and created.json()["mime_type"] == "application/pdf"


# ---- ORG-3 / ORG-4 ---------------------------------------------------------------------------


def test_new_knee_note_shows_under_knee_and_tags_survive_key_swap(client: TestClient) -> None:
    """Phase 3.5 'done when', part 1: a new knee MRI note is tagged and grouped under Knee."""
    demo_login(client, "patient")
    created = client.post(
        "/api/patient/records",
        files={"file": ("knee-mri.txt", KNEE_NOTE.encode(), "text/plain")},
        data={"title": "Knee MRI, second opinion"},
    )
    assert created.status_code == 201
    new_id = created.json()["id"]
    knee = _group(client.get("/api/patient/records/groups?by=body_part").json(), "Knee")
    assert knee["count"] == 3 and new_id in [r["id"] for r in knee["records"]]
    assert _group(client.get("/api/patient/records/groups?by=doctor").json(), "Dr. Lina Park")
    assert (
        _group(client.get("/api/patient/records/groups?by=condition").json(), "Psychiatry")["count"]
        == 2
    )
    assert client.get("/api/patient/records/groups?by=bogus").status_code == 422

    # key swap re-encrypts the tags with the bytes; the new hospital still gets the same groups
    moved = client.post("/api/patient/transfer", json={"to_hospital_id": HOSP_B})
    assert moved.status_code == 200
    demo_login(client, "doctor_b")
    view = client.get(f"/api/hospital/patients/{MAYA}/groups?by=body_part").json()
    knee = _group(view["groups"], "Knee")
    assert knee["count"] == 3 and knee["top_doctor"]
    fresh = next(r for r in knee["records"] if r["id"] == new_id)
    assert fresh["tags"]["doctor"] == "Dr. Lina Park" and fresh["tags"]["labels"][0] == "Knee"
    assert client.get(f"/api/hospital/patients/{MAYA}/groups?by=bogus").status_code == 422
    assert client.get(f"/api/hospital/records/{new_id}/content").text.startswith("Knee MRI report")


def test_organizer_tags_drive_the_clerk_rule(client: TestClient) -> None:
    """Phase 3.5 'done when', part 2: a clerk opening a psychiatry-tagged record is flagged HIGH,
    including one the organizer tagged on upload rather than the seed."""
    demo_login(client, "patient")
    created = client.post(
        "/api/patient/records",
        files={
            "file": (
                "session.txt",
                b"Therapy session 2026-10-10 with Dr. Marcus Reed. Panic attacks less frequent.",
                "text/plain",
            )
        },
    )
    assert (
        created.json()["sensitivity"] == 3 and created.json()["tags"]["condition"] == "Psychiatry"
    )
    demo_login(client, "billing_a")
    blocked = client.get(f"/api/hospital/records/{created.json()['id']}/content")
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "access_frozen"
    demo_login(client, "patient")
    alert = client.get("/api/patient/alerts").json()[0]
    assert (
        alert["risk_level"] == "high"
        and alert["reasons"][1]["text"] == "Sensitive record (Psychiatry)"
    )


# ---- ORG-5 / DATA-1 --------------------------------------------------------------------------


def test_evaluation_meets_targets_and_report_is_current() -> None:
    records = generate()
    assert len(records) == 120 and records[0]["truth"]["body_part"] == "Knee"
    assert records == generate()  # deterministic: the committed data set is reproducible
    report = evaluate(records)
    assert report["mean_accuracy"] >= 0.9
    assert report["sensitive_records"]["recall"] >= 0.95
    assert report["sensitive_records"]["precision"] >= 0.9
    committed = json.loads(Path(REPO_ROOT, "reports", "eval.json").read_text())
    assert committed["accuracy"] == report["accuracy"]
    assert committed["sensitive_records"]["recall"] == report["sensitive_records"]["recall"]
