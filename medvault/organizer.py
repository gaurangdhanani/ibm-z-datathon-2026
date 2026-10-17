"""Record organizer: keyword tagger and group-by views.

Stand-in for ORG-2 (tagger) and ORG-4 (group-by API) so the Phase 2 screens show tags from day
one; those tickets replace the internals, not the signatures. Tags live encrypted under the
record's DEK (``Record.encrypted_tags``) and are only decrypted inside the broker.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from medvault.models import RecordCategory
from medvault.schemas import GroupBy, RecordGroup, RecordSummary


@dataclass(frozen=True)
class Term:
    pattern: re.Pattern
    label: str
    body_part: str | None = None
    condition: str | None = None
    record_type: str | None = None
    sensitive: bool = False


def _t(regex: str, label: str, **kw) -> Term:
    return Term(re.compile(regex, re.IGNORECASE), label, **kw)


VOCAB = [
    _t(r"\b(knee|acl|menisc\w*|patella)\b", "Knee", body_part="Knee", condition="Orthopedics"),
    _t(r"\b(shoulder|rotator cuff)\b", "Shoulder", body_part="Shoulder", condition="Orthopedics"),
    _t(r"\b(heart|cardi\w*|echo\w*|ecg|ekg)\b", "Heart", body_part="Heart", condition="Cardiology"),
    _t(r"\b(lungs?|asthma|chest x-?ray)\b", "Lungs", body_part="Lungs", condition="Pulmonology"),
    _t(r"\b(skin|rash|derma\w*)\b", "Skin", body_part="Skin", condition="Dermatology"),
    _t(r"\b(psychiatr\w*|anxiety|depress\w*|therapy session|sertraline)\b", "Mental health",
       condition="Psychiatry", sensitive=True),
    _t(r"\b(hiv|sti|std)\b", "Sexual health", condition="Sexual health", sensitive=True),
    _t(r"\b(brca|genetic\w*)\b", "Genetic", condition="Genetics", sensitive=True),
    _t(r"\b(hba1c|diabet\w*)\b", "Diabetes", condition="Endocrinology"),
    _t(r"\bmri\b", "MRI", record_type="Imaging"),
    _t(r"\b(x-?ray|ct scan|ultrasound|imaging)\b", "Imaging", record_type="Imaging"),
    _t(r"\b(blood|panel|lab|cbc)\b", "Blood test", record_type="Lab result"),
    _t(r"\b(vaccin\w*|tetanus|immuni[sz]ation)\b", "Vaccination", record_type="Vaccination"),
    _t(r"\b(prescription|rx)\b", "Prescription", record_type="Prescription"),
    _t(r"\bdischarge\b", "Discharge", record_type="Discharge summary"),
]  # fmt: skip

TYPE_LABEL: dict[RecordCategory, str] = {
    RecordCategory.IMAGING: "Imaging",
    RecordCategory.LAB: "Lab result",
    RecordCategory.NOTE: "Visit note",
    RecordCategory.PRESCRIPTION: "Prescription",
    RecordCategory.DISCHARGE: "Discharge summary",
    RecordCategory.OTHER: "Document",
}
CATEGORY_OF = {label: category for category, label in TYPE_LABEL.items()}
OTHER_GROUP = "Other / Unknown"

_DOCTOR = re.compile(r"\bDr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)")
_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")


def tag_text(
    text: str, mime: str, *, doctor: str | None = None, date_of_service: str | None = None
) -> dict:
    """Returns ``{"tags": RecordTags-shaped dict, "sensitivity": 1 | 3, "category": category}``.

    ``doctor`` / ``date_of_service`` override what the text says (the uploader, the upload date).
    """
    hits = [term for term in VOCAB if term.pattern.search(text)]

    def first(field: str) -> str | None:
        return next((getattr(h, field) for h in hits if getattr(h, field)), None)

    doc = _DOCTOR.search(text)
    day = _DATE.search(text)
    if mime.startswith("image/"):
        fallback = "Photo"
    elif mime == "application/pdf":
        fallback = "Document"
    else:
        fallback = "Visit note"
    record_type = first("record_type") or fallback
    confidence = min(1.0, (len(hits) + (1 if doc else 0)) / 4)
    if mime.startswith("image/"):
        confidence = min(confidence, 0.3)  # no OCR: the title is all we have
    labels: list[str] = []
    for h in hits:
        if h.label not in labels:
            labels.append(h.label)
    return {
        "tags": {
            "body_part": first("body_part"),
            "condition": first("condition"),
            "doctor": doctor or (f"Dr. {doc.group(1)}" if doc else None),
            "record_type": record_type,
            "date_of_service": date_of_service or (day.group(1) if day else None),
            "labels": labels[:3],
            "tagger": "keyword",
            "confidence": round(confidence, 2),
        },
        "sensitivity": 3 if any(h.sensitive for h in hits) else 1,  # ties go to the higher one
        "category": CATEGORY_OF.get(record_type, RecordCategory.OTHER),
    }


def _group_key(r: RecordSummary, by: GroupBy) -> tuple[str, str] | None:
    t = r.tags
    assert t is not None
    if by == "date":
        iso = t.date_of_service or r.created_at.date().isoformat()
        return iso[:7], datetime.strptime(iso[:7], "%Y-%m").strftime("%B %Y")
    value = {
        "doctor": t.doctor,
        "body_part": t.body_part,
        "condition": t.condition,
        "record_type": t.record_type,
    }[by]
    return (value.lower(), value) if value else None


def group_records(records: list[RecordSummary], by: GroupBy) -> list[RecordGroup]:
    """Same output as the frontend mock's groupRecords: 'Just added' first, Other / Unknown last."""
    groups: dict[str, RecordGroup] = {}
    other: list[RecordSummary] = []
    organizing = [r for r in records if r.tags is None]
    for r in records:
        if r.tags is None:
            continue
        found = _group_key(r, by)
        if found is None:
            other.append(r)
            continue
        key, label = found
        group = groups.setdefault(
            key, RecordGroup(key=key, label=label, count=0, top_doctor=None, records=[])
        )
        group.records.append(r)
        group.count += 1
    if by == "date":
        ordered = sorted(groups.values(), key=lambda g: g.key, reverse=True)
    else:
        ordered = sorted(groups.values(), key=lambda g: (-g.count, g.label))
    if other:
        ordered.append(
            RecordGroup(
                key="other", label=OTHER_GROUP, count=len(other), top_doctor=None, records=other
            )
        )
    if organizing:
        ordered.insert(
            0,
            RecordGroup(
                key="organizing",
                label="Just added",
                count=len(organizing),
                top_doctor=None,
                records=organizing,
            ),
        )
    if by != "doctor":
        for g in ordered:
            counts: dict[str, int] = {}
            for r in g.records:
                if r.tags and r.tags.doctor:
                    counts[r.tags.doctor] = counts.get(r.tags.doctor, 0) + 1
            g.top_doctor = max(counts, key=counts.__getitem__) if counts else None
    return ordered
