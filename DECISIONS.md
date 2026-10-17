# Decisions

One entry per decision, newest last. Record anything a teammate would otherwise have to ask about.

## FND-1 · Repo layout and pinned dependencies (Sat)

- Flat layout: `medvault/` (FastAPI package), `tests/`, `frontend/` (Vite SPA), `data/` (SQLite, gitignored). `reports/` arrives with DET-6.
- Python ≥ 3.10 so the LinuxONE distro Python works; code avoids 3.12-only syntax.
- Exact pins in `requirements.txt` / `requirements-dev.txt` (tested on Python 3.13, macOS arm64) and `frontend/package-lock.json`. `uvicorn` is installed without the `[standard]` extras so there are no uvloop/httptools native builds on s390x.
- `cryptography` is the only runtime package that might lack an s390x wheel. If `make setup` fails there, install the distro package (`apt install python3-cryptography`) and create the venv with `--system-site-packages`. Record the outcome under FND-6.

## FND-2 · App skeleton

- One app factory, `medvault.main.create_app(settings)`, keeps the engine on `app.state` so tests run on an in-memory SQLite without globals.
- Security headers come from a small pure-ASGI middleware (not `BaseHTTPMiddleware`) so the SSE streams in VLT-9 are not buffered. API responses are `Cache-Control: no-store`; the SPA gets a strict CSP; hashed `/assets/*` are immutable.
- CORS is enabled only outside prod, for the Vite dev server. In prod the SPA is same-origin, served by FastAPI from `frontend/dist`.
- `/api/health` reports `platform.machine()` so the s390x smoke test (FND-6) can prove where it ran.

## FND-3 · Data model

- Resolves the open decision: `access_requests`, `emergency_grants` and `care_episodes` are real tables from day one.
- Enum columns store string values, not member names, so `sqlite3` output and API JSON use the same words.
- SQLModel 0.0.48 requires timezone-aware datetimes; everything uses `models.utcnow()` (aware UTC).
- Seeded records are plaintext placeholders (`nonce IS NULL`, `key_version = 0`) until VLT-1/VLT-4 add AES-256-GCM envelope encryption. The seed is the demo reset (S6): `make seed` drops and reloads everything.

## FND-4 · Auth

- Server-side sessions in `auth_sessions`; the DB stores an HMAC of the token, never the token. Browser gets an HttpOnly SameSite=Lax cookie; curl/tests can send `Authorization: Bearer`.
- SameSite=Lax is the CSRF defence (cross-site POSTs carry no cookie). No CSRF token.
- Passwords use stdlib PBKDF2-SHA256 (no bcrypt/argon2 native wheels). Every demo account's password is `medvault-demo`.
- Demo one-click login (`/api/auth/demo-login`) only exists when `MEDVAULT_DEMO_MODE=true`; it is on for the hackathon, including the LinuxONE demo.
- Role guards are FastAPI dependencies: `require_roles(...)`, plus `require_staff_roles(...)` for separation of duties (a billing clerk is staff but not a physician).

## FND-5 · Frontend shell

- Resolves the open decision on the frozen colour: **frozen = amber** (temporary, under review), **revoked = red** (final), active = emerald, pending = sky. Use the `Badge` component everywhere.
- Vite 7 + React 19 + React Router 7 (data-less `BrowserRouter`) + Tailwind 4. No UI library; the kit is `frontend/src/components/ui.tsx`.
- Routes are split by role under `/patient`, `/hospital`, `/admin`; `RequireRole` redirects anonymous users to `/login` and wrong roles to `/forbidden`. The server enforces roles too; the client check is only for navigation.

## FND-6 · LinuxONE and the s390x smoke test

- No Node on the VM: the frontend is built on a laptop and `frontend/dist` is copied over with the repo; FastAPI serves it (`make run`). Only Python runs on s390x.
- `scripts/linuxone_setup.sh` uses the distro `python3-cryptography` (no s390x wheels upstream) through a `--system-site-packages` venv and installs everything else from the pins. Untested on real s390x until the LinuxONE owner runs it; record the outcome below.
- `make smoke` (`scripts/smoke.sh`) hits health, demo login, an authenticated call, logout and a deep SPA link, and prints one line. Paste every run here:
  - 2026-10-17 19:27 UTC · arm64 · Darwin · Python 3.13.12 · host Gaurangs-MacBook-Air.local · health ok · demo login ok (Maya Chen) · SPA served · 5 requests in 80 ms
  - (LinuxONE) _pending_

## Scope change · AI anomaly detector removed (Sat)

- The IsolationForest detector, its feature pipeline, labeled attack data and detector metrics are out (TICKETS.md: DET-1…6 replaced). Risk levels, freezes and alerts now come from fixed rules, **RUL-1**: revoked or missing grant → denied, HIGH; billing or records clerk opening a sensitivity-3 record → HIGH, grant frozen in the same request; off-hours (22:00–06:00) → MEDIUM, patient alerted; break-glass → at least MEDIUM.
- The in-vault record organizer is now the only AI component. **DATA-1** keeps the synthetic tagged records its evaluation needs. Confirm with mentors that this still meets the "real AI component" expectation.

## Frontend skeleton · Phase 2 screens on mock data

- Built from the patient mockup: P2–P5, P7–P13 on `/patient/*`, and H2–H6 on `/hospital/*`. Brand in the UI is **OneTrace** (`frontend/src/lib/brand.ts`); repo, API and docs still say MedVault.
- `frontend/src/lib/types.ts` is the API contract the VLT endpoints should return. Until they exist, `lib/data.ts` routes every call to `lib/mock.ts` (data mirrors `medvault/seed.py`, kept in localStorage so patient and hospital tabs share it). Build with `VITE_MOCK_API=false` to call the live endpoints instead. The "Mock data" pill disappears then. Delete `mock.ts` when every endpoint is live.
- Endpoints the screens need beyond the spec list: `GET /api/hospitals` (hospital picker), `GET /api/patient/records/{id}/content` and `GET /api/hospital/records/{id}/content` (decrypted bytes; the JSON route returns metadata), `GET /api/hospital/patient-lookup?q=` (H6, name + MRN only), and `?q=` on `GET /api/hospital/patients`. Broker denials should return `detail: {code, message}` with `code` in `access_frozen | access_revoked | no_grant`; the hospital UI picks H4/H5 from it.
- Alert decisions use the feature spec's `restore | keep_frozen | looks_fine | freeze`; `models.PatientDecision` has `keep_frozen | unfreeze | revoke`. Align them in VLT-10.
- Hospitals poll `GET /api/hospital/requests` every 3 s (resolves the VLT-5 open decision). Patient screens refresh on a small change bus (`lib/bus.ts`); VLT-9's SSE stream should call `emitChange()`.
- PDFs open in a new tab: the CSP (`default-src 'self'`) blocks `blob:` frames. Add `frame-src blob:` if inline PDF viewing is wanted.
- Icons: `lucide-react` 1.49.0 (pinned, bundled at build time, nothing extra on LinuxONE). Fonts are system stacks; the CSP allows no font CDN and the demo must work offline.
