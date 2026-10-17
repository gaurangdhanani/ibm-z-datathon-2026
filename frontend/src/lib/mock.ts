/**
 * Mock API for the Phase 2+ screens until their endpoints exist (DECISIONS.md, "Frontend skeleton").
 *
 * State lives in localStorage, so a patient tab and a hospital tab in the same browser see each
 * other's changes. The data mirrors medvault/seed.py (same people, hospitals, ids and records), so a
 * real login lands on matching mock data. `assess` stands in for the RUL-1 access rules and `tag`
 * for the ORG-2 keyword tagger. Delete this file once every endpoint in lib/types.ts is live.
 */
import { ApiError } from "./api";
import { STAFF_ROLE_LABEL } from "./auth";
import type { User } from "./auth";
import { emitChange } from "./bus";
import { formatMonth, formatTime, localDate } from "./format";
import type {
  AccessEntry,
  AccessOutcome,
  AlertDecision,
  AlertStatus,
  BlockedCode,
  GrantInfo,
  GrantStatus,
  GroupBy,
  Hospital,
  HospitalApi,
  HospitalPatient,
  HospitalRequest,
  PatientAlert,
  PatientApi,
  PatientRequest,
  Reason,
  RecordCategory,
  RecordContent,
  RecordGroup,
  RecordSummary,
  RecordTags,
  RequestStatus,
  RiskLevel,
} from "./types";

const STORAGE_KEY = "onetrace.mock.v2";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DAY = 86_400_000;

interface DbPatient {
  id: number;
  full_name: string;
  mrn: string;
  date_of_birth: string;
}
interface DbRecord extends RecordSummary {
  patient_id: number;
  body: string | null;
}
interface DbGrant {
  id: number;
  patient_id: number;
  hospital_id: number;
  status: GrantStatus;
  granted_at: string;
  frozen_at: string | null;
  ended_at: string | null;
}
interface DbEmergency {
  id: number;
  patient_id: number;
  hospital_id: number;
  staff_name: string;
  justification: string;
  created_at: string;
  expires_at: string;
  ended_at: string | null;
}
interface DbRequest {
  id: number;
  patient_id: number;
  hospital_id: number;
  requested_by: string;
  reason: string;
  status: RequestStatus;
  created_at: string;
  decided_at: string | null;
}
interface DbLog {
  id: number;
  ts: string;
  patient_id: number;
  actor_user_id: number | null;
  actor_name: string;
  actor_role: string;
  actor_hospital_id: number | null;
  is_patient: boolean;
  summary: string;
  outcome: AccessOutcome;
  deny_reason: string | null;
  risk_level: RiskLevel;
  reasons: Reason[];
}
interface DbAlert {
  id: number;
  patient_id: number;
  grant_id: number | null;
  created_at: string;
  risk_level: "medium" | "high";
  title: string;
  summary: string;
  reasons: Reason[];
  status: AlertStatus;
  decision: AlertDecision | null;
}
interface Db {
  hospitals: Hospital[];
  patients: DbPatient[];
  records: DbRecord[];
  grants: DbGrant[];
  emergencies: DbEmergency[];
  requests: DbRequest[];
  log: DbLog[];
  alerts: DbAlert[];
  keys: Record<string, { version: number; rotated_at: string | null }>;
  next_id: number;
}

// ------------------------------------------------------------------------------------------------
// Seed (mirrors medvault/seed.py)
// ------------------------------------------------------------------------------------------------

const HOSPITALS: Hospital[] = [
  { id: 1, code: "HOSP-A", name: "Northside General Hospital", city: "Dallas" },
  { id: 2, code: "HOSP-B", name: "Riverbend Medical Center", city: "Fort Worth" },
];
const DOCTOR_AT: Record<number, string> = { 1: "Dr. Elena Vasquez", 2: "Dr. Amir Haddad" };

type SeedTags = Pick<RecordTags, "body_part" | "condition" | "record_type" | "labels">;
// [id, patient, title, category, hospital, days ago, sensitivity, tags, body]
const SEED_RECORDS: Array<[number, number, string, RecordCategory, number, number, 1 | 3, SeedTags, string]> = [
  [1, 1, "Knee MRI report", "imaging", 1, 9, 1,
    { body_part: "Knee", condition: "Orthopedics", record_type: "Imaging", labels: ["Knee", "MRI"] },
    "MRI right knee without contrast. Findings: complex tear of the posterior horn of the medial meniscus. Moderate joint effusion. ACL and PCL intact. Impression: medial meniscus tear."],
  [2, 1, "Comprehensive metabolic panel", "lab", 1, 8, 1,
    { body_part: null, condition: "General health", record_type: "Lab result", labels: ["Blood test"] },
    "Sodium 139 mmol/L, potassium 4.1 mmol/L, glucose 92 mg/dL, creatinine 0.8 mg/dL, ALT 21 U/L, AST 19 U/L. All values within reference range."],
  [3, 1, "Psychiatry follow-up note", "note", 1, 30, 3,
    { body_part: null, condition: "Psychiatry", record_type: "Visit note", labels: ["Mental health"] },
    "Follow-up for generalised anxiety disorder. Reports improved sleep on sertraline 50 mg. PHQ-9 score 6. Plan: continue current dose, review in 12 weeks."],
  [4, 1, "Prescription: sertraline 50 mg", "prescription", 1, 30, 3,
    { body_part: null, condition: "Psychiatry", record_type: "Prescription", labels: ["Prescription"] },
    "Sertraline 50 mg tablet, one daily by mouth, 90-day supply, 1 refill."],
  [5, 1, "Discharge summary: knee arthroscopy", "discharge", 1, 2, 1,
    { body_part: "Knee", condition: "Orthopedics", record_type: "Discharge summary", labels: ["Knee", "Surgery"] },
    "Day-case arthroscopic partial medial meniscectomy, right knee. No complications. Discharged with crutches; physiotherapy referral; follow-up in 2 weeks."],
  [6, 2, "Echocardiogram report", "imaging", 1, 14, 1,
    { body_part: "Heart", condition: "Cardiology", record_type: "Imaging", labels: ["Heart", "Echo"] },
    "Transthoracic echo. LVEF 58%. Mild mitral regurgitation. No pericardial effusion."],
  [7, 2, "Lipid panel", "lab", 1, 14, 1,
    { body_part: null, condition: "Cardiology", record_type: "Lab result", labels: ["Blood test"] },
    "Total cholesterol 212 mg/dL, LDL 138 mg/dL, HDL 44 mg/dL, triglycerides 150 mg/dL."],
  [8, 3, "Allergy test results", "lab", 2, 20, 1,
    { body_part: "Skin", condition: "Allergy", record_type: "Lab result", labels: ["Allergy"] },
    "Skin prick testing positive for dust mite and cat dander. Negative for peanut and shellfish."],
  [9, 3, "Physical therapy plan", "note", 2, 5, 1,
    { body_part: "Shoulder", condition: "Orthopedics", record_type: "Visit note", labels: ["Shoulder", "Physical therapy"] },
    "Rotator cuff strain, left shoulder. 6-week programme: scapular stabilisation, band work."],
];

function seed(): Db {
  const now = Date.now();
  /** n days ago, optionally at a local clock time; never in the future. */
  const ago = (days: number, hour?: number, minute = 0) => {
    const t = new Date(now - days * DAY);
    if (hour !== undefined) t.setHours(hour, minute, 0, 0);
    return new Date(Math.min(t.getTime(), now - 60_000)).toISOString();
  };

  const records: DbRecord[] = SEED_RECORDS.map(
    ([id, patient_id, title, category, hospital, days, sensitivity, tags, body]) => ({
      id,
      patient_id,
      title,
      category,
      sensitivity,
      mime_type: "text/plain",
      size_bytes: body.length,
      created_at: ago(days),
      source_hospital: HOSPITALS[hospital - 1].name,
      body,
      tags: {
        ...tags,
        doctor: DOCTOR_AT[hospital],
        date_of_service: localDate(new Date(ago(days))),
        tagger: "keyword",
        confidence: 0.9,
      },
    }),
  );

  const lateNight = ago(1, 23, 48);
  const staff = (name: string, role: string, hospital: number, userId: number) => ({
    actor_user_id: userId,
    actor_name: name,
    actor_role: role,
    actor_hospital_id: hospital,
    is_patient: false,
  });
  const you = (userId: number) => ({
    actor_user_id: userId,
    actor_name: "You",
    actor_role: "Patient",
    actor_hospital_id: null,
    is_patient: true,
  });
  const allowed = { outcome: "allowed" as const, deny_reason: null, risk_level: "low" as const, reasons: [] };
  const offHours: Reason = { kind: "off_hours", text: `Outside normal hours (${formatTime(lateNight)})` };

  const log: DbLog[] = [
    { id: 101, ts: ago(40), patient_id: 1, ...you(1), summary: "Gave Northside General Hospital a key to your vault", ...allowed },
    { id: 102, ts: ago(2, 15, 5), patient_id: 1, ...staff("Dr. Elena Vasquez", "Physician", 1, 4), summary: "Added Discharge summary: knee arthroscopy", ...allowed },
    { id: 103, ts: ago(1, 16, 3), patient_id: 1, ...you(1), summary: "Viewed record list", ...allowed },
    { id: 104, ts: lateNight, patient_id: 1, ...staff("Sam Lee", "Nurse", 1, 5), summary: "Viewed record list", ...allowed, risk_level: "medium", reasons: [offHours] },
    { id: 105, ts: new Date(now - 3 * 3600_000).toISOString(), patient_id: 1, ...staff("Dr. Amir Haddad", "Physician", 2, 7), summary: "Requested access to your vault", ...allowed },
    { id: 106, ts: new Date(now - 2 * 3600_000).toISOString(), patient_id: 1, ...staff("Dr. Elena Vasquez", "Physician", 1, 4), summary: "Opened Knee MRI report", ...allowed },
    { id: 107, ts: ago(3, 11, 20), patient_id: 2, ...staff("Dr. Elena Vasquez", "Physician", 1, 4), summary: "Opened Echocardiogram report", ...allowed },
    { id: 108, ts: ago(5, 9, 40), patient_id: 3, ...staff("Dr. Amir Haddad", "Physician", 2, 7), summary: "Added Physical therapy plan", ...allowed },
  ];

  return {
    hospitals: HOSPITALS,
    patients: [
      { id: 1, full_name: "Maya Chen", mrn: "MRN-100-2231", date_of_birth: "1988-04-12" },
      { id: 2, full_name: "Daniel Okafor", mrn: "MRN-100-4410", date_of_birth: "1975-11-03" },
      { id: 3, full_name: "Priya Raman", mrn: "MRN-100-7782", date_of_birth: "1996-07-21" },
    ],
    records,
    grants: [
      { id: 1, patient_id: 1, hospital_id: 1, status: "active", granted_at: ago(40), frozen_at: null, ended_at: null },
      { id: 2, patient_id: 2, hospital_id: 1, status: "active", granted_at: ago(40), frozen_at: null, ended_at: null },
      { id: 3, patient_id: 3, hospital_id: 2, status: "active", granted_at: ago(40), frozen_at: null, ended_at: null },
    ],
    emergencies: [],
    requests: [
      {
        id: 1,
        patient_id: 1,
        hospital_id: 2,
        requested_by: "Dr. Amir Haddad",
        reason: "Orthopaedic referral: second opinion on knee MRI",
        status: "pending",
        created_at: new Date(now - 3 * 3600_000).toISOString(),
        decided_at: null,
      },
    ],
    log,
    alerts: [
      {
        id: 1,
        patient_id: 1,
        grant_id: 1,
        created_at: lateNight,
        risk_level: "medium",
        title: "Late-night access to your records",
        summary: `Sam Lee, a nurse at Northside General Hospital, opened your record list at ${formatTime(lateNight)}.`,
        reasons: [offHours],
        status: "open",
        decision: null,
      },
    ],
    keys: { "1": { version: 1, rotated_at: null }, "2": { version: 1, rotated_at: null }, "3": { version: 1, rotated_at: null } },
    next_id: 1000,
  };
}

// ------------------------------------------------------------------------------------------------
// Storage
// ------------------------------------------------------------------------------------------------

let memory: Db | null = null;
let storageOk = true;
const uploadedBlobs = new Map<number, Blob>(); // non-text uploads; gone after a refresh
let transferInFlight = false;

function load(): Db {
  if (storageOk) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return (memory = JSON.parse(raw) as Db);
    } catch {
      storageOk = false; // private mode or blocked storage: keep state in memory
    }
  }
  if (!memory) {
    memory = seed();
    save(memory);
  }
  return memory;
}

function save(db: Db): void {
  memory = db;
  if (!storageOk) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    storageOk = false;
  }
}

function mutate<T>(fn: (db: Db) => T): T {
  const db = load();
  const result = fn(db);
  save(db);
  return result;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) emitChange();
  });
}

export function resetMock(): void {
  uploadedBlobs.clear();
  save(seed());
  emitChange();
}

const delay = (ms = 220 + Math.random() * 220) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const nextId = (db: Db) => db.next_id++;

// ------------------------------------------------------------------------------------------------
// Actor (the real logged-in user; App renders <MockActorSync/>)
// ------------------------------------------------------------------------------------------------

let actor: User | null = null;
export function setMockActor(user: User | null): void {
  actor = user;
}

type StaffActor = User & { hospital_id: number };

function requirePatient(db: Db): DbPatient {
  if (!actor) throw new ApiError(401, "Not signed in");
  if (actor.role !== "patient" || actor.patient_id == null) throw new ApiError(403, "Patients only");
  const patient = db.patients.find((p) => p.id === actor!.patient_id);
  if (!patient) throw new ApiError(404, "No vault for this account");
  return patient;
}

function requireStaff(): StaffActor {
  if (!actor) throw new ApiError(401, "Not signed in");
  if (actor.role !== "staff" || actor.hospital_id == null) throw new ApiError(403, "Hospital staff only");
  return actor as StaffActor;
}

const roleLabel = (u: User) => (u.staff_role ? STAFF_ROLE_LABEL[u.staff_role] : "Staff");

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------

const hospitalById = (db: Db, id: number) => db.hospitals.find((h) => h.id === id)!;

function currentGrant(db: Db, patientId: number): DbGrant | undefined {
  return db.grants.find((g) => g.patient_id === patientId && (g.status === "active" || g.status === "frozen"));
}

function activeEmergency(db: Db, patientId: number, hospitalId?: number): DbEmergency | undefined {
  const now = nowIso();
  return db.emergencies.find(
    (e) =>
      e.patient_id === patientId &&
      e.ended_at === null &&
      e.expires_at > now &&
      (hospitalId === undefined || e.hospital_id === hospitalId),
  );
}

function grantView(db: Db, g: DbGrant): GrantInfo {
  return {
    id: g.id,
    hospital: hospitalById(db, g.hospital_id),
    status: g.status,
    granted_at: g.granted_at,
    frozen_at: g.frozen_at,
    ended_at: g.ended_at,
  };
}

function summary(r: DbRecord): RecordSummary {
  const { patient_id: _p, body: _b, ...rest } = r;
  return rest;
}

type LogInput = Omit<DbLog, "id" | "ts" | "outcome" | "deny_reason" | "risk_level" | "reasons"> &
  Partial<Pick<DbLog, "outcome" | "deny_reason" | "risk_level" | "reasons">>;

function addLog(db: Db, entry: LogInput): DbLog {
  const row: DbLog = {
    outcome: "allowed",
    deny_reason: null,
    risk_level: "low",
    reasons: [],
    ...entry,
    id: nextId(db),
    ts: nowIso(),
  };
  db.log.push(row);
  return row;
}

function youLog(patient: DbPatient, summaryText: string): LogInput {
  return {
    patient_id: patient.id,
    actor_user_id: actor?.id ?? null,
    actor_name: "You",
    actor_role: "Patient",
    actor_hospital_id: null,
    is_patient: true,
    summary: summaryText,
  };
}

function staffLog(staff: StaffActor, patientId: number, summaryText: string): LogInput {
  return {
    patient_id: patientId,
    actor_user_id: staff.id,
    actor_name: staff.full_name,
    actor_role: roleLabel(staff),
    actor_hospital_id: staff.hospital_id,
    is_patient: false,
    summary: summaryText,
  };
}

function patientRecords(db: Db, patientId: number): DbRecord[] {
  return db.records
    .filter((r) => r.patient_id === patientId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function contentOf(r: DbRecord): Blob | null {
  if (r.body !== null) return new Blob([r.body], { type: "text/plain" });
  return uploadedBlobs.get(r.id) ?? null;
}

// ------------------------------------------------------------------------------------------------
// Grouping (stand-in for GET .../groups?by=)
// ------------------------------------------------------------------------------------------------

export const OTHER_GROUP = "Other / Unknown";

function groupValue(r: RecordSummary, by: GroupBy): { key: string; label: string } | null {
  const t = r.tags!;
  const value =
    by === "doctor" ? t.doctor
    : by === "body_part" ? t.body_part
    : by === "condition" ? t.condition
    : by === "record_type" ? t.record_type
    : null;
  if (by === "date") {
    const iso = t.date_of_service ?? r.created_at;
    return { key: iso.slice(0, 7), label: formatMonth(iso) };
  }
  return value ? { key: value.toLowerCase(), label: value } : null;
}

export function groupRecords(records: RecordSummary[], by: GroupBy): RecordGroup[] {
  const organizing = records.filter((r) => r.tags === null);
  const groups = new Map<string, RecordGroup>();
  const other: RecordSummary[] = [];
  for (const r of records) {
    if (r.tags === null) continue;
    const g = groupValue(r, by);
    if (!g) {
      other.push(r);
      continue;
    }
    const group = groups.get(g.key) ?? { key: g.key, label: g.label, count: 0, top_doctor: null, records: [] };
    group.records.push(r);
    group.count += 1;
    groups.set(g.key, group);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    by === "date" ? b.key.localeCompare(a.key) : b.count - a.count || a.label.localeCompare(b.label),
  );
  if (other.length) sorted.push({ key: "other", label: OTHER_GROUP, count: other.length, top_doctor: null, records: other });
  if (organizing.length) {
    sorted.unshift({ key: "organizing", label: "Just added", count: organizing.length, top_doctor: null, records: organizing });
  }
  for (const g of sorted) {
    if (by === "doctor") continue;
    const counts = new Map<string, number>();
    g.records.forEach((r) => r.tags?.doctor && counts.set(r.tags.doctor, (counts.get(r.tags.doctor) ?? 0) + 1));
    g.top_doctor = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  return sorted;
}

// ------------------------------------------------------------------------------------------------
// Keyword tagger (stand-in for ORG-2)
// ------------------------------------------------------------------------------------------------

const VOCAB: Array<{ re: RegExp; label: string; body_part?: string; condition?: string; record_type?: string; sensitive?: boolean }> = [
  { re: /\b(knee|acl|menisc\w*|patella)\b/i, label: "Knee", body_part: "Knee", condition: "Orthopedics" },
  { re: /\b(shoulder|rotator cuff)\b/i, label: "Shoulder", body_part: "Shoulder", condition: "Orthopedics" },
  { re: /\b(heart|cardi\w*|echo\w*|ecg|ekg)\b/i, label: "Heart", body_part: "Heart", condition: "Cardiology" },
  { re: /\b(lungs?|asthma|chest x-?ray)\b/i, label: "Lungs", body_part: "Lungs", condition: "Pulmonology" },
  { re: /\b(skin|rash|derma\w*)\b/i, label: "Skin", body_part: "Skin", condition: "Dermatology" },
  { re: /\b(psychiatr\w*|anxiety|depress\w*|therapy session|sertraline)\b/i, label: "Mental health", condition: "Psychiatry", sensitive: true },
  { re: /\b(hiv|sti|std)\b/i, label: "Sexual health", condition: "Sexual health", sensitive: true },
  { re: /\b(brca|genetic\w*)\b/i, label: "Genetic", condition: "Genetics", sensitive: true },
  { re: /\b(hba1c|diabet\w*)\b/i, label: "Diabetes", condition: "Endocrinology" },
  { re: /\bmri\b/i, label: "MRI", record_type: "Imaging" },
  { re: /\b(x-?ray|ct scan|ultrasound|imaging)\b/i, label: "Imaging", record_type: "Imaging" },
  { re: /\b(blood|panel|lab|cbc)\b/i, label: "Blood test", record_type: "Lab result" },
  { re: /\b(vaccin\w*|tetanus|immuni[sz]ation)\b/i, label: "Vaccination", record_type: "Vaccination" },
  { re: /\b(prescription|rx)\b/i, label: "Prescription", record_type: "Prescription" },
  { re: /\bdischarge\b/i, label: "Discharge", record_type: "Discharge summary" },
];

const CATEGORY_OF: Record<string, RecordCategory> = {
  Imaging: "imaging",
  "Lab result": "lab",
  Prescription: "prescription",
  "Discharge summary": "discharge",
  "Visit note": "note",
};

function tag(text: string, mime: string): { tags: RecordTags; sensitivity: 1 | 3; category: RecordCategory } {
  const hits = VOCAB.filter((v) => v.re.test(text));
  const pick = (field: "body_part" | "condition" | "record_type") => hits.find((h) => h[field])?.[field] ?? null;
  const doctor = text.match(/\bDr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const fallbackType = mime.startsWith("image/") ? "Photo" : mime === "application/pdf" ? "Document" : "Visit note";
  const record_type = pick("record_type") ?? fallbackType;
  let confidence = Math.min(1, (hits.length + (doctor ? 1 : 0)) / 4);
  if (mime.startsWith("image/")) confidence = Math.min(confidence, 0.3); // no OCR: title only
  return {
    sensitivity: hits.some((h) => h.sensitive) ? 3 : 1, // ties go to the higher sensitivity
    category: CATEGORY_OF[record_type] ?? "other",
    tags: {
      body_part: pick("body_part"),
      condition: pick("condition"),
      doctor: doctor ? `Dr. ${doctor[1]}` : null,
      record_type,
      date_of_service: date?.[1] ?? null,
      labels: [...new Set(hits.map((h) => h.label))].slice(0, 3),
      tagger: "keyword",
      confidence,
    },
  };
}

/** Server-side magic-byte check (VLT-4), mirrored so the error path can be tried in the UI. */
async function sniff(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const starts = (bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    return text.includes("\u0000") ? null : "text/plain";
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------
// Access rules (stand-in for RUL-1)
// ------------------------------------------------------------------------------------------------

function assess(staff: StaffActor, record: DbRecord | null, viaEmergency: boolean) {
  const reasons: Reason[] = [];
  const hour = new Date().getHours();
  const offHours = hour < 6 || hour >= 22;
  const clerical = staff.staff_role === "billing_clerk" || staff.staff_role === "records_clerk";
  if (offHours) reasons.push({ kind: "off_hours", text: `Outside normal hours (${formatTime(nowIso())})` });
  if (record && record.sensitivity === 3 && clerical) {
    reasons.unshift(
      { kind: "role_mismatch", text: `Unrelated to the ${roleLabel(staff).toLowerCase()} role` },
      { kind: "sensitive_record", text: `Sensitive record (${record.tags?.condition ?? "restricted"})` },
    );
    return { risk: "high" as const, reasons, freeze: true };
  }
  if (viaEmergency) reasons.push({ kind: "emergency", text: "Emergency (break-glass) access" });
  return { risk: reasons.length ? ("medium" as const) : ("low" as const), reasons, freeze: false };
}

type Access = { grant: DbGrant | undefined; emergency: DbEmergency | undefined };

/** Grant check for a hospital read. Denials are logged before the error is thrown. */
function checkAccess(db: Db, staff: StaffActor, patientId: number, what: string): Access {
  const grant = db.grants
    .filter((g) => g.patient_id === patientId && g.hospital_id === staff.hospital_id)
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at))[0];
  const emergency = activeEmergency(db, patientId, staff.hospital_id);
  if (grant?.status === "active" || emergency) return { grant, emergency };

  let code: BlockedCode = "no_grant";
  let message = "You don't hold a key for this patient.";
  let reason: Reason = { kind: "no_grant", text: "This hospital holds no key to the vault" };
  if (grant?.status === "frozen") {
    code = "access_frozen";
    message = "Access frozen by the patient's security system after unusual activity.";
    reason = { kind: "frozen", text: "Access was frozen" };
  } else if (grant) {
    code = "access_revoked";
    message = "This patient moved their records to another hospital. Your key no longer works.";
    reason = { kind: "revoked", text: "Access had been revoked" };
  }
  addLog(db, {
    ...staffLog(staff, patientId, what),
    outcome: "denied",
    deny_reason: code === "access_frozen" ? "access frozen" : code === "access_revoked" ? "access revoked" : "no access",
    risk_level: "high",
    reasons: [reason],
  });
  save(db);
  throw new ApiError(403, message, code);
}

function raiseAlert(db: Db, patientId: number, grantId: number | null, risk: "medium" | "high", title: string, text: string, reasons: Reason[]) {
  db.alerts.push({
    id: nextId(db),
    patient_id: patientId,
    grant_id: grantId,
    created_at: nowIso(),
    risk_level: risk,
    title,
    summary: text,
    reasons,
    status: "open",
    decision: null,
  });
}

// ------------------------------------------------------------------------------------------------
// Patient API
// ------------------------------------------------------------------------------------------------

function grantInTx(db: Db, patient: DbPatient, hospitalId: number): DbGrant {
  if (currentGrant(db, patient.id)) {
    throw new ApiError(409, "A hospital already holds your key. Move hospitals instead.", "already_granted");
  }
  const grant: DbGrant = {
    id: nextId(db),
    patient_id: patient.id,
    hospital_id: hospitalId,
    status: "active",
    granted_at: nowIso(),
    frozen_at: null,
    ended_at: null,
  };
  db.grants.push(grant);
  addLog(db, youLog(patient, `Gave ${hospitalById(db, hospitalId).name} a key to your vault`));
  return grant;
}

async function transferVault(toHospitalId: number): Promise<GrantInfo> {
  if (transferInFlight) throw new ApiError(409, "A move is already in progress.", "transfer_in_progress");
  transferInFlight = true;
  try {
    await delay(900); // re-encrypting every record under the new key
    return mutate((db) => {
      const patient = requirePatient(db);
      const old = currentGrant(db, patient.id);
      if (!old) throw new ApiError(409, "No hospital holds your key yet.", "no_grant");
      if (old.hospital_id === toHospitalId) throw new ApiError(409, "That hospital already holds your key.");
      const at = nowIso();
      old.status = "transferred";
      old.ended_at = at;
      db.emergencies
        .filter((e) => e.patient_id === patient.id && e.hospital_id === old.hospital_id && e.ended_at === null)
        .forEach((e) => (e.ended_at = at));
      const key = db.keys[String(patient.id)];
      key.version += 1;
      key.rotated_at = at;
      const grant: DbGrant = {
        id: nextId(db),
        patient_id: patient.id,
        hospital_id: toHospitalId,
        status: "active",
        granted_at: at,
        frozen_at: null,
        ended_at: null,
      };
      db.grants.push(grant);
      db.requests
        .filter((r) => r.patient_id === patient.id && r.hospital_id === toHospitalId && r.status === "pending")
        .forEach((r) => Object.assign(r, { status: "approved", decided_at: at }));
      db.alerts
        .filter((a) => a.patient_id === patient.id && a.grant_id === old.id && a.status !== "resolved")
        .forEach((a) => (a.status = "resolved"));
      const from = hospitalById(db, old.hospital_id).name;
      const to = hospitalById(db, toHospitalId).name;
      addLog(db, youLog(patient, `Moved your vault to ${to}. ${from}'s key was destroyed; records re-locked with key v${key.version}`));
      return grantView(db, grant);
    });
  } finally {
    transferInFlight = false;
  }
}

function requestView(db: Db, r: DbRequest): PatientRequest {
  return {
    id: r.id,
    hospital: hospitalById(db, r.hospital_id),
    requested_by: r.requested_by,
    reason: r.reason,
    status: r.status,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

function alertView(a: DbAlert): PatientAlert {
  const { patient_id: _p, grant_id: _g, ...rest } = a;
  return rest;
}

export const mockPatientApi: PatientApi = {
  async getVault() {
    await delay();
    const db = load();
    const patient = requirePatient(db);
    const grant = currentGrant(db, patient.id);
    const emergency = activeEmergency(db, patient.id);
    const key = db.keys[String(patient.id)];
    return {
      patient,
      key_version: key.version,
      rotated_at: key.rotated_at,
      current_grant: grant ? grantView(db, grant) : null,
      past_grants: db.grants
        .filter((g) => g.patient_id === patient.id && (g.status === "transferred" || g.status === "revoked"))
        .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))
        .map((g) => grantView(db, g)),
      emergency: emergency
        ? {
            id: emergency.id,
            hospital: hospitalById(db, emergency.hospital_id),
            staff_name: emergency.staff_name,
            justification: emergency.justification,
            created_at: emergency.created_at,
            expires_at: emergency.expires_at,
          }
        : null,
      records: patientRecords(db, patient.id).map(summary),
    };
  },

  async getGroups(by) {
    await delay();
    const db = load();
    return groupRecords(patientRecords(db, requirePatient(db).id).map(summary), by);
  },

  async readRecord(id) {
    await delay();
    return mutate((db): RecordContent => {
      const patient = requirePatient(db);
      const record = db.records.find((r) => r.id === id && r.patient_id === patient.id);
      if (!record) throw new ApiError(404, "Record not found");
      addLog(db, youLog(patient, `Opened ${record.title}`));
      return { record: summary(record), blob: contentOf(record) };
    });
  },

  async uploadRecord(file, title) {
    await delay(600);
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "That file is larger than 10 MB.", "file_too_large");
    const mime = await sniff(file);
    if (!mime) throw new ApiError(415, "Only PDF, JPG, PNG or TXT files can be uploaded.", "invalid_file_type");
    const text = mime === "text/plain" ? await file.text() : null;
    const record = mutate((db) => {
      const patient = requirePatient(db);
      const row: DbRecord = {
        id: nextId(db),
        patient_id: patient.id,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        category: "other",
        sensitivity: 1,
        mime_type: mime,
        size_bytes: file.size,
        created_at: nowIso(),
        source_hospital: null,
        tags: null,
        body: text !== null && text.length <= 200_000 ? text : null,
      };
      db.records.push(row);
      addLog(db, youLog(patient, `Added ${row.title}`));
      return row;
    });
    if (record.body === null) uploadedBlobs.set(record.id, file);

    // The organizer runs inside the vault after upload; tags arrive a moment later.
    setTimeout(() => {
      mutate((db) => {
        const row = db.records.find((r) => r.id === record.id);
        if (!row) return;
        const result = tag(`${row.title}\n${file.name}\n${text ?? ""}`, row.mime_type);
        Object.assign(row, result);
      });
      emitChange();
    }, 1300);
    return summary(record);
  },

  async listHospitals() {
    await delay(150);
    return load().hospitals;
  },

  async grant(hospitalId) {
    await delay();
    return mutate((db) => grantView(db, grantInTx(db, requirePatient(db), hospitalId)));
  },

  transfer: transferVault,

  async getRequests() {
    await delay();
    const db = load();
    const patient = requirePatient(db);
    return db.requests
      .filter((r) => r.patient_id === patient.id)
      .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.created_at.localeCompare(a.created_at))
      .map((r) => requestView(db, r));
  },

  async decideRequest(id, decision) {
    await delay();
    const db = load();
    const patient = requirePatient(db);
    const request = db.requests.find((r) => r.id === id && r.patient_id === patient.id);
    if (!request) throw new ApiError(404, "Request not found");
    if (request.status !== "pending") throw new ApiError(409, "This request was already decided.");
    const hospital = hospitalById(db, request.hospital_id).name;

    if (decision === "deny") {
      return mutate((tx) => {
        const r = tx.requests.find((x) => x.id === id)!;
        Object.assign(r, { status: "denied", decided_at: nowIso() });
        addLog(tx, youLog(patient, `Denied ${hospital}'s request for access`));
        return requestView(tx, r);
      });
    }
    const holder = currentGrant(db, patient.id);
    if (holder && holder.hospital_id !== request.hospital_id) {
      await transferVault(request.hospital_id); // marks the request approved
    } else {
      mutate((tx) => {
        if (!holder) grantInTx(tx, patient, request.hospital_id);
        Object.assign(tx.requests.find((x) => x.id === id)!, { status: "approved", decided_at: nowIso() });
      });
    }
    const after = load();
    return requestView(after, after.requests.find((r) => r.id === id)!);
  },

  async getAccessLog(filter) {
    await delay();
    const db = load();
    const patient = requirePatient(db);
    return db.log
      .filter((e) => e.patient_id === patient.id)
      .filter((e) =>
        filter === "denied" ? e.outcome !== "allowed"
        : filter === "flagged" ? e.risk_level === "medium" || e.risk_level === "high"
        : true,
      )
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .map(
        (e): AccessEntry => ({
          id: e.id,
          ts: e.ts,
          actor: {
            name: e.actor_name,
            role_label: e.actor_role,
            hospital: e.actor_hospital_id ? hospitalById(db, e.actor_hospital_id).name : null,
            is_you: e.is_patient,
          },
          summary: e.summary,
          outcome: e.outcome,
          deny_reason: e.deny_reason,
          risk_level: e.risk_level,
          reasons: e.reasons,
        }),
      );
  },

  async verifyHistory() {
    await delay(150);
    return { valid: true, entries: load().log.length, first_broken_entry: null };
  },

  async getAlerts() {
    await delay();
    const db = load();
    const patient = requirePatient(db);
    return db.alerts
      .filter((a) => a.patient_id === patient.id)
      .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.created_at.localeCompare(a.created_at))
      .map(alertView);
  },

  async decideAlert(id, decision) {
    await delay();
    return mutate((db) => {
      const patient = requirePatient(db);
      const alert = db.alerts.find((a) => a.id === id && a.patient_id === patient.id);
      if (!alert) throw new ApiError(404, "Alert not found");
      if (alert.status === "resolved") throw new ApiError(409, "This alert is already closed.");
      const grant = db.grants.find((g) => g.id === alert.grant_id);
      const hospital = grant ? hospitalById(db, grant.hospital_id).name : "the hospital";
      const live = grant && (grant.status === "active" || grant.status === "frozen");
      if (decision === "restore" && live) Object.assign(grant, { status: "active", frozen_at: null });
      if (decision === "freeze" && live) Object.assign(grant, { status: "frozen", frozen_at: nowIso() });
      alert.status = decision === "keep_frozen" || decision === "freeze" ? "acknowledged" : "resolved";
      alert.decision = decision;
      const text = {
        restore: `Restored ${hospital}'s access`,
        keep_frozen: `Kept ${hospital}'s access frozen`,
        looks_fine: "Marked an alert as fine",
        freeze: `Froze ${hospital}'s access`,
      }[decision];
      addLog(db, youLog(patient, text));
      return alertView(alert);
    });
  },

  async endEmergency(id) {
    await delay();
    mutate((db) => {
      const patient = requirePatient(db);
      const emergency = db.emergencies.find((e) => e.id === id && e.patient_id === patient.id);
      if (!emergency) throw new ApiError(404, "Emergency access not found");
      emergency.ended_at = nowIso();
      addLog(db, youLog(patient, `Ended emergency access for ${hospitalById(db, emergency.hospital_id).name}`));
    });
  },
};

// ------------------------------------------------------------------------------------------------
// Hospital API
// ------------------------------------------------------------------------------------------------

function hospitalPatient(db: Db, hospitalId: number, p: DbPatient): HospitalPatient | null {
  const grant = currentGrant(db, p.id);
  const ours = grant?.hospital_id === hospitalId ? grant : undefined;
  const emergency = activeEmergency(db, p.id, hospitalId);
  if (!ours && !emergency) return null;
  const visits = db.log
    .filter((e) => e.patient_id === p.id && e.actor_hospital_id === hospitalId && e.outcome === "allowed")
    .map((e) => e.ts)
    .sort();
  return {
    patient_id: p.id,
    full_name: p.full_name,
    mrn: p.mrn,
    date_of_birth: p.date_of_birth,
    key_status: ours?.status === "frozen" ? "frozen" : ours ? "active" : "emergency",
    last_visit: visits[visits.length - 1] ?? ours?.granted_at ?? null,
  };
}

function hospitalRequestView(db: Db, r: DbRequest): HospitalRequest {
  const p = db.patients.find((x) => x.id === r.patient_id)!;
  return {
    id: r.id,
    patient: { patient_id: p.id, full_name: p.full_name, mrn: p.mrn },
    requested_by: r.requested_by,
    reason: r.reason,
    status: r.status,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

export const mockHospitalApi: HospitalApi = {
  async getPatients(query) {
    await delay();
    const staff = requireStaff();
    const db = load();
    const q = query.trim().toLowerCase();
    return db.patients
      .map((p) => hospitalPatient(db, staff.hospital_id, p))
      .filter((p): p is HospitalPatient => p !== null)
      .filter((p) => !q || p.full_name.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q));
  },

  async getPatientGroups(patientId, by) {
    await delay();
    const staff = requireStaff();
    return mutate((db) => {
      const patient = db.patients.find((p) => p.id === patientId);
      if (!patient) throw new ApiError(404, "Patient not found");
      const { grant, emergency } = checkAccess(db, staff, patientId, "Tried to view record list");
      // One "Viewed record list" entry per 10 minutes, so switching chips doesn't flood the history.
      const recent = db.log.some(
        (e) =>
          e.patient_id === patientId &&
          e.actor_user_id === staff.id &&
          e.summary === "Viewed record list" &&
          Date.now() - Date.parse(e.ts) < 10 * 60_000,
      );
      if (!recent) {
        const { risk, reasons } = assess(staff, null, !!emergency && grant?.status !== "active");
        addLog(db, { ...staffLog(staff, patientId, "Viewed record list"), risk_level: risk, reasons });
        if (risk === "medium") {
          const who = `${staff.full_name}, ${roleLabel(staff).toLowerCase()} at ${staff.hospital_name}`;
          raiseAlert(db, patientId, grant?.id ?? null, "medium", "Unusual access to your records", `${who}, opened your record list at ${formatTime(nowIso())}.`, reasons);
        }
      }
      return {
        patient: hospitalPatient(db, staff.hospital_id, patient)!,
        groups: groupRecords(patientRecords(db, patientId).map(summary), by),
      };
    });
  },

  async readRecord(recordId) {
    await delay();
    const staff = requireStaff();
    return mutate((db): RecordContent => {
      const record = db.records.find((r) => r.id === recordId);
      if (!record) throw new ApiError(404, "Record not found");
      const what = `Tried to open ${record.title}`;
      const { grant, emergency } = checkAccess(db, staff, record.patient_id, what);
      const { risk, reasons, freeze } = assess(staff, record, !!emergency && grant?.status !== "active");
      const who = `${staff.full_name}, ${roleLabel(staff).toLowerCase()} at ${staff.hospital_name}`;
      const time = formatTime(nowIso());

      if (freeze && grant) {
        // HIGH: freeze in the same request, so this read and every later one are blocked.
        Object.assign(grant, { status: "frozen", frozen_at: nowIso() });
        addLog(db, { ...staffLog(staff, record.patient_id, what), outcome: "frozen", deny_reason: "blocked by your access rules", risk_level: "high", reasons });
        raiseAlert(db, record.patient_id, grant.id, "high", "Unusual access frozen", `${who}, tried to open your ${record.title.toLowerCase()} at ${time}.`, reasons);
        save(db);
        throw new ApiError(403, "Access frozen by the patient's security system after unusual activity.", "access_frozen");
      }
      addLog(db, { ...staffLog(staff, record.patient_id, `Opened ${record.title}`), risk_level: risk, reasons });
      if (risk === "medium") {
        raiseAlert(db, record.patient_id, grant?.id ?? null, "medium", "Unusual access to your records", `${who}, opened your ${record.title.toLowerCase()} at ${time}.`, reasons);
      }
      return { record: summary(record), blob: contentOf(record) };
    });
  },

  async lookupPatient(query) {
    await delay(200);
    requireStaff();
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return load()
      .patients.filter((p) => p.full_name.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({ patient_id: p.id, full_name: p.full_name, mrn: p.mrn }));
  },

  async requestAccess(patientId, reason) {
    await delay();
    const staff = requireStaff();
    return mutate((db) => {
      if (reason.trim().length < 10) throw new ApiError(422, "Give a reason of at least 10 characters.");
      const patient = db.patients.find((p) => p.id === patientId);
      if (!patient) throw new ApiError(404, "Patient not found");
      if (currentGrant(db, patientId)?.hospital_id === staff.hospital_id) {
        throw new ApiError(409, "Your hospital already holds this patient's key.", "already_granted");
      }
      if (db.requests.some((r) => r.patient_id === patientId && r.hospital_id === staff.hospital_id && r.status === "pending")) {
        throw new ApiError(409, "A request to this patient is already pending.", "duplicate_request");
      }
      const request: DbRequest = {
        id: nextId(db),
        patient_id: patientId,
        hospital_id: staff.hospital_id,
        requested_by: staff.full_name,
        reason: reason.trim(),
        status: "pending",
        created_at: nowIso(),
        decided_at: null,
      };
      db.requests.push(request);
      addLog(db, staffLog(staff, patientId, "Requested access to your vault"));
      return hospitalRequestView(db, request);
    });
  },

  async getRequests() {
    await delay();
    const staff = requireStaff();
    const db = load();
    return db.requests
      .filter((r) => r.hospital_id === staff.hospital_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => hospitalRequestView(db, r));
  },
};
