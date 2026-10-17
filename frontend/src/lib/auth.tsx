import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api } from "./api";

export type Role = "patient" | "staff" | "admin";
export type StaffRole = "physician" | "nurse" | "billing_clerk" | "records_clerk";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  staff_role: StaffRole | null;
  hospital_id: number | null;
  hospital_name: string | null;
  patient_id: number | null;
  demo_persona: string | null;
}

export interface Persona {
  key: string;
  full_name: string;
  email: string;
  role: Role;
  staff_role: StaffRole | null;
  hospital_name: string | null;
  description: string;
}

interface SessionOut {
  user: User;
  token: string;
  expires_at: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  demoLogin: (persona: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api<SessionOut>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(session.user);
    return session.user;
  }, []);

  const demoLogin = useCallback(async (persona: string) => {
    const session = await api<SessionOut>("/api/auth/demo-login", {
      method: "POST",
      body: JSON.stringify({ persona }),
    });
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    await api<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, demoLogin, logout }),
    [user, loading, login, demoLogin, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Where each role lands after login. */
export function homeFor(user: User): string {
  if (user.role === "patient") return "/patient";
  if (user.role === "staff") return "/hospital";
  return "/admin";
}

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  physician: "Physician",
  nurse: "Nurse",
  billing_clerk: "Billing clerk",
  records_clerk: "Records clerk",
};
