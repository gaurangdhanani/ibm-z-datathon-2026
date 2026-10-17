/**
 * The Phase 2+ data layer every screen imports. Mock until the endpoints exist; build with
 * VITE_MOCK_API=false to hit the live FastAPI endpoints (same shapes, see lib/types.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

import { api, apiBlob, apiForm } from "./api";
import { emitChange, subscribe } from "./bus";
import { mockHospitalApi, mockPatientApi } from "./mock";
import type { HospitalApi, PatientApi, RecordContent, RecordSummary } from "./types";

export const USE_MOCK = import.meta.env.VITE_MOCK_API !== "false";

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

async function readLive(base: string, id: number): Promise<RecordContent> {
  const record = await api<RecordSummary>(`${base}/${id}`);
  return { record, blob: await apiBlob(`${base}/${id}/content`) };
}

const livePatientApi: PatientApi = {
  getVault: () => api("/api/patient/vault"),
  getGroups: (by) => api(`/api/patient/records/groups?by=${by}`),
  readRecord: (id) => readLive("/api/patient/records", id),
  uploadRecord: (file, title) => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    return apiForm("/api/patient/records", form);
  },
  listHospitals: () => api("/api/hospitals"),
  grant: (hospital_id) => post("/api/patient/grant", { hospital_id }),
  transfer: (to_hospital_id) => post("/api/patient/transfer", { to_hospital_id }),
  getRequests: () => api("/api/patient/requests"),
  decideRequest: (id, decision) => post(`/api/patient/requests/${id}/decision`, { decision }),
  getAccessLog: (filter) => api(`/api/patient/access-log?filter=${filter}`),
  verifyHistory: () => api("/api/audit/verify"),
  getAlerts: () => api("/api/patient/alerts"),
  decideAlert: (id, decision) => post(`/api/patient/alerts/${id}/decision`, { decision }),
  endEmergency: (id) => post(`/api/patient/emergency/${id}/end`),
};

const liveHospitalApi: HospitalApi = {
  getPatients: (query) => api(`/api/hospital/patients?q=${encodeURIComponent(query)}`),
  getPatientGroups: (patientId, by) => api(`/api/hospital/patients/${patientId}/groups?by=${by}`),
  readRecord: (id) => readLive("/api/hospital/records", id),
  lookupPatient: (query) => api(`/api/hospital/patient-lookup?q=${encodeURIComponent(query)}`),
  requestAccess: (patient_id, reason) => post("/api/hospital/request-access", { patient_id, reason }),
  getRequests: () => api("/api/hospital/requests"),
};

/** Wrap the calls that change state so every open screen refetches afterwards. */
function notifying<T extends object>(impl: T, mutations: Array<keyof T>): T {
  const out = { ...impl };
  for (const name of mutations) {
    const fn = impl[name] as unknown as (...args: unknown[]) => Promise<unknown>;
    (out as Record<keyof T, unknown>)[name] = async (...args: unknown[]) => {
      const result = await fn(...args);
      emitChange();
      return result;
    };
  }
  return out;
}

export const patientApi = notifying(USE_MOCK ? mockPatientApi : livePatientApi, [
  "uploadRecord",
  "grant",
  "transfer",
  "decideRequest",
  "decideAlert",
  "endEmergency",
]);
export const hospitalApi = notifying(USE_MOCK ? mockHospitalApi : liveHospitalApi, ["requestAccess"]);

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data for a screen and keep it fresh: refetches when `deps` change (keeping the old data on
 * screen meanwhile) and quietly whenever the data bus says something changed. Pass `live: false`
 * for broker reads of record content, which are logged and must not repeat on every change.
 */
export function useResource<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  { live = true }: { live?: boolean } = {},
): Resource<T> {
  const [state, setState] = useState<{ data?: T; error: Error | null; loading: boolean }>({
    error: null,
    loading: true,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const run = useCallback((quiet: boolean) => {
    const id = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    loadRef.current().then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (error: Error) => id === seq.current && setState((s) => ({ data: quiet ? s.data : undefined, error, loading: false })),
    );
  }, []);

  useEffect(() => run(false), deps);
  useEffect(() => (live ? subscribe(() => run(true)) : undefined), [run, live]);

  const reload = useCallback(() => run(false), [run]);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/** Re-run `fn` every `ms` while mounted (VLT-5: hospitals poll request status). */
export function usePolling(fn: () => void, ms: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const timer = setInterval(() => fnRef.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}
