"""ORG-2 / ORG-4: the in-vault record organizer. The only AI component (see DECISIONS.md).

``extract_text`` pulls text out of a TXT or PDF upload (no OCR for images: the title is all
we have). ``tag_text`` scores the vocabulary in ``vocab.py`` and returns body part, condition,
record type, doctor, date of service, labels and a confidence. Tags are stored encrypted under
the record's DEK (``Record.encrypted_tags``, ORG-3) and only decrypted inside the broker.
``group_records`` is the group-by API's shape for patients and hospitals (ORG-4).
"""

from __future__ import annotations

import re
import zlib
from datetime import datetime

from medvault.models import RecordCategory
from medvault.schemas import GroupBy, RecordGroup, RecordSummary
from medvault.vocab import BODY_PARTS, CONDITIONS, RECORD_TYPES

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

_DOCTOR = re.compile(r"\bDr\.?\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)")
_DOCTOR_LOOSE = re.compile(r"\bdr\.?\s+([^\W\d_][\w'-]*(?:\s+[^\W\d_][\w'-]*)?)", re.I)
_ISO_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_US_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
_PDF_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)
_PDF_TEXT = re.compile(rb"\((.*?)(?<!\\)\)")


def _compile(keywords: list[str]) -> re.Pattern:
    """Word-start match so stems ("menisc", "depress") hit their inflections; short keywords
    ("sti", "ct") must also end the word, or "stiffness" would read as a sexually transmitted
    infection."""
    parts = [re.escape(k) + (r"(?!\w)" if len(k) <= 4 else "") for k in keywords]
    return re.compile(r"(?<!\w)(?:" + "|".join(parts) + r")", re.I)


_BODY = [(label, specialty, _compile(words)) for label, (specialty, words) in BODY_PARTS.items()]
_COND = [(label, level, _compile(words)) for label, (level, words) in CONDITIONS.items()]
_TYPE = [(label, _compile(words)) for label, words in RECORD_TYPES.items()]


# ---- text extraction -------------------------------------------------------------------------


def pdf_text(data: bytes) -> str:
    """Text operands of simple PDFs (uncompressed or Flate streams). Enough for typed reports."""
    out: list[str] = []
    for m in _PDF_STREAM.finditer(data):
        raw = m.group(1)
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            pass
        out.extend(s.decode("latin-1") for s in _PDF_TEXT.findall(raw))
    return " ".join(out)


def extract_text(data: bytes, mime: str) -> str:
    if mime == "text/plain":
        return data.decode("utf-8", "replace")[:200_000]
    if mime == "application/pdf":
        return pdf_text(data)[:200_000]
    return ""  # images: no OCR in this build; the title still gets tagged


# ---- tagger ----------------------------------------------------------------------------------


def _score(pattern: re.Pattern, text: str) -> int:
    """Hits in the whole text, plus hits in the first line (the title) counted again."""
    head = text.split("\n", 1)[0] if "\n" in text else ""
    return len(pattern.findall(text)) + len(pattern.findall(head))


def _doctor(text: str) -> str | None:
    """'Dr. Lina Park' from the text; a lower-cased note still yields a title-cased name."""
    strict = _DOCTOR.search(text)
    if strict:
        return f"Dr. {strict.group(1)}"
    loose = _DOCTOR_LOOSE.search(text)
    return f"Dr. {loose.group(1).title()}" if loose else None


def tag_text(
    text: str, mime: str, *, doctor: str | None = None, date_of_service: str | None = None
) -> dict:
    """Returns ``{"tags": RecordTags-shaped dict, "sensitivity": 1 | 2 | 3, "category"}``.

    Scores every vocabulary entry by how often it appears; the best body part wins, the
    condition is the best of its specialty and the stand-alone conditions, and sensitivity is
    the highest level of any stand-alone condition that appears at all (ties go to safety).
    ``doctor`` / ``date_of_service`` override what the text says (the uploader, the upload date).
    """
    body = sorted(((_score(p, text), label, spec) for label, spec, p in _BODY), reverse=True)
    cond = sorted(((_score(p, text), label, level) for label, level, p in _COND), reverse=True)
    kind = sorted(
        ((_score(p, text), label != "Visit note", label) for label, p in _TYPE), reverse=True
    )

    body_score, body_part, specialty = body[0] if body and body[0][0] else (0, None, None)
    cond_score, condition_label, _level = cond[0] if cond and cond[0][0] else (0, None, 1)
    if body_part and body_score < 2 and cond_score > body_score:
        body_part, specialty = None, None  # a passing mention ("also reports knee pain")
    condition = condition_label if cond_score > body_score else (specialty or condition_label)
    sensitivity = max((level for score, _label, level in cond if score), default=1)

    if mime.startswith("image/"):
        fallback = "Photo"
    elif mime == "application/pdf":
        fallback = "Document"
    else:
        fallback = "Visit note"
    record_type = kind[0][2] if kind and kind[0][0] else fallback

    doc = _doctor(text)
    day = _ISO_DATE.search(text)
    if day:
        found_date = day.group(1)
    elif us := _US_DATE.search(text):
        found_date = f"{us.group(3)}-{int(us.group(1)):02d}-{int(us.group(2)):02d}"
    else:
        found_date = None

    labels = [label for score, label, *_ in sorted(body + cond, reverse=True) if score][:2]
    if kind and kind[0][0] and kind[0][2] not in labels:
        labels.append(kind[0][2])
    total = body_score + cond_score + (kind[0][0] if kind else 0) + (1 if doc else 0)
    confidence = min(1.0, total / 5)
    if mime.startswith("image/"):
        confidence = min(confidence, 0.3)  # no OCR: the title is all we have
    return {
        "tags": {
            "body_part": body_part,
            "condition": condition,
            "doctor": doctor or doc,
            "record_type": record_type,
            "date_of_service": date_of_service or found_date,
            "labels": labels[:3],
            "tagger": "keyword",
            "confidence": round(confidence, 2),
        },
        "sensitivity": sensitivity,
        "category": CATEGORY_OF.get(record_type, RecordCategory.OTHER),
    }


# ---- group-by (ORG-4) ------------------------------------------------------------------------


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
    """Groups for the vault and hospital views: biggest first, 'Other / Unknown' last."""
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
