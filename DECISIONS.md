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

## Phase 2 · Vault, crypto, broker, key swap (Sat)

- **VLT-1 KMS (`medvault/kms.py`)**: three AES-256-GCM layers. Master key = HKDF of `MEDVAULT_SECRET_KEY`, never stored (change the secret → `make seed`). One random KEK per vault, wrapped by the master key in `vaults.wrapped_kek`; one random DEK per record, wrapped by the KEK in `records.wrapped_dek`. GCM additional data binds every blob to its row and key version. No key file, no HSM.
- **VLT-2 audit (`audit.py`)**: `entry_hash = SHA-256(prev_hash ‖ canonical JSON of the row)`. `GET /api/audit/verify` recomputes the chain and returns `{valid, entries, first_broken_entry}`; it is not itself logged, so the History page does not spam the chain. A process-wide write lock (`audit.get_write_session`) serialises every route that may append, so concurrent writers cannot fork the chain. New columns: `access_log.summary` (plain language) and `reasons_json` (the `[{kind, text}]` list the UI shows).
- **VLT-3 broker (`broker.py`)**: the only code that decrypts. A hospital reads when its latest grant is `active` **and** `grant.key_version == vault.key_version`; anything else is logged (`denied`, risk `high`) and answered `403 {"detail": {"code", "message"}}` with `no_grant | access_frozen | access_revoked`. Metadata GETs log only denials; the `/content` GET logs the open, so one UI read is one log line.
- **VLT-4 records (`patient.py`)**: multipart upload (`file`, optional `title`), type decided by magic bytes (PDF, PNG, JPEG, UTF-8 text; else 415 `invalid_file_type`; 413 over `MEDVAULT_MAX_BODY_MB`), encrypted before insert. New column `records.sensitivity` (1–3; the seeded psychiatry note and sertraline prescription are 3 for RUL-1). Tags come from `organizer.tag_text`, a keyword tagger ported from the frontend mock, and are stored encrypted under the record DEK (`encrypted_tags`). ORG-2 replaces the tagger's internals; ORG-3's encrypted storage and re-encryption on key swap are therefore already done; `organizer.group_records` serves `?by=` for patients and hospitals (ORG-4's shape, needed by P2 now).
- **VLT-5 grants and requests**: a vault has at most one holder (`active` or `frozen`); `POST /api/patient/grant` answers 409 `already_granted` when one exists. Approving a request gives the key when nobody holds it, otherwise it is a key swap. Hospitals request with a reason of 10+ characters; 409 `duplicate_request` / `already_granted`. Hospitals keep polling `GET /api/hospital/requests`.
- **VLT-6 key swap**: `POST /api/patient/transfer` is one SQLite transaction: new KEK (version + 1), every record re-encrypted under a fresh DEK, old grant → `transferred`, new grant on the new version, the new hospital's pending request → `approved`, open alerts on the old grant → `resolved`. The old hospital's "key" is its grant row; after the swap its version no longer matches, so the broker answers `access_revoked`. FND-7 times this on s390x.
- **VLT-8 hospital endpoints (`hospital.py`)**: `patients` lists active and frozen grants (frozen patients stay visible, amber); `patient-lookup` returns name + MRN only, 2+ characters, 5 results, not logged to the patient. "Viewed record list" is logged once per staff member per patient per 10 minutes so switching chips does not flood the history.
- Live ahead of Phase 3 because the screens already call them: `GET /api/patient/access-log?filter=` and `GET /api/patient/alerts` (read-only). VLT-10 only adds the decision endpoints; VLT-7 fills `emergency`.
- **Frontend**: the live API is the default; `VITE_MOCK_API=true` builds the browser-side mock. `mock.ts` stays until the Phase 3 endpoints exist (alert decisions, emergency), then delete it. The "Mock data" pill shows only in mock builds.
- Schema changed (`records.sensitivity`, `access_log.summary` / `reasons_json`, wrapped keys): run `make seed` on any existing `data/medvault.db`.

## Phase 3 · Access rules, alerts, live updates (Sat)

- **RUL-1 rules (`rules.py`)**: `assess(user, record, tags, emergency, at)` returns risk, plain-language reasons and `freeze`. Billing or records clerk on a sensitivity-3 record → HIGH, the grant is frozen inside the same broker call (`broker.open_record`) and the read is logged with outcome `frozen`, deny reason "blocked by your access rules". Off hours (22:00–06:00 in `MEDVAULT_TIMEZONE`, default America/Chicago) → MEDIUM. Break-glass → MEDIUM. Revoked or missing grants are denied by the broker before the rules run. MEDIUM alerts are deduplicated while one with the same title is open, so a nurse paging through records at night raises one card, not ten.
- **Demo clock (resolves the open decision)**: no global override. The attacker panel passes an explicit `at` to the rules for the off-hours scenario; the log entry keeps the real timestamp, the reason text shows the replayed time ("Outside normal hours (11:48 PM)").
- **VLT-9 events (`events.py`)**: in-process bus, one `asyncio.Queue` per open stream, `publish` is thread-safe. `GET /api/patient/events` and `GET /api/hospital/events` are Server-Sent Events (`event: change`, 15 s heartbeat comments). The frontend opens one EventSource per shell (`lib/live.ts`) and refetches whatever is on screen (`lib/bus.ts`). Scoping rule: log lines and alerts go to the patient's stream only; a hospital's stream only hears about changes to its access (freeze, restore, key swap, request decisions, emergency start/end, reset). A denied refetch is itself logged, so notifying the denied hospital would loop forever (it did, once). The requests page keeps its 3 s poll as well.
- **VLT-7 break-glass**: `POST /api/hospital/emergency {patient_id, justification ≥ 10 chars}`, physicians and nurses only (`require_staff_roles`), 60 min (`MEDVAULT_EMERGENCY_TTL_MINUTES`), idempotent while live. Logged as `emergency_access` with the justification, MEDIUM alert "Emergency access to your records", patient sees it in the vault header, Keys and Alerts (P13) and can end it (`POST /api/patient/emergency/{id}/end`). A key swap also ends the old hospital's emergency grants. A patient's freeze cannot be broken through: break-glass answers 409 `access_frozen` while the hospital's grant is frozen.
- **VLT-10 alert decisions (resolves the enum mismatch)**: `models.PatientDecision` now matches the feature spec: `restore | keep_frozen` on HIGH, `looks_fine | freeze` on MEDIUM (`POST /api/patient/alerts/{id}/decision`). `restore` unfreezes, `freeze` freezes the grant and ends that hospital's emergency access, every decision is a log line. Alert reasons come from the linked log entry (`alerts.access_log_id`), no new column.
- **Seed**: Maya starts with one open MEDIUM alert (Sam Lee viewed her record list at 23:48 yesterday) so the Alerts tab and banner have something to show at first login. Schema and seed changed: run `make seed`.
- **S5 attacker panel + S6 reset (`admin.py`)**: `GET/POST /api/admin/scenarios[/{id}]` fire a real read through the broker as the persona (billing clerk on the psychiatry note, nurse at 23:48, old hospital after the swap, ER doctor breaking the glass) and report what the log says; `ready`/`hint` tell the presenter when the demo state cannot produce the expected outcome. `POST /api/admin/reset` reloads the seed and keeps `auth_sessions` (user ids are stable), so no phone has to sign in again. S6 therefore landed early.
- **Frontend**: P11, P12, P13 and H4 were already built against these shapes; H7 adds `BreakGlass.tsx` (button on the "No key" / "Access revoked" panels and under the request form, clinicians only), S5 is `pages/admin/DemoControlPage.tsx`. A blocked record read drops the record id from the URL so a later restore does not silently re-open it (the clerk re-froze the key that way during testing). `lib/mock.ts` and the "Mock data" pill are deleted: every endpoint is live.

## Phase 3.5 · AI record organizer (Sat night)

- **ORG-1 content (`vocab.py`)**: pure data for the content lead: body parts with their specialty, stand-alone conditions with a sensitivity level (3 = psychiatry, sexual health, genetics, substance use, reproductive health; 2 = oncology; 1 = the rest), record types, doctor names and 40 note templates.
- **ORG-2 tagger (`organizer.py`)**: `extract_text` reads TXT directly and pulls text operands out of simple PDFs (uncompressed or Flate streams, stdlib `zlib`); images get no OCR, only the title. `tag_text` scores every vocabulary entry by hit count (the title line counts double, stems of 4 characters or fewer must end the word so "stiffness" is not an STI), picks the best body part and condition, drops a body part that is only a passing mention, and sets sensitivity to the highest level of any stand-alone condition that appears (ties go to safety). In a tie a specific type beats the generic "Visit note". Doctor and date come from regexes with a lower-case fallback.
- **ORG-3**: was already done by VLT-4/VLT-6 (tags encrypted under the record DEK, re-encrypted on key swap); the rule wiring is `Record.sensitivity`, set from the tags at upload, plus the condition shown in the reason text ("Sensitive record (Psychiatry)"), decrypted inside the broker.
- **ORG-4**: `?by=` group-by on `/api/patient/records/groups` and `/api/hospital/patients/{id}/groups` (unchanged shape, 422 on an unknown key).
- **DATA-1 + ORG-5 (`organizer_eval.py`)**: `python -m medvault.organizer_eval` (or `make eval`) writes `reports/synthetic_records.json` (120 records from the templates, deterministic seed, with prefix lines, trailing unrelated sentences and 20 % lower-cased notes as noise) and `reports/eval.json` (per-field accuracy, sensitive-record recall and precision, the misses). Current score: mean field accuracy 0.998, sensitive recall 1.0, precision 1.0; the test suite fails if recall drops below 0.95 or the committed report drifts from the code.
