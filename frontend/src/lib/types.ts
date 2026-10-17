/**
 * API contract: the shapes the FastAPI endpoints return (see medvault/schemas.py). Enum strings
 * match medvault/models.py.
 */

export type GrantStatus = "active" | "frozen" | "revoked" | "transferred";
export type RequestStatus = "pending" | "approved" | "denied" | "cancelled";
export type AccessOutcome = "allowed" | "denied" | "frozen";
export type RiskLevel = "none" | "low" | "medium" | "high";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type RecordCategory = "imaging" | "lab" | "note" | "prescription" | "discharge" | "other";

export type GroupBy = "doctor" | "body_part" | "condition" | "record_type" | "date";
export type LogFilter = "all" | "denied" | "flagged";
export type AlertDecision = "restore" | "keep_frozen" | "looks_fine" | "freeze";
export type RequestDecision = "approve" | "deny";

/** Codes the broker returns on a denied read; the hospital UI picks H4 / H5 from them. */
export type BlockedCode = "access_frozen" | "access_revoked" | "no_grant";

export interface Hospital {
  id: number;
  code: string;
  name: string;
  city: string;
}

/** Organizer tags. `null` on a record means "still organizing inside the vault". */
export interface RecordTags {
  body_part: string | null;
  condition: string | null;
  doctor: string | null;
  record_type: string;
  date_of_service: string | null;
  labels: string[];
  tagger: "keyword" | "granite" | "patient_edit";
  confidence: number; // 0..1; below 0.5 the UI asks the patient to add details
}

export interface RecordSummary {
  id: number;
  title: string;
  category: RecordCategory;
  sensitivity: 1 | 2 | 3;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  source_hospital: string | null;
  tags: RecordTags | null;
}

export interface RecordContent {
  record: RecordSummary;
  /** Decrypted body from the broker; null when the bytes are not available. */
  blob: Blob | null;
}

export interface RecordGroup {
  key: string;
  label: string;
  count: number;
  top_doctor: string | null;
  records: RecordSummary[];
}

export interface GrantInfo {
  id: number;
  hospital: Hospital;
  status: GrantStatus;
  granted_at: string;
  frozen_at: string | null;
  ended_at: string | null;
}

export interface EmergencyInfo {
  id: number;
  hospital: Hospital;
  staff_name: string;
  justification: string;
  created_at: string;
  expires_at: string;
}

export interface VaultSummary {
  patient: { id: number; full_name: string; mrn: string; date_of_birth: string };
  key_version: number;
  rotated_at: string | null;
  current_grant: GrantInfo | null;
  past_grants: GrantInfo[];
  emergency: EmergencyInfo | null;
  records: RecordSummary[];
}

export interface PatientRequest {
  id: number;
  hospital: Hospital;
  requested_by: string;
  reason: string;
  status: RequestStatus;
  created_at: string;
  decided_at: string | null;
}

export type ReasonKind =
  | "off_hours"
  | "role_mismatch"
  | "sensitive_record"
  | "revoked"
  | "frozen"
  | "no_grant"
  | "emergency"
  | "other";

export interface Reason {
  kind: ReasonKind;
  text: string;
}

export interface AccessEntry {
  id: number;
  ts: string;
  actor: { name: string; role_label: string; hospital: string | null; is_you: boolean };
  /** Plain-language action, e.g. "Opened Knee MRI report" or "Viewed record list". */
  summary: string;
  outcome: AccessOutcome;
  deny_reason: string | null;
  risk_level: RiskLevel;
  reasons: Reason[];
}

export interface AuditVerify {
  valid: boolean;
  entries: number;
  first_broken_entry: number | null;
}

export interface PatientAlert {
  id: number;
  created_at: string;
  risk_level: "medium" | "high";
  title: string;
  summary: string;
  reasons: Reason[];
  status: AlertStatus;
  decision: AlertDecision | null;
}

export interface HospitalPatient {
  patient_id: number;
  full_name: string;
  mrn: string;
  date_of_birth: string;
  key_status: "active" | "frozen" | "emergency";
  last_visit: string | null;
}

export interface HospitalPatientView {
  patient: HospitalPatient;
  groups: RecordGroup[];
}

export interface HospitalRequest {
  id: number;
  patient: { patient_id: number; full_name: string; mrn: string };
  requested_by: string;
  reason: string;
  status: RequestStatus;
  created_at: string;
  decided_at: string | null;
}

export interface LookupResult {
  patient_id: number;
  full_name: string;
  mrn: string;
}

export interface PatientApi {
  getVault(): Promise<VaultSummary>;
  getGroups(by: GroupBy): Promise<RecordGroup[]>;
  readRecord(id: number): Promise<RecordContent>;
  uploadRecord(file: File, title: string): Promise<RecordSummary>;
  listHospitals(): Promise<Hospital[]>;
  grant(hospitalId: number): Promise<GrantInfo>;
  transfer(toHospitalId: number): Promise<GrantInfo>;
  getRequests(): Promise<PatientRequest[]>;
  decideRequest(id: number, decision: RequestDecision): Promise<PatientRequest>;
  getAccessLog(filter: LogFilter): Promise<AccessEntry[]>;
  verifyHistory(): Promise<AuditVerify>;
  getAlerts(): Promise<PatientAlert[]>;
  decideAlert(id: number, decision: AlertDecision): Promise<PatientAlert>;
  endEmergency(id: number): Promise<void>;
}

export interface HospitalApi {
  getPatients(query: string): Promise<HospitalPatient[]>;
  getPatientGroups(patientId: number, by: GroupBy): Promise<HospitalPatientView>;
  readRecord(recordId: number): Promise<RecordContent>;
  lookupPatient(query: string): Promise<LookupResult[]>;
  requestAccess(patientId: number, reason: string): Promise<HospitalRequest>;
  getRequests(): Promise<HospitalRequest[]>;
  /** H7 break-glass: physicians and nurses only; time-boxed, logged, the patient is told. */
  breakGlass(patientId: number, justification: string): Promise<EmergencyInfo>;
}

/** S5 attacker panel: a rule-based scenario the demo can fire as its persona. */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  actor: string;
  expected: string;
  ready: boolean;
  hint: string | null;
}

export interface ScenarioResult {
  scenario: string;
  actor: string;
  outcome: AccessOutcome;
  code: string | null;
  message: string;
  summary: string;
  risk_level: RiskLevel;
  reasons: Reason[];
}

export interface AdminApi {
  getScenarios(): Promise<Scenario[]>;
  runScenario(id: string): Promise<ScenarioResult>;
  reset(): Promise<{ ok: boolean }>;
}

export const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "doctor", label: "Doctor" },
  { value: "body_part", label: "Body part" },
  { value: "condition", label: "Condition" },
  { value: "record_type", label: "Type" },
  { value: "date", label: "Date" },
];
