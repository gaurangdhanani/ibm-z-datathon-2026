import { BrowserRouter, Route, Routes } from "react-router";

import { AppShell, RequireRole } from "./components/AppShell";
import { PatientShell } from "./components/PatientShell";
import { AuthProvider, useAuth } from "./lib/auth";
import { USE_MOCK } from "./lib/data";
import { setMockActor } from "./lib/mock";
import { AdminHome, Forbidden, HomeRedirect, NotFound } from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import PatientRecordsPage from "./pages/hospital/PatientRecordsPage";
import PatientsPage from "./pages/hospital/PatientsPage";
import RequestsPage from "./pages/hospital/RequestsPage";
import AlertsPage from "./pages/patient/AlertsPage";
import HistoryPage from "./pages/patient/HistoryPage";
import KeysPage from "./pages/patient/KeysPage";
import RecordPage from "./pages/patient/RecordPage";
import VaultPage from "./pages/patient/VaultPage";

/** The mock API acts as whoever is signed in. Set during render so pages' first fetch sees it. */
function MockActorSync() {
  const { user } = useAuth();
  if (USE_MOCK) setMockActor(user);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MockActorSync />
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/patient"
            element={
              <RequireRole roles={["patient"]}>
                <PatientShell />
              </RequireRole>
            }
          >
            <Route index element={<VaultPage />} />
            <Route path="records/:recordId" element={<RecordPage />} />
            <Route path="access" element={<KeysPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="alerts" element={<AlertsPage />} />
          </Route>

          <Route
            path="/hospital"
            element={
              <RequireRole roles={["staff"]}>
                <AppShell />
              </RequireRole>
            }
          >
            <Route index element={<PatientsPage />} />
            <Route path="patients/:patientId" element={<PatientRecordsPage />} />
            <Route path="patients/:patientId/records/:recordId" element={<PatientRecordsPage />} />
            <Route path="requests" element={<RequestsPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <AppShell />
              </RequireRole>
            }
          >
            <Route index element={<AdminHome />} />
          </Route>

          <Route path="/forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
