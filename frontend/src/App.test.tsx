/**
 * Frontend tests for the OneTrace UI designs (OneTrace_UI_Designs.pdf, pages 2 to 5).
 *
 * The whole app renders against a fake `fetch` that plays the FastAPI endpoints (shapes from
 * lib/types.ts, synthetic names). One file, grouped by mockup page:
 *   page 3.1  staff login            page 3.2  my patients & requests   page 3.3  patient records
 *   page 4    emergency access, snooping attempt       page 5  calm paused / revoked states
 *   page 2    the patient tabs (already matched the mockup; pinned here so they stay that way)
 *
 * Run with `npm test` (Vitest + Testing Library in jsdom).
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { ageOn, countdown, initials, timeAgo } from "./lib/format";
import type { User } from "./lib/auth";
import type {
  AccessEntry,
  BlockedCode,
  HospitalPatient,
  HospitalRequest,
  PatientAlert,
  PatientRequest,
  Reason,
  RecordGroup,
  RecordSummary,
  VaultSummary,
} from "./lib/types";

// ---- fixtures (synthetic demo data) -----------------------------------------------------------

const NORTHSIDE = { id: 1, code: "HOSP-A", name: "Northside General Hospital", city: "Dallas" };
const RIVERBEND = { id: 2, code: "HOSP-B", name: "Riverbend Medical Center", city: "Fort Worth" };
const DEMO_PASSWORD = "onetrace-demo";

const staff = (id: number, full_name: string, email: string, staff_role: User["staff_role"], hospital = NORTHSIDE): User => ({
  id,
  email,
  full_name,
  role: "staff",
  staff_role,
  hospital_id: hospital.id,
  hospital_name: hospital.name,
  patient_id: null,
  demo_persona: null,
});

const USERS: Record<string, User> = {
  patient: {
    id: 1,
    email: "maya.chen@example.com",
    full_name: "Maya Chen",
    role: "patient",
    staff_role: null,
    hospital_id: null,
    hospital_name: null,
    patient_id: 1,
    demo_persona: "patient",
  },
  doctor_a: staff(4, "Dr. Elena Vasquez", "elena.vasquez@northside.example", "physician"),
  nurse_a: staff(5, "Sam Lee", "sam.lee@northside.example", "nurse"),
  billing_a: staff(6, "Jordan Price", "jordan.price@northside.example", "billing_clerk"),
  doctor_b: staff(7, "Dr. Amir Haddad", "amir.haddad@riverbend.example", "physician", RIVERBEND),
  admin: {
    id: 8,
    email: "demo@onetrace.example",
    full_name: "Demo Control",
    role: "admin",
    staff_role: null,
    hospital_id: null,
    hospital_name: null,
    patient_id: null,
    demo_persona: "admin",
  },
};

const PERSONAS = [
  { key: "patient", role: "patient", description: "Patient treated at Northside General (Hospital A)." },
  { key: "doctor_a", role: "staff", description: "Physician at Northside General (Hospital A)." },
  { key: "nurse_a", role: "staff", description: "Nurse at Northside General (Hospital A)." },
  { key: "billing_a", role: "staff", description: "Billing clerk at Northside General (Hospital A)." },
  { key: "doctor_b", role: "staff", description: "Physician at Riverbend Medical Center (Hospital B)." },
  { key: "admin", role: "admin", description: "Runs the attacker scenarios." },
].map((p) => {
  const u = USERS[p.key];
  return { ...p, full_name: u.full_name, email: u.email, staff_role: u.staff_role, hospital_name: u.hospital_name };
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const tags = (over: Partial<NonNullable<RecordSummary["tags"]>>): RecordSummary["tags"] => ({
  body_part: null,
  condition: null,
  doctor: "Dr. Elena Vasquez",
  record_type: "Clinical note",
  date_of_service: null,
  labels: [],
  tagger: "keyword",
  confidence: 0.9,
  ...over,
});

const RECORDS: RecordSummary[] = [
  {
    id: 1,
    title: "Knee MRI report",
    category: "imaging",
    sensitivity: 1,
    mime_type: "text/plain",
    size_bytes: 420,
    created_at: "2026-10-12T12:00:00Z",
    source_hospital: NORTHSIDE.name,
    tags: tags({ body_part: "Knee", condition: "Knee discomfort", record_type: "MRI report", date_of_service: "2026-10-12", labels: ["Knee", "MRI"] }),
  },
  {
    id: 2,
    title: "Orthopedic visit",
    category: "note",
    sensitivity: 1,
    mime_type: "text/plain",
    size_bytes: 300,
    created_at: "2026-10-01T12:00:00Z",
    source_hospital: NORTHSIDE.name,
    tags: tags({ body_part: "Knee", condition: "Knee discomfort", date_of_service: "2026-10-01", labels: ["Knee", "Clinical note"] }),
  },
  {
    id: 3,
    title: "Psychiatry follow-up note",
    category: "note",
    sensitivity: 3,
    mime_type: "text/plain",
    size_bytes: 512,
    created_at: "2026-10-03T12:00:00Z",
    source_hospital: NORTHSIDE.name,
    tags: tags({ condition: "Depression", date_of_service: "2026-10-03", labels: ["Mental health"] }),
  },
];
const CONTENT: Record<number, string> = {
  1: "Synthetic knee imaging report. Mild joint effusion. Review with treating clinician.",
  2: "Synthetic orthopedic visit note.",
  3: "Synthetic psychiatry note. Never shown to a billing clerk.",
};
const ROBIN_RECORD: RecordSummary = {
  id: 9,
  title: "Allergies",
  category: "note",
  sensitivity: 1,
  mime_type: "text/plain",
  size_bytes: 100,
  created_at: "2026-10-12T12:00:00Z",
  source_hospital: null,
  tags: tags({ doctor: null, date_of_service: "2026-10-12", labels: ["Allergies"] }),
};

const GROUPS_BY_BODY: RecordGroup[] = [
  { key: "knee", label: "Knee", count: 2, top_doctor: "Dr. Elena Vasquez", records: [RECORDS[0], RECORDS[1]] },
  { key: "other", label: "Other / Unknown", count: 1, top_doctor: null, records: [RECORDS[2]] },
];
const GROUPS_BY_DOCTOR: RecordGroup[] = [{ key: "vasquez", label: "Dr. Elena Vasquez", count: 3, top_doctor: null, records: RECORDS }];
const ROBIN_GROUPS: RecordGroup[] = [{ key: "other", label: "Other / Unknown", count: 1, top_doctor: null, records: [ROBIN_RECORD] }];

const PATIENT_ROWS: HospitalPatient[] = [
  { patient_id: 1, full_name: "Maya Chen", mrn: "MRN-100-2231", date_of_birth: "1990-04-03", key_status: "active", last_visit: "2026-10-12T12:00:00Z", emergency_expires_at: null },
  { patient_id: 2, full_name: "Daniel Okafor", mrn: "MRN-100-4410", date_of_birth: "1984-07-19", key_status: "frozen", last_visit: "2026-10-10T12:00:00Z", emergency_expires_at: null },
];
const LOOKUP = [
  { patient_id: 1, full_name: "Maya Chen", mrn: "MRN-100-2231" },
  { patient_id: 2, full_name: "Daniel Okafor", mrn: "MRN-100-4410" },
  { patient_id: 3, full_name: "Robin Ellis", mrn: "MRN-100-8051" },
];

const VAULT: VaultSummary = {
  patient: { id: 1, full_name: "Maya Chen", mrn: "MRN-100-2231", date_of_birth: "1990-04-03" },
  key_version: 1,
  rotated_at: null,
  current_grant: { id: 1, hospital: NORTHSIDE, status: "active", granted_at: "2026-10-12T12:00:00Z", frozen_at: null, ended_at: null },
  past_grants: [],
  emergency: null,
  records: RECORDS,
};
const PATIENT_REQUESTS: PatientRequest[] = [
  { id: 1, hospital: RIVERBEND, requested_by: "Dr. Amir Haddad", reason: "Upcoming cardiology consultation", status: "pending", created_at: minutesAgo(30), decided_at: null },
];
const ALERTS: PatientAlert[] = [
  {
    id: 1,
    created_at: minutesAgo(13 * 60),
    risk_level: "medium",
    title: "Unusual access to your records",
    summary: "Sam Lee, nurse at Northside General Hospital, opened your record list at 11:48 PM.",
    reasons: [{ kind: "off_hours", text: "Outside normal hours (11:48 PM)" }],
    status: "open",
    decision: null,
  },
];
const LOG: AccessEntry[] = [
  { id: 3, ts: minutesAgo(20), actor: { name: "Dr. Elena Vasquez", role_label: "Physician", hospital: NORTHSIDE.name, is_you: false }, summary: "Opened Knee MRI report", outcome: "allowed", deny_reason: null, risk_level: "low", reasons: [] },
  { id: 2, ts: minutesAgo(90), actor: { name: "Jordan Price", role_label: "Billing clerk", hospital: NORTHSIDE.name, is_you: false }, summary: "Tried to open Psychiatry follow-up note", outcome: "denied", deny_reason: "access revoked", risk_level: "high", reasons: [{ kind: "revoked", text: "Access had been revoked" }] },
  { id: 1, ts: minutesAgo(26 * 60), actor: { name: "You", role_label: "Patient", hospital: null, is_you: true }, summary: "Viewed record list", outcome: "allowed", deny_reason: null, risk_level: "none", reasons: [] },
];

// ---- fake API -----------------------------------------------------------------------------------

type Db = {
  user: User | null;
  patients: HospitalPatient[];
  requests: HospitalRequest[];
  /** What the groups call answers per patient: "ok" or a broker denial code. */
  access: Record<number, BlockedCode | "ok">;
  /** Record reads the broker blocks (the snooping attempt), with the rule reasons. */
  readBlock: Record<number, { code: BlockedCode; reasons: Reason[] }>;
  emergencyCalls: Array<{ patient_id: number; justification: string }>;
};
type Call = { method: string; path: string; query: URLSearchParams; body: unknown };

let db: Db;
let calls: Call[];

function freshDb(): Db {
  return {
    user: null,
    patients: structuredClone(PATIENT_ROWS),
    requests: [
      { id: 1, patient: { patient_id: 2, full_name: "Daniel Okafor", mrn: "MRN-100-4410" }, requested_by: "Dr. Elena Vasquez", reason: "Post-op follow-up", status: "approved", created_at: minutesAgo(15), decided_at: minutesAgo(10) },
      { id: 2, patient: { patient_id: 3, full_name: "Robin Ellis", mrn: "MRN-100-8051" }, requested_by: "Dr. Elena Vasquez", reason: "Second opinion", status: "denied", created_at: minutesAgo(60), decided_at: minutesAgo(50) },
    ],
    access: { 1: "ok", 2: "access_frozen", 3: "no_grant" },
    readBlock: {},
    emergencyCalls: [],
  };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const text = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });
const deny = (code: BlockedCode, reasons: Reason[] = []) => {
  const message: Record<BlockedCode, string> = {
    access_frozen: "Access frozen by the patient's security system after unusual activity.",
    access_revoked: "This patient moved their records to another hospital. Your key no longer works.",
    no_grant: "You don't hold a key for this patient.",
  };
  return json({ detail: { code, message: message[code], reasons } }, 403);
};
const session = (user: User) => json({ user, token: "test-token", expires_at: minutesAhead(60) });

function groupsFor(patientId: number, by: string): RecordGroup[] {
  if (patientId === 3) return ROBIN_GROUPS;
  return by === "doctor" ? GROUPS_BY_DOCTOR : GROUPS_BY_BODY;
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  const path = url.pathname;
  const q = url.searchParams;
  calls.push({ method, path, query: q, body });
  const m = (pattern: RegExp) => pattern.exec(path);
  let hit: RegExpExecArray | null;

  // auth
  if (path === "/api/auth/me") return db.user ? json(db.user) : json({ detail: "Not signed in" }, 401);
  if (path === "/api/auth/personas") return json(PERSONAS);
  if (path === "/api/auth/demo-login") {
    db.user = USERS[(body as { persona: string }).persona];
    return session(db.user);
  }
  if (path === "/api/auth/login") {
    const { email, password } = body as { email: string; password: string };
    const user = Object.values(USERS).find((u) => u.email === email);
    if (!user || password !== DEMO_PASSWORD) return json({ detail: "Invalid email or password" }, 401);
    db.user = user;
    return session(user);
  }
  if (path === "/api/auth/logout") {
    db.user = null;
    return new Response(null, { status: 204 });
  }

  // hospital
  if (path === "/api/hospital/patients") {
    const needle = (q.get("q") ?? "").toLowerCase();
    return json(db.patients.filter((p) => !needle || p.full_name.toLowerCase().includes(needle) || p.mrn.toLowerCase().includes(needle)));
  }
  if ((hit = m(/^\/api\/hospital\/patients\/(\d+)\/groups$/))) {
    const id = Number(hit[1]);
    const access = db.access[id] ?? "no_grant";
    if (access !== "ok") return deny(access);
    return json({ patient: db.patients.find((p) => p.patient_id === id), groups: groupsFor(id, q.get("by") ?? "body_part") });
  }
  if ((hit = m(/^\/api\/hospital\/records\/(\d+)(\/content)?$/))) {
    const id = Number(hit[1]);
    const block = db.readBlock[id];
    if (block) return deny(block.code, block.reasons);
    const record = [...RECORDS, ROBIN_RECORD].find((r) => r.id === id);
    if (!record) return json({ detail: "Record not found" }, 404);
    return hit[2] ? text(CONTENT[id] ?? "Synthetic note.") : json(record);
  }
  if (path === "/api/hospital/patient-lookup") {
    const needle = (q.get("q") ?? "").trim().toLowerCase();
    if (needle.length < 2) return json([]);
    return json(LOOKUP.filter((p) => p.full_name.toLowerCase().includes(needle) || p.mrn.toLowerCase().includes(needle)));
  }
  if (path === "/api/hospital/request-access") {
    const { patient_id, reason } = body as { patient_id: number; reason: string };
    if (reason.trim().length < 10) return json({ detail: "Give a reason of at least 10 characters." }, 422);
    const patient = LOOKUP.find((p) => p.patient_id === patient_id)!;
    const req: HospitalRequest = { id: db.requests.length + 1, patient, requested_by: db.user!.full_name, reason, status: "pending", created_at: new Date().toISOString(), decided_at: null };
    db.requests.unshift(req);
    return json(req, 201);
  }
  if (path === "/api/hospital/requests") return json(db.requests);
  if (path === "/api/hospital/emergency") {
    const { patient_id, justification } = body as { patient_id: number; justification: string };
    db.emergencyCalls.push({ patient_id, justification });
    const who = LOOKUP.find((p) => p.patient_id === patient_id)!;
    const expires_at = minutesAhead(60);
    db.patients = db.patients.filter((p) => p.patient_id !== patient_id);
    db.patients.push({ patient_id, full_name: who.full_name, mrn: who.mrn, date_of_birth: "1984-07-19", key_status: "emergency", last_visit: new Date().toISOString(), emergency_expires_at: expires_at });
    db.access[patient_id] = "ok";
    return json({ id: 1, hospital: NORTHSIDE, staff_name: db.user!.full_name, justification, created_at: new Date().toISOString(), expires_at }, 201);
  }

  // patient
  if (path === "/api/patient/vault") return json(VAULT);
  if (path === "/api/patient/records/groups") return json(groupsFor(1, q.get("by") ?? "body_part"));
  if ((hit = m(/^\/api\/patient\/records\/(\d+)(\/content)?$/))) {
    const id = Number(hit[1]);
    return hit[2] ? text(CONTENT[id]) : json(RECORDS.find((r) => r.id === id));
  }
  if (path === "/api/hospitals") return json([NORTHSIDE, RIVERBEND]);
  if (path === "/api/patient/requests") return json(PATIENT_REQUESTS);
  if (path === "/api/patient/alerts") return json(ALERTS);
  if (path === "/api/patient/access-log") {
    const filter = q.get("filter");
    return json(
      LOG.filter((e) => (filter === "denied" ? e.outcome !== "allowed" : filter === "flagged" ? e.risk_level === "medium" || e.risk_level === "high" : true)),
    );
  }
  if (path === "/api/audit/verify") return json({ valid: true, entries: LOG.length, first_broken_entry: null });

  return json({ detail: `No fake route for ${method} ${path}` }, 404);
}

// ---- harness ------------------------------------------------------------------------------------

beforeAll(() => {
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubGlobal("EventSource", undefined); // lib/live.ts skips SSE when the browser has none
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  db = freshDb();
  calls = [];
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

const card = (headingName: string) => screen.getByRole("heading", { name: headingName }).closest("section")!;

// ---- tests --------------------------------------------------------------------------------------

describe("format helpers used by the new screens", () => {
  it("timeAgo picks the nearest friendly unit and never goes negative", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(timeAgo("2026-10-17T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-17T11:58:00Z", now)).toBe("2 min ago");
    expect(timeAgo("2026-10-17T11:45:00Z", now)).toBe("15 min ago");
    expect(timeAgo("2026-10-17T11:00:00Z", now)).toBe("1 hour ago");
    expect(timeAgo("2026-10-17T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-10-15T12:00:00Z", now)).toBe("2 days ago");
    expect(timeAgo("2026-10-17T13:00:00Z", now)).toBe("just now");
  });

  it("ageOn counts whole years from a calendar date of birth", () => {
    expect(ageOn("1990-04-03", new Date(2026, 9, 17))).toBe(36);
    expect(ageOn("1990-04-03", new Date(2026, 3, 2))).toBe(35);
    expect(ageOn("1990-04-03", new Date(2026, 3, 3))).toBe(36);
  });

  it("countdown renders m:ss and stops at 0:00", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(countdown("2026-10-17T12:59:42Z", now)).toBe("59:42");
    expect(countdown("2026-10-17T12:00:05Z", now)).toBe("0:05");
    expect(countdown("2026-10-17T11:00:00Z", now)).toBe("0:00");
  });

  it("initials skip the Dr. prefix", () => {
    expect(initials("Dr. Elena Vasquez")).toBe("EV");
    expect(initials("Maya Chen")).toBe("MC");
  });
});

describe("Staff login (mockup page 3, screen 1)", () => {
  it("shows the brand panel, grouped demo accounts and the email form side by side", async () => {
    renderAt("/login");
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OneTrace" })).toBeInTheDocument();
    expect(screen.getByText("Transparent access for better care")).toBeInTheDocument();
    expect(screen.getByText("Select a demo account or enter your credentials")).toBeInTheDocument();

    expect(await screen.findByRole("button", { name: /Dr\. Elena Vasquez/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Patients" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Hospital staff" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Demo control" })).toBeInTheDocument();
    expect(screen.getByText("Physician · Northside General Hospital")).toBeInTheDocument();
    expect(screen.getByText("Billing clerk · Northside General Hospital")).toBeInTheDocument();
    expect(screen.getByText("Physician · Riverbend Medical Center")).toBeInTheDocument();

    expect(screen.getByText("Or sign in with your email")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("one click on a persona signs in and lands on that role's home", async () => {
    const user = userEvent.setup();
    renderAt("/login");
    await user.click(await screen.findByRole("button", { name: /Dr\. Elena Vasquez/ }));
    expect(await screen.findByRole("heading", { name: "My patients" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/hospital");
    expect(calls.some((c) => c.path === "/api/auth/demo-login" && (c.body as { persona: string }).persona === "doctor_a")).toBe(true);
  });

  it("a patient persona lands on the vault, demo control on its panel", async () => {
    const user = userEvent.setup();
    renderAt("/login");
    await user.click(await screen.findByRole("button", { name: /Maya Chen/ }));
    expect(await screen.findByRole("heading", { name: "My vault" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/patient");
  });

  it("rejects a wrong password with the API's message and stays on the page", async () => {
    const user = userEvent.setup();
    renderAt("/login");
    await screen.findByRole("button", { name: /Dr\. Elena Vasquez/ });
    await user.type(screen.getByLabelText("Email"), "elena.vasquez@northside.example");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(db.user).toBeNull();
  });

  it("signs staff in with email and password", async () => {
    const user = userEvent.setup();
    renderAt("/login");
    await screen.findByRole("button", { name: /Dr\. Elena Vasquez/ });
    await user.type(screen.getByLabelText("Email"), "jordan.price@northside.example");
    await user.type(screen.getByLabelText("Password"), DEMO_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "My patients" })).toBeInTheDocument();
    expect(screen.getByText("Billing clerk · Northside General Hospital")).toBeInTheDocument();
  });

  it("redirects anonymous visitors to the login page and keeps patients out of the hospital", async () => {
    renderAt("/patient");
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    cleanup();

    db.user = USERS.patient;
    renderAt("/hospital");
    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to my home" })).toHaveAttribute("href", "/");
  });
});

describe("Hospital workspace: my patients & requests (mockup page 3, screen 2)", () => {
  beforeEach(() => {
    db.user = USERS.doctor_a;
  });

  it("header shows the signed-in clinician with role and hospital, no tab bar, and the menu signs out", async () => {
    const user = userEvent.setup();
    renderAt("/hospital");
    await screen.findByRole("heading", { name: "My patients" });
    const menu = screen.getByRole("button", { name: "Account menu" });
    expect(menu).toHaveTextContent("Dr. Elena Vasquez");
    expect(menu).toHaveTextContent("Physician · Northside General Hospital");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    await user.click(menu);
    await user.click(screen.getByRole("menuitem", { name: /Sign out/ }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(db.user).toBeNull();
  });

  it("lists patients with ID, a dot status (Paused, never Frozen) and last visit", async () => {
    renderAt("/hospital");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Patient", "Patient ID", "Status", "Last visit"]);

    const maya = within(table).getByRole("row", { name: /Maya Chen/ });
    expect(within(maya).getByText("MRN-100-2231")).toBeInTheDocument();
    expect(within(maya).getByText("Active")).toBeInTheDocument();
    expect(within(maya).getByText("Oct 12, 2026")).toBeInTheDocument();
    expect(within(maya).getByRole("link", { name: "Maya Chen" })).toHaveAttribute("href", "/hospital/patients/1");

    const daniel = within(table).getByRole("row", { name: /Daniel Okafor/ });
    expect(within(daniel).getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText("Frozen")).not.toBeInTheDocument();

    expect(screen.getByText("Patients you have access to")).toBeInTheDocument();
    expect(screen.getByText("Revoked patients are removed from this list.")).toBeInTheDocument();
  });

  it("filters the table through the search box", async () => {
    const user = userEvent.setup();
    renderAt("/hospital");
    await screen.findByRole("row", { name: /Maya Chen/ });
    await user.type(screen.getByLabelText("Search patients"), "Daniel");
    await waitFor(() => expect(screen.queryByRole("row", { name: /Maya Chen/ })).not.toBeInTheDocument());
    expect(screen.getByRole("row", { name: /Daniel Okafor/ })).toBeInTheDocument();
  });

  it("the old /hospital/requests address lands on the same workspace", async () => {
    renderAt("/hospital/requests");
    expect(await screen.findByRole("heading", { name: "Request patient access" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My patients" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/hospital");
  });

  it("recent requests show each decision with a relative time and the live-updates dot", async () => {
    renderAt("/hospital");
    await screen.findByRole("heading", { name: "Recent requests" });
    const recent = card("Recent requests");
    expect(within(recent).getByText("Live updates")).toBeInTheDocument();
    expect(await within(recent).findByText("Approved")).toBeInTheDocument();
    expect(within(recent).getByText("Denied")).toBeInTheDocument();
    expect(within(recent).getByText("Daniel Okafor")).toBeInTheDocument();
    expect(within(recent).getByText("Robin Ellis")).toBeInTheDocument();
    expect(within(recent).getByText("15 min ago")).toBeInTheDocument();
    expect(within(recent).getByText("1 hour ago")).toBeInTheDocument();
  });

  it("looks a patient up, shows No active grant, gates the reason and sends the request", async () => {
    const user = userEvent.setup();
    renderAt("/hospital");
    await screen.findByRole("heading", { name: "Request patient access" });
    expect(screen.getByText("Send a request to access a patient's records")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search by name or patient ID"), "Rob");
    await user.click(await screen.findByRole("button", { name: /Robin Ellis/ }));
    const request = card("Request patient access");
    expect(within(request).getByText(/Patient ID: MRN-100-8051/)).toBeInTheDocument();
    expect(within(request).getByText(/No active grant/)).toBeInTheDocument();
    expect(within(request).getByText("Synthetic")).toBeInTheDocument();
    expect(within(request).getByRole("button", { name: /Emergency access/ })).toBeInTheDocument();
    expect(within(request).getByText("ER staff only.")).toBeInTheDocument();

    const send = within(request).getByRole("button", { name: /Send request/ });
    expect(send).toBeDisabled();
    await user.type(within(request).getByLabelText("Reason"), "Cardio");
    expect(send).toBeDisabled();
    await user.type(within(request).getByLabelText("Reason"), "logy consult next week");
    expect(send).toBeEnabled();
    await user.click(send);

    expect(await screen.findByText(/Request sent to Robin Ellis/)).toBeInTheDocument();
    expect(db.requests[0]).toMatchObject({ patient: { patient_id: 3 }, reason: "Cardiology consult next week", status: "pending" });
    const recent = card("Recent requests");
    expect(await within(recent).findByText("Pending")).toBeInTheDocument();
    expect(within(recent).getByText("just now")).toBeInTheDocument();
    expect(within(request).getByPlaceholderText("Search by name or patient ID")).toHaveValue("");
  });

  it("a patient the hospital already holds a key for says so instead of No active grant", async () => {
    const user = userEvent.setup();
    renderAt("/hospital");
    await screen.findByRole("heading", { name: "Request patient access" });
    await user.type(screen.getByPlaceholderText("Search by name or patient ID"), "Maya");
    await user.click(await screen.findByRole("button", { name: /Maya Chen/ }));
    expect(await within(card("Request patient access")).findByText(/Key active/)).toBeInTheDocument();
  });

  it("a billing clerk never sees the emergency button or the ER note", async () => {
    db.user = USERS.billing_a;
    const user = userEvent.setup();
    renderAt("/hospital");
    await screen.findByRole("heading", { name: "Request patient access" });
    await user.type(screen.getByPlaceholderText("Search by name or patient ID"), "Rob");
    await user.click(await screen.findByRole("button", { name: /Robin Ellis/ }));
    expect(screen.getByText(/No active grant/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Emergency access/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ER staff only.")).not.toBeInTheDocument();
  });
});

describe("Patient records (mockup page 3, screen 3)", () => {
  beforeEach(() => {
    db.user = USERS.doctor_a;
  });

  it("shows the patient header, the lock banner, grouping tabs and the three empty panels", async () => {
    renderAt("/hospital/patients/1");
    expect(await screen.findByRole("heading", { name: /Maya Chen/ })).toHaveTextContent("Synthetic");
    expect(screen.getByText(/Patient ID: MRN-100-2231/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`DOB: Apr 3, 1990 \\(age ${ageOn("1990-04-03")}\\)`))).toBeInTheDocument();
    expect(screen.getByText(/Active access/)).toBeInTheDocument();
    expect(screen.getByText("Every record you open is logged and visible to the patient.")).toBeInTheDocument();

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Doctor", "Body part", "Condition", "Type", "Date"]);
    expect(screen.getByRole("tab", { name: "Body part" })).toHaveAttribute("aria-selected", "true");

    expect(screen.getByRole("heading", { name: "Records" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Record viewer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Record details" })).toBeInTheDocument();
    expect(screen.getByText("Select a record to open it")).toBeInTheDocument();
    expect(screen.getByText("Details appear once a record is open.")).toBeInTheDocument();
    expect(screen.queryByText("Access checked")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /My patients/ })).toHaveAttribute("href", "/hospital");
  });

  it("lists records compactly: group bars, category · date, a Sensitive pill, collapsed second group", async () => {
    const user = userEvent.setup();
    renderAt("/hospital/patients/1");
    const knee = await screen.findByRole("link", { name: /Knee MRI report/ });
    expect(knee).toHaveTextContent("Imaging · Oct 12, 2026");
    expect(screen.getByRole("link", { name: /Orthopedic visit/ })).toHaveTextContent("Clinical note · Oct 1, 2026");
    expect(screen.getByRole("button", { name: "Knee · 2 records" })).toHaveAttribute("aria-expanded", "true");

    const other = screen.getByRole("button", { name: "Other / Unknown · 1 record" });
    expect(other).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Psychiatry follow-up note/ })).not.toBeInTheDocument();
    await user.click(other);
    const psych = screen.getByRole("link", { name: /Psychiatry follow-up note/ });
    expect(within(psych).getByText("Sensitive")).toBeInTheDocument();
    expect(psych).toHaveTextContent("Clinical note · Oct 3, 2026");
    expect(within(knee).queryByText("Sensitive")).not.toBeInTheDocument();
  });

  it("opens a record: decrypted text, details table, pager, status strip and the selected row", async () => {
    const user = userEvent.setup();
    renderAt("/hospital/patients/1");
    await user.click(await screen.findByRole("link", { name: /Knee MRI report/ }));
    expect(window.location.pathname).toBe("/hospital/patients/1/records/1");

    expect(await screen.findByText(CONTENT[1])).toBeInTheDocument();
    const viewer = card("Record viewer");
    expect(within(viewer).getByRole("heading", { name: "Knee MRI report" })).toBeInTheDocument();
    expect(within(viewer).getByText(/Imaging · Oct 12, 2026/)).toBeInTheDocument();
    expect(within(viewer).getByText("Record 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Knee MRI report/ })).toHaveAttribute("aria-current", "true");

    expect(screen.getByText("Access checked")).toBeInTheDocument();
    expect(screen.getByText("Logged before display")).toBeInTheDocument();

    const details = card("Record details");
    expect(within(details).getAllByRole("term").map((t) => t.textContent)).toEqual(["Doctor", "Type", "Body part", "Condition", "Date", "Sensitivity"]);
    expect(within(details).getAllByRole("definition").map((d) => d.textContent)).toEqual([
      "Dr. Elena Vasquez",
      "MRI report",
      "Knee",
      "Knee discomfort",
      "Oct 12, 2026",
      "Standard",
    ]);
    expect(calls.some((c) => c.path === "/api/hospital/records/1/content")).toBe(true);
  });

  it("the pager walks through every record in the current grouping order", async () => {
    const user = userEvent.setup();
    renderAt("/hospital/patients/1/records/1");
    await screen.findByText("Record 1 of 3");
    expect(screen.queryByRole("link", { name: "Previous record" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Next record" }));
    expect(window.location.pathname).toBe("/hospital/patients/1/records/2");
    expect(await screen.findByText("Record 2 of 3")).toBeInTheDocument();
    expect(await within(card("Record viewer")).findByRole("heading", { name: "Orthopedic visit" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Next record" }));
    expect(await screen.findByText("Record 3 of 3")).toBeInTheDocument();
    expect(within(card("Record details")).getByText("Sensitive")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Next record" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Previous record" }));
    expect(await screen.findByText("Record 2 of 3")).toBeInTheDocument();
  });

  it("switching the grouping tab refetches with that key and keeps the tab selected", async () => {
    const user = userEvent.setup();
    renderAt("/hospital/patients/1");
    await user.click(await screen.findByRole("tab", { name: "Doctor" }));
    expect(await screen.findByRole("button", { name: "Dr. Elena Vasquez · 3 records" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Doctor" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Body part" })).toHaveAttribute("aria-selected", "false");
    expect(calls.some((c) => c.path === "/api/hospital/patients/1/groups" && c.query.get("by") === "doctor")).toBe(true);
  });
});

describe("Emergency access (mockup page 4, screens 3 to 5)", () => {
  beforeEach(() => {
    db.user = USERS.doctor_a;
  });

  it("a patient without a key shows the no-key panel with the amber emergency button and a request link", async () => {
    renderAt("/hospital/patients/3");
    const panel = await screen.findByRole("alert");
    expect(within(panel).getByRole("heading", { name: "No key for this patient" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Emergency access/ })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/hospital");
    expect(within(panel).getByText("This attempt was logged and is visible to the patient.")).toBeInTheDocument();
  });

  it("the confirmation counts characters, needs the tick, then opens the session with the countdown pills", async () => {
    const user = userEvent.setup();
    const reason = "Unconscious patient, car accident.";
    renderAt("/hospital/patients/3");
    await user.click(await screen.findByRole("button", { name: /Emergency access/ }));

    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Reason for emergency access");
    expect(within(dialog).getByText("Minimum 10 characters (current: 0).")).toBeInTheDocument();
    expect(within(dialog).getByText(/Access lasts 1 hour\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Every read has at least MEDIUM risk\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Clinicians only/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Confirm emergency access" });
    expect(confirm).toBeDisabled();

    await user.type(field, reason);
    expect(within(dialog).getByText(`Minimum 10 characters (current: ${reason.length}).`)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: "I confirm this is an emergency." }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(db.emergencyCalls).toEqual([{ patient_id: 3, justification: reason }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const pill = await screen.findByText(/Emergency access ·/);
    expect(pill).toHaveTextContent(/Emergency access · \d+:\d\d remaining/);
    expect(screen.getByText("AI risk: Medium")).toBeInTheDocument();
    expect(screen.getByText("Patient notified.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Robin Ellis/ })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Allergies/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cancel closes the dialog without calling the API", async () => {
    const user = userEvent.setup();
    renderAt("/hospital/patients/3");
    await user.click(await screen.findByRole("button", { name: /Emergency access/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(db.emergencyCalls).toEqual([]);
  });

  it("a nurse gets the button, a billing clerk only the request link", async () => {
    db.user = USERS.nurse_a;
    renderAt("/hospital/patients/3");
    expect(within(await screen.findByRole("alert")).getByRole("button", { name: /Emergency access/ })).toBeInTheDocument();
    cleanup();

    db.user = USERS.billing_a;
    renderAt("/hospital/patients/3");
    const panel = await screen.findByRole("alert");
    expect(within(panel).queryByRole("button", { name: /Emergency access/ })).not.toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Request access" })).toBeInTheDocument();
  });
});

describe("Calm access states (mockup page 5) and the snooping attempt (page 4, screen 6)", () => {
  beforeEach(() => {
    db.user = USERS.doctor_a;
  });

  it("a paused key: amber Access paused panel, no content, no emergency button, a way back", async () => {
    db.access[1] = "access_frozen";
    renderAt("/hospital/patients/1");
    const panel = await screen.findByRole("alert");
    expect(within(panel).getByRole("heading", { name: "Access paused" })).toBeInTheDocument();
    expect(within(panel).getByText("Paused by the patient's security system. The patient may restore access.")).toBeInTheDocument();
    expect(within(panel).getByText("Attempt logged · Patient notified")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Back to patients" })).toHaveAttribute("href", "/hospital");
    expect(within(panel).queryByRole("button", { name: /Emergency access/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Knee MRI report")).not.toBeInTheDocument();
    expect(screen.queryByText(/frozen/i)).not.toBeInTheDocument();
  });

  it("a revoked key: the cracked-key panel with the High risk pill", async () => {
    db.access[1] = "access_revoked";
    renderAt("/hospital/patients/1");
    const panel = await screen.findByRole("alert");
    expect(within(panel).getByRole("heading", { name: "Your key no longer works" })).toBeInTheDocument();
    expect(within(panel).getByText("The patient has revoked your hospital's access.")).toBeInTheDocument();
    expect(within(panel).getByText("AI risk: High")).toBeInTheDocument();
    expect(within(panel).getByText("Attempt logged · Patient notified")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Back to patients" })).toHaveAttribute("href", "/hospital");
    expect(within(panel).queryByRole("button", { name: /Emergency access/ })).not.toBeInTheDocument();
  });

  it("a blocked read of a sensitive note: attempted record, the reasons, the denial strip, no content", async () => {
    db.user = USERS.billing_a;
    db.readBlock[3] = {
      code: "access_frozen",
      reasons: [
        { kind: "sensitive_record", text: "Sensitive record (Psychiatry)" },
        { kind: "role_mismatch", text: "Unrelated to the billing clerk role" },
      ],
    };
    renderAt("/hospital/patients/1/records/3");

    const panel = await screen.findByRole("alert");
    expect(within(panel).getByRole("heading", { name: "Access paused" })).toBeInTheDocument();
    expect(screen.getByText("Attempted record")).toBeInTheDocument();
    expect(screen.getByText("Psychiatry follow-up note")).toBeInTheDocument();
    expect(screen.getByText("Sensitive")).toBeInTheDocument();
    expect(screen.getByText(/Clinical note · Oct 3, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Reason for block")).toBeInTheDocument();
    expect(screen.getByText("Sensitive record (Psychiatry)")).toBeInTheDocument();
    expect(screen.getByText("Unrelated to the billing clerk role")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Patient alerted · Attempt logged as denied.");
    expect(screen.getByText("No content displayed.")).toBeInTheDocument();

    // header pills: the clerk's attempt was HIGH risk and paused the key
    expect(screen.getByText("AI risk: High")).toBeInTheDocument();
    expect(screen.getAllByText("Access paused")).toHaveLength(2);
    expect(screen.getByText(/Maya Chen/)).toBeInTheDocument();

    expect(screen.queryByText(CONTENT[3])).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/hospital/patients/1");
  });

  it("a plain denial without reasons still shows the attempted record and the strip", async () => {
    db.readBlock[1] = { code: "access_revoked", reasons: [] };
    renderAt("/hospital/patients/1/records/1");
    const panel = await screen.findByRole("alert");
    expect(within(panel).getByRole("heading", { name: "Your key no longer works" })).toBeInTheDocument();
    expect(screen.getByText("Attempted record")).toBeInTheDocument();
    expect(screen.queryByText("Reason for block")).not.toBeInTheDocument();
    expect(screen.getByText("No content displayed.")).toBeInTheDocument();
  });
});

describe("Patient app (mockup page 2)", () => {
  beforeEach(() => {
    db.user = USERS.patient;
  });

  it("Vault: encrypted header, upload button, grouping chips, record cards and the four tabs", async () => {
    renderAt("/patient");
    expect(await screen.findByRole("heading", { name: "My vault" })).toBeInTheDocument();
    expect(await screen.findByText("Only you and Northside General Hospital hold keys.")).toBeInTheDocument();
    expect(screen.getByText("Your vault · Encrypted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload record/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Body part" })).toHaveAttribute("aria-pressed", "true");

    const knee = await screen.findByRole("link", { name: /Knee MRI report/ });
    expect(knee).toHaveTextContent("Oct 12, 2026");
    expect(knee).toHaveTextContent("Dr. Elena Vasquez");
    expect(within(knee).getByText("MRI")).toBeInTheDocument();
    expect(within(knee).getByLabelText("Encrypted")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Patient" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Vault",
      "Keys",
      "History",
      expect.stringMatching(/^Alerts/),
    ]);
    expect(within(nav).getByRole("link", { name: /Alerts/ })).toHaveTextContent("1");
  });

  it("Keys: current holder, the pending request with Approve and Deny, previous holders, emergency row", async () => {
    renderAt("/patient/access");
    expect(await screen.findByRole("heading", { name: "Who has my key" })).toBeInTheDocument();
    expect(screen.getByText("You control who can access your vault.")).toBeInTheDocument();
    expect(await screen.findByText("Northside General Hospital")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move to another hospital/ })).toBeInTheDocument();

    expect(await screen.findByText("Riverbend Medical Center requests access")).toBeInTheDocument();
    expect(screen.getByText("Upcoming cardiology consultation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.getByText("You will confirm before access changes.")).toBeInTheDocument();

    expect(screen.getByText("No previous holders.")).toBeInTheDocument();
    expect(screen.getByText("Past hospitals will appear here.")).toBeInTheDocument();
    expect(screen.getByText("No emergency access active.")).toBeInTheDocument();
  });

  it("History: verified badge, filters, day groups, outcome strips and the why-flagged expander", async () => {
    const user = userEvent.setup();
    renderAt("/patient/history");
    expect(await screen.findByRole("heading", { name: "Access history" })).toBeInTheDocument();
    expect(await screen.findByText("History verified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Denied" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Flagged" })).toHaveAttribute("aria-pressed", "false");

    expect(await screen.findByText("Opened Knee MRI report")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeInTheDocument();
    expect(screen.getAllByText("Allowed · Low")).toHaveLength(2);
    expect(screen.getByText(/Denied: access revoked/)).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Why it was blocked/ }));
    expect(screen.getByText("Access had been revoked")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Denied" }));
    await waitFor(() => expect(screen.queryByText("Opened Knee MRI report")).not.toBeInTheDocument());
    expect(screen.getByText("Tried to open Psychiatry follow-up note")).toBeInTheDocument();
  });

  it("Alerts: the open alert with its reasons and decisions; freezing asks for confirmation", async () => {
    const user = userEvent.setup();
    renderAt("/patient/alerts");
    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Unusual access to your records" })).toBeInTheDocument();
    expect(screen.getByText("Outside normal hours (11:48 PM)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Looks fine" })).toBeInTheDocument();
    expect(screen.getByText("Access changes require confirmation.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Freeze access" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Freeze this hospital's access?");
  });
});
