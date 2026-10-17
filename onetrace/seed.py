"""Demo seed: two hospitals, three patients with records, staff for each hospital, one admin.

``python -m onetrace.seed`` wipes and re-seeds the configured database (S6 demo reset builds on
this). Every demo account signs in with DEMO_PASSWORD. Records are envelope-encrypted with the
KMS derived from ONETRACE_SECRET_KEY (change the secret, re-run the seed), tagged by the
organizer, and the access log starts with a valid hash chain.
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlmodel import Session, select

from onetrace import audit, rules
from onetrace.config import get_settings
from onetrace.db import drop_db, init_db, make_engine
from onetrace.kms import Kms
from onetrace.models import (
    AccessAction,
    AccessOutcome,
    AccessRequest,
    Alert,
    AuthSession,
    CareEpisode,
    Grant,
    Hospital,
    Patient,
    Record,
    RecordCategory,
    RiskLevel,
    Role,
    StaffRole,
    User,
    Vault,
    utcnow,
)
from onetrace.organizer import TYPE_LABEL, tag_text
from onetrace.security import hash_password

DEMO_PASSWORD = "onetrace-demo"

HOSPITALS = [
    ("HOSP-A", "Northside General Hospital", "Dallas"),
    ("HOSP-B", "Riverbend Medical Center", "Fort Worth"),
]

# (persona key, email, full name, role, staff role, hospital code)
USERS = [
    ("patient", "maya.chen@patient.example", "Maya Chen", Role.PATIENT, None, None),
    ("patient2", "daniel.okafor@patient.example", "Daniel Okafor", Role.PATIENT, None, None),
    ("patient3", "priya.raman@patient.example", "Priya Raman", Role.PATIENT, None, None),
    ("doctor_a", "elena.vasquez@northside.example", "Dr. Elena Vasquez", Role.STAFF, StaffRole.PHYSICIAN, "HOSP-A"),
    ("nurse_a", "sam.lee@northside.example", "Sam Lee", Role.STAFF, StaffRole.NURSE, "HOSP-A"),
    ("billing_a", "jordan.price@northside.example", "Jordan Price", Role.STAFF, StaffRole.BILLING_CLERK, "HOSP-A"),
    ("doctor_b", "amir.haddad@riverbend.example", "Dr. Amir Haddad", Role.STAFF, StaffRole.PHYSICIAN, "HOSP-B"),
    ("admin", "admin@onetrace.example", "Demo Control", Role.ADMIN, None, None),
]  # fmt: skip

PERSONA_DESCRIPTIONS = {
    "patient": "Patient. Owns the vault; grants, moves and revokes hospital access.",
    "patient2": "Patient treated at Northside General (Hospital A).",
    "patient3": "Patient treated at Riverbend Medical Center (Hospital B).",
    "doctor_a": "Physician at Northside General (Hospital A). Treats Maya and Daniel.",
    "nurse_a": "Nurse at Northside General (Hospital A).",
    "billing_a": "Billing clerk at Northside General (Hospital A). The insider in the scraping demo.",
    "doctor_b": "Physician at Riverbend Medical Center (Hospital B). Maya transfers here.",
    "admin": "Demo control: attacker panel and demo reset.",
}

# persona key -> (MRN, date of birth, hospital currently treating them)
PATIENTS = {
    "patient": ("MRN-100-2231", date(1988, 4, 12), "HOSP-A"),
    "patient2": ("MRN-100-4410", date(1975, 11, 3), "HOSP-A"),
    "patient3": ("MRN-100-7782", date(1996, 7, 21), "HOSP-B"),
}

# (patient persona, title, category, source hospital, days ago, body)
RECORDS = [
    ("patient", "Knee MRI report", RecordCategory.IMAGING, "HOSP-A", 9,
     "MRI right knee without contrast. Findings: complex tear of the posterior horn of the medial "
     "meniscus. Moderate joint effusion. ACL and PCL intact. Impression: medial meniscus tear."),
    ("patient", "Comprehensive metabolic panel", RecordCategory.LAB, "HOSP-A", 8,
     "Sodium 139 mmol/L, potassium 4.1 mmol/L, glucose 92 mg/dL, creatinine 0.8 mg/dL, "
     "ALT 21 U/L, AST 19 U/L. All values within reference range."),
    ("patient", "Psychiatry follow-up note", RecordCategory.NOTE, "HOSP-A", 30,
     "Follow-up for generalised anxiety disorder. Reports improved sleep on sertraline 50 mg. "
     "PHQ-9 score 6. Plan: continue current dose, review in 12 weeks."),
    ("patient", "Prescription: sertraline 50 mg", RecordCategory.PRESCRIPTION, "HOSP-A", 30,
     "Sertraline 50 mg tablet, one daily by mouth, 90-day supply, 1 refill."),
    ("patient", "Discharge summary: knee arthroscopy", RecordCategory.DISCHARGE, "HOSP-A", 2,
     "Day-case arthroscopic partial medial meniscectomy, right knee. No complications. "
     "Discharged with crutches; physiotherapy referral; follow-up in 2 weeks."),
    ("patient2", "Echocardiogram report", RecordCategory.IMAGING, "HOSP-A", 14,
     "Transthoracic echo. LVEF 58%. Mild mitral regurgitation. No pericardial effusion."),
    ("patient2", "Lipid panel", RecordCategory.LAB, "HOSP-A", 14,
     "Total cholesterol 212 mg/dL, LDL 138 mg/dL, HDL 44 mg/dL, triglycerides 150 mg/dL."),
    ("patient3", "Allergy test results", RecordCategory.LAB, "HOSP-B", 20,
     "Skin prick testing positive for dust mite and cat dander. Negative for peanut and shellfish."),
    ("patient3", "Physical therapy plan", RecordCategory.NOTE, "HOSP-B", 5,
     "Rotator cuff strain, left shoulder. 6-week programme: scapular stabilisation, band work."),
]  # fmt: skip


def reset_and_seed(engine, kms: Kms, *, keep_sessions: bool = False) -> dict[str, int]:
    """Drop everything and load the demo data set. Returns row counts per table.

    ``keep_sessions`` carries the signed-in sessions across the reset (S6 from the demo panel):
    user ids are stable because the seed is deterministic, so every phone stays signed in."""
    kept: list[dict] = []
    if keep_sessions:
        with Session(engine) as s:
            kept = [row.model_dump(exclude={"id"}) for row in s.exec(select(AuthSession)).all()]
    drop_db(engine)
    init_db(engine)
    now = utcnow()
    password_hash = hash_password(DEMO_PASSWORD)
    with Session(engine) as s:
        hospitals: dict[str, Hospital] = {}
        for code, name, city in HOSPITALS:
            hospitals[code] = Hospital(code=code, name=name, city=city)
            s.add(hospitals[code])
        s.flush()

        users: dict[str, User] = {}
        for key, email, full_name, role, staff_role, hospital_code in USERS:
            users[key] = User(
                email=email,
                full_name=full_name,
                role=role,
                staff_role=staff_role,
                hospital_id=hospitals[hospital_code].id if hospital_code else None,
                password_hash=password_hash,
                demo_persona=key,
            )
            s.add(users[key])
        s.flush()
        for row in kept:  # user ids are the same as before the reset
            s.add(AuthSession(**row))

        patients: dict[str, Patient] = {}
        vaults: dict[str, Vault] = {}
        keks: dict[str, bytes] = {}
        for key, (mrn, dob, hospital_code) in PATIENTS.items():
            patients[key] = Patient(user_id=users[key].id, mrn=mrn, date_of_birth=dob)
            s.add(patients[key])
            s.flush()
            vaults[key] = Vault(patient_id=patients[key].id, key_version=1)
            s.add(vaults[key])
            s.flush()
            keks[key], vaults[key].wrapped_kek = kms.new_vault_key(vaults[key].id, 1)
            hospital = hospitals[hospital_code]
            s.add(
                Grant(
                    patient_id=patients[key].id,
                    hospital_id=hospital.id,
                    key_version=1,
                    granted_by_user_id=users[key].id,
                    granted_at=now - timedelta(days=40),
                )
            )
            audit.append(
                s,
                action=AccessAction.GRANT_CREATE,
                outcome=AccessOutcome.ALLOWED,
                summary=f"Gave {hospital.name} a key to your vault",
                actor=users[key],
                hospital_id=hospital.id,
                patient_id=patients[key].id,
                ts=now - timedelta(days=40),
            )
            s.add(
                CareEpisode(
                    patient_id=patients[key].id,
                    hospital_id=hospital.id,
                    reason="Ongoing care",
                    started_at=now - timedelta(days=40),
                )
            )
        s.flush()

        for key, title, category, hospital_code, days_ago, body in RECORDS:
            uploader = users["doctor_a" if hospital_code == "HOSP-A" else "doctor_b"]
            created = now - timedelta(days=days_ago)
            tagged = tag_text(
                f"{title}\n{body}",
                "text/plain",
                doctor=uploader.full_name,
                date_of_service=created.date().isoformat(),
            )
            tagged["tags"]["record_type"] = TYPE_LABEL[category]  # the seed knows the type
            record = Record(
                vault_id=vaults[key].id,
                patient_id=patients[key].id,
                title=title,
                category=category,
                sensitivity=tagged["sensitivity"],
                uploaded_by_user_id=uploader.id,
                source_hospital_id=hospitals[hospital_code].id,
                created_at=created,
            )
            s.add(record)
            s.flush()
            kms.encrypt_record(keks[key], record, body.encode("utf-8"), tagged["tags"], 1)
            audit.append(
                s,
                action=AccessAction.RECORD_UPLOAD,
                outcome=AccessOutcome.ALLOWED,
                summary=f"Added {title}",
                actor=uploader,
                hospital_id=hospitals[hospital_code].id,
                patient_id=patients[key].id,
                record_id=record.id,
                ts=created,
            )

        # Dr. Vasquez read Maya's MRI this morning: the first hospital read in her history.
        knee_mri = s.exec(select(Record).where(Record.title == "Knee MRI report")).one()
        audit.append(
            s,
            action=AccessAction.RECORD_VIEW,
            outcome=AccessOutcome.ALLOWED,
            summary="Opened Knee MRI report",
            actor=users["doctor_a"],
            hospital_id=hospitals["HOSP-A"].id,
            patient_id=patients["patient"].id,
            record_id=knee_mri.id,
            ts=now - timedelta(hours=5),
        )

        # Sam Lee looked at Maya's record list late last night: the off-hours rule flagged it
        # MEDIUM and raised the open alert the Alerts tab shows from the first login (P12).
        late = (now - timedelta(days=1)).astimezone(rules.local_tz()).replace(hour=23, minute=48)
        verdict = rules.assess(users["nurse_a"], None, at=late)
        entry = audit.append(
            s,
            action=AccessAction.RECORD_LIST,
            outcome=AccessOutcome.ALLOWED,
            summary="Viewed record list",
            actor=users["nurse_a"],
            hospital_id=hospitals["HOSP-A"].id,
            patient_id=patients["patient"].id,
            risk_level=RiskLevel.MEDIUM,
            reasons=verdict.reasons,
            ts=late,
        )
        s.add(
            Alert(
                patient_id=patients["patient"].id,
                grant_id=s.exec(select(Grant).where(Grant.patient_id == patients["patient"].id))
                .one()
                .id,
                access_log_id=entry.id,
                risk_level=RiskLevel.MEDIUM,
                title="Late-night access to your records",
                explanation=(
                    f"{rules.describe(s, users['nurse_a'])}, opened your record list at "
                    f"{rules.fmt_time(late)}."
                ),
                created_at=late,
            )
        )

        # Hospital B has asked Maya for access: drives the approve/deny demo (P9).
        s.add(
            AccessRequest(
                patient_id=patients["patient"].id,
                hospital_id=hospitals["HOSP-B"].id,
                requested_by_user_id=users["doctor_b"].id,
                reason="Orthopaedic referral: second opinion on knee MRI",
                created_at=now - timedelta(hours=3),
            )
        )
        audit.append(
            s,
            action=AccessAction.REQUEST_CREATE,
            outcome=AccessOutcome.ALLOWED,
            summary="Requested access to your vault",
            actor=users["doctor_b"],
            hospital_id=hospitals["HOSP-B"].id,
            patient_id=patients["patient"].id,
            ts=now - timedelta(hours=3),
        )
        s.commit()

        return {
            "hospitals": len(hospitals),
            "users": len(users),
            "patients": len(patients),
            "records": len(RECORDS),
            "grants": len(patients),
            "access_requests": 1,
        }


def seed_if_empty(engine, kms: Kms) -> bool:
    init_db(engine)
    with Session(engine) as s:
        if s.exec(select(User.id).limit(1)).first() is not None:
            return False
    reset_and_seed(engine, kms)
    return True


def main() -> None:
    settings = get_settings()
    counts = reset_and_seed(make_engine(settings.database_url), Kms(settings.secret_key))
    print(f"Seeded {settings.database_url}: {counts}")
    print(f"Demo password for every account: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
