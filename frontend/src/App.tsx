import { BrowserRouter, Route, Routes } from "react-router";

import { AppShell, RequireRole } from "./components/AppShell";
import { PatientShell } from "./components/PatientShell";
import { AuthProvider } from "./lib/auth";
import { Forbidden, HomeRedirect, NotFound } from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import DemoControlPage from "./pages/admin/DemoControlPage";
import PatientRecordsPage from "./pages/hospital/PatientRecordsPage";
import PatientsPage from "./pages/hospital/PatientsPage";
import RequestsPage from "./pages/hospital/RequestsPage";
import AlertsPage from "./pages/patient/AlertsPage";
import HistoryPage from "./pages/patient/HistoryPage";
import KeysPage from "./pages/patient/KeysPage";
import RecordPage from "./pages/patient/RecordPage";
import VaultPage from "./pages/patient/VaultPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
            <Route index element={<DemoControlPage />} />
          </Route>

          <Route path="/forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
