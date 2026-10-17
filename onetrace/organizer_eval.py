"""DATA-1 + ORG-5: synthetic tagged records and the organizer's evaluation.

``python -m onetrace.organizer_eval`` writes ``reports/synthetic_records.json`` (the data set,
deterministic) and ``reports/eval.json`` (per-field accuracy, sensitive-record recall). The
templates live in ``vocab.NOTE_TEMPLATES``; generation adds a doctor, a date, and some noise
(a prefix line, a trailing unrelated sentence, lower-cased text) so the score is not a tautology.
"""

from __future__ import annotations

import json
import random
from datetime import date, timedelta

from onetrace.config import REPO_ROOT
from onetrace.organizer import tag_text
from onetrace.vocab import DOCTORS, NOTE_TEMPLATES

REPORTS = REPO_ROOT / "reports"
FIELDS = ("body_part", "condition", "record_type", "doctor", "date_of_service")
NOISE = [
    "Patient also asked about travel vaccinations; deferred.",
    "Parking validated. Next appointment to be booked by reception.",
    "Interpreter not required. Consent recorded.",
    "Blood pressure checked at the front desk, within normal limits.",
    "",
]


def generate(n: int = 120, seed: int = 2026) -> list[dict]:
    rng = random.Random(seed)
    base = date(2026, 1, 5)
    out = []
    for i in range(n):
        title, record_type, body_part, condition, sensitivity, template = NOTE_TEMPLATES[
            i % len(NOTE_TEMPLATES)
        ]
        doctor = rng.choice(DOCTORS)
        day = (base + timedelta(days=rng.randint(0, 270))).isoformat()
        text = template.format(doctor=doctor, date=day)
        if rng.random() < 0.3:
            text = f"Record {i + 1} · scanned copy\n{text}"
        text = f"{text} {rng.choice(NOISE)}".strip()
        if rng.random() < 0.2:
            text = text.lower()
            doctor_truth = doctor  # the regex needs capitals; lower-cased notes test the fallback
        else:
            doctor_truth = doctor
        out.append(
            {
                "id": i + 1,
                "title": title,
                "mime": "text/plain",
                "text": text,
                "truth": {
                    "body_part": body_part,
                    "condition": condition,
                    "record_type": record_type,
                    "doctor": doctor_truth,
                    "date_of_service": day,
                    "sensitivity": sensitivity,
                },
            }
        )
    return out


def evaluate(records: list[dict]) -> dict:
    """Per-field accuracy plus sensitive-record (level 3) recall and precision."""
    correct = dict.fromkeys(FIELDS, 0)
    sens = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    misses: list[dict] = []
    for r in records:
        result = tag_text(f"{r['title']}\n{r['text']}", r["mime"])
        tags, truth = result["tags"], r["truth"]
        wrong = [f for f in FIELDS if tags.get(f) != truth[f]]
        for f in FIELDS:
            if f not in wrong:
                correct[f] += 1
        predicted = result["sensitivity"] == 3
        actual = truth["sensitivity"] == 3
        key = "tp" if predicted and actual else "fp" if predicted else "fn" if actual else "tn"
        sens[key] += 1
        if wrong or (predicted != actual):
            misses.append(
                {
                    "id": r["id"],
                    "title": r["title"],
                    "wrong": {f: {"got": tags.get(f), "want": truth[f]} for f in wrong},
                    "sensitivity": {"got": result["sensitivity"], "want": truth["sensitivity"]},
                }
            )
    n = len(records)
    recall = sens["tp"] / (sens["tp"] + sens["fn"]) if sens["tp"] + sens["fn"] else 1.0
    precision = sens["tp"] / (sens["tp"] + sens["fp"]) if sens["tp"] + sens["fp"] else 1.0
    accuracy = {f: round(correct[f] / n, 3) for f in FIELDS}
    return {
        "records": n,
        "tagger": "keyword",
        "accuracy": accuracy,
        "mean_accuracy": round(sum(accuracy.values()) / len(FIELDS), 3),
        "sensitive_records": {
            **sens,
            "recall": round(recall, 3),
            "precision": round(precision, 3),
        },
        "misses": misses[:25],
    }


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    records = generate()
    (REPORTS / "synthetic_records.json").write_text(json.dumps(records, indent=1) + "\n")
    report = evaluate(records)
    (REPORTS / "eval.json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "misses"}, indent=1))
    print(f"{len(report['misses'])} records with at least one wrong field (see reports/eval.json)")


if __name__ == "__main__":
    main()
