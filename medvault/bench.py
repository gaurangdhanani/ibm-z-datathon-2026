"""FND-7: benchmark the vault's crypto and read paths on this machine, laptop vs LinuxONE.

``python -m medvault.bench`` (or ``make bench``) writes ``reports/bench-<machine>.json`` with
AES-256-GCM throughput, per-record envelope encryption, a broker read (authorise, rules, chained
log entry, decrypt), a full key swap (VLT-6) over a vault of 64 KiB records, and verifying a long
audit chain. Run it on the laptop and on the LinuxONE VM (s390x); the Dashboard (S4) shows every
``bench-*.json`` side by side. Everything runs in-process against an in-memory SQLite copy of the
demo seed, so the numbers are the machine's, not the network's.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import ssl
import time
from collections.abc import Callable
from datetime import datetime, timezone
from statistics import median

import cryptography
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlmodel import Session, select

from medvault import audit, broker
from medvault.config import REPO_ROOT
from medvault.db import init_db, make_engine
from medvault.kms import Kms, new_key
from medvault.models import (
    AccessAction,
    AccessOutcome,
    Hospital,
    Patient,
    Record,
    RecordCategory,
    User,
)
from medvault.patient import key_swap
from medvault.seed import reset_and_seed

REPORTS = REPO_ROOT / "reports"
MIB = 1024 * 1024
RECORD_BYTES = 64 * 1024
TAGS = {
    "body_part": "Knee",
    "condition": None,
    "doctor": "Dr. Elena Vasquez",
    "record_type": "Imaging",
    "date_of_service": "2026-10-01",
    "labels": ["benchmark"],
    "tagger": "keyword",
    "confidence": 0.9,
}

METRICS = (
    "aes_gcm_encrypt",
    "aes_gcm_decrypt",
    "record_encrypt",
    "broker_read",
    "key_swap",
    "audit_verify",
)

# iterations: full run vs --quick (tests)
SIZES = {
    "aes": (50, 3),
    "record_encrypt": (200, 10),
    "broker_read": (200, 10),
    "extra_records": (24, 8),
    "key_swaps": (10, 2),
    "chain_entries": (1000, 100),
    "verify": (5, 2),
}


def timed(fn: Callable[[], object], iterations: int) -> list[float]:
    """Run ``fn`` ``iterations`` times; return each call's duration in milliseconds."""
    samples = []
    for _ in range(iterations):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000)
    return samples


def percentile(samples: list[float], p: float) -> float:
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1)))]


def result(
    title: str, unit: str, better: str, samples: list[float], value: float, **extra: object
) -> dict:
    return {
        "title": title,
        "unit": unit,
        "better": better,
        "value": round(value, 3),
        "iterations": len(samples),
        "p50_ms": round(median(samples), 3),
        "p95_ms": round(percentile(samples, 95), 3),
        **extra,
    }


def machine_info() -> dict:
    machine = platform.machine()
    return {
        "label": "LinuxONE (s390x)" if machine == "s390x" else f"Laptop ({machine})",
        "machine": machine,
        "system": platform.system(),
        "release": platform.release(),
        "python": platform.python_version(),
        "hostname": platform.node(),
        "cpus": os.cpu_count(),
        "openssl": ssl.OPENSSL_VERSION,
        "cryptography": cryptography.__version__,
    }


def run(quick: bool = False) -> dict:
    n = {k: v[1] if quick else v[0] for k, v in SIZES.items()}
    results: dict[str, dict] = {}

    # 1. raw AES-256-GCM on 1 MiB (what CPACF accelerates on s390x)
    aes, nonce, plain = AESGCM(new_key()), os.urandom(12), os.urandom(MIB)
    cipher = aes.encrypt(nonce, plain, None)
    enc = timed(lambda: aes.encrypt(nonce, plain, None), n["aes"])
    results["aes_gcm_encrypt"] = result(
        "AES-256-GCM encrypt, 1 MiB", "MB/s", "higher", enc, 1000 / median(enc), payload_bytes=MIB
    )
    dec = timed(lambda: aes.decrypt(nonce, cipher, None), n["aes"])
    results["aes_gcm_decrypt"] = result(
        "AES-256-GCM decrypt, 1 MiB", "MB/s", "higher", dec, 1000 / median(dec), payload_bytes=MIB
    )

    # 2. the demo seed in memory, plus a vault full of 64 KiB records for Maya
    kms = Kms("benchmark")
    engine = make_engine("sqlite://")
    init_db(engine)
    reset_and_seed(engine, kms)
    session = Session(engine)
    maya_user = session.exec(select(User).where(User.demo_persona == "patient")).one()
    doctor = session.exec(select(User).where(User.demo_persona == "doctor_a")).one()
    maya = session.exec(select(Patient).where(Patient.user_id == maya_user.id)).one()
    vault = broker.vault_of(session, maya.id)
    kek = kms.unwrap_vault_key(vault)
    body = os.urandom(RECORD_BYTES)
    records: list[Record] = []
    for i in range(n["extra_records"]):
        record = Record(
            vault_id=vault.id,
            patient_id=maya.id,
            title=f"Benchmark record {i + 1}",
            category=RecordCategory.IMAGING,
            mime_type="application/pdf",
            uploaded_by_user_id=maya_user.id,
        )
        session.add(record)
        session.flush()
        kms.encrypt_record(kek, record, body, TAGS, vault.key_version)
        records.append(record)
    session.commit()

    # 3. envelope-encrypting one record: fresh DEK, wrap under the KEK, encrypt bytes and tags
    spare = records[0]
    samples = timed(
        lambda: kms.encrypt_record(kek, spare, body, TAGS, vault.key_version), n["record_encrypt"]
    )
    results["record_encrypt"] = result(
        "Encrypt one 64 KiB record",
        "ms",
        "lower",
        samples,
        median(samples),
        payload_bytes=RECORD_BYTES,
    )

    # 4. a hospital read through the broker: authorise, rules, chained log entry, commit, decrypt
    target = records[-1]
    samples = timed(lambda: broker.open_record(session, kms, doctor, target), n["broker_read"])
    results["broker_read"] = result(
        "Hospital reads one record (broker)",
        "ms",
        "lower",
        samples,
        median(samples),
        payload_bytes=RECORD_BYTES,
    )

    # 5. key swap: new KEK, every record re-encrypted under a new DEK, grants moved, one transaction
    hospitals = {h.id: h for h in session.exec(select(Hospital)).all()}
    count = len(session.exec(select(Record).where(Record.vault_id == vault.id)).all())
    swaps: list[float] = []
    for i in range(n["key_swaps"]):
        to = hospitals[2 if i % 2 == 0 else 1]  # Northside -> Riverbend -> Northside ...
        start = time.perf_counter()
        key_swap(session, kms, maya_user, maya, vault, to)
        session.commit()
        swaps.append((time.perf_counter() - start) * 1000)
    results["key_swap"] = result(
        f"Key swap, {count} records re-encrypted", "ms", "lower", swaps, median(swaps),
        records=count, per_record_ms=round(median(swaps) / count, 3),
    )  # fmt: skip

    # 6. verifying the hash chain end to end
    while len(session.exec(select(audit.AccessLog.id)).all()) < n["chain_entries"]:
        audit.append(
            session,
            action=AccessAction.RECORD_LIST,
            outcome=AccessOutcome.ALLOWED,
            summary="Viewed record list",
            actor=doctor,
            hospital_id=doctor.hospital_id,
            patient_id=maya.id,
        )
    session.commit()
    entries = audit.verify(session)["entries"]
    samples = timed(lambda: audit.verify(session), n["verify"])
    results["audit_verify"] = result(
        f"Verify a {entries}-entry audit chain",
        "ms",
        "lower",
        samples,
        median(samples),
        entries=entries,
    )
    session.close()
    engine.dispose()

    return {
        **machine_info(),
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "quick": quick,
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--quick", action="store_true", help="tiny run (what the tests use)")
    parser.add_argument(
        "--out", help=f"output file (default reports/bench-{platform.machine()}.json)"
    )
    args = parser.parse_args()
    report = run(quick=args.quick)
    out = REPO_ROOT / (args.out or REPORTS / f"bench-{report['machine']}.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=1) + "\n")
    info = report
    print(f"{info['label']} · {info['system']} · Python {info['python']} · {info['cpus']} CPUs")
    for r in report["results"].values():
        print(f"  {r['title']:<42} {r['value']:>10.2f} {r['unit']}   (p95 {r['p95_ms']:.2f} ms)")
    print(f"wrote {out.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
