# How to test MedVault

Steps for a laptop first, then LinuxONE. Every demo account's password is `medvault-demo`.

## 1. Set up (once)

```bash
make setup
```

Creates `.venv`, installs the pinned Python packages and runs `npm ci` in `frontend/`.

## 2. Automated checks

```bash
make test
```

```bash
make lint
```

```bash
cd frontend && npm run typecheck
```

Expected: `22 passed`, `All checks passed!`, and no TypeScript errors.

## 3. Manual click-through (dev mode)

```bash
make dev
```

Open http://localhost:5173.

1. **Demo login (P1).** Click **Maya Chen** under Patients. You land on **My vault**: the OneTrace header with her initials (MC) and four tabs at the bottom: Vault, Keys, History, Alerts.
2. **Role guard, client side.** Type http://localhost:5173/hospital in the address bar. You get **Not allowed**. Click **Back to my home** to return to My vault.
3. **Sign out.** Open the **Alerts** tab, tap the **MC** avatar, then **Sign out**. You are back on the login page. Visit http://localhost:5173/patient directly: it redirects to the login page.
4. **Staff login (H1).** In **Hospital staff sign-in** enter `elena.vasquez@northside.example` / `medvault-demo`. You land on **My patients** (not back on the patient's Alerts page) with "Physician · Northside General Hospital" in the header and two tabs.
5. **Wrong password.** Sign out, then try the same email with password `nope`. A red banner says "Invalid email or password".
6. **One-click staff.** Click **Jordan Price** (billing clerk, Hospital A) and **Dr. Amir Haddad** (Hospital B). Each lands on My patients with the right hospital in the header.
7. **Demo control.** Click **Demo Control**. You land on **Demo control**.
8. **Phone layout.** Shrink the window to phone width (or open the URL on a phone on the same Wi-Fi). Cards stack, nav wraps, nothing scrolls sideways.

## 3b. Phase 2 screens (live API)

Every patient and hospital screen talks to FastAPI. Start from a fresh seed (`make seed`) so Maya's vault is at Northside with Riverbend's request pending. Use phone width (or a phone) for the patient steps.

1. **Vault (P2, P4).** As Maya: the green card says "Only you and Northside General Hospital hold keys." and "Key v1". Tap the chips: **Body part** shows Knee (2 records) and Other / Unknown; **Doctor**, **Condition**, **Type** and **Date** regroup instantly.
2. **Upload (P3).** **Upload record** → choose a `.txt` file whose text mentions the knee → **Upload**. The record appears under **Knee** with tags (the organizer runs during the upload). A renamed binary file (for example a `.exe` renamed to `.pdf`) is rejected with "Only PDF, JPG, PNG or TXT files can be uploaded."
3. **View (P5).** Open **Knee MRI report**. The decrypted text shows with its tags and "Tagged inside your vault". **History** now lists "You · Opened Knee MRI report" and the badge says **History verified**.
4. **Key swap (P9, P10).** **Keys** → Riverbend's request → **Approve** → **Move my vault**. The old key breaks at Northside, a new one lands at Riverbend, then "Your vault moved to Riverbend Medical Center". The holder card shows Riverbend · Active · key v2; Northside is under Previous holders as "Moved away"; the request shows Approved.
5. **Old hospital blocked (H2, H5).** Sign in as **Dr. Elena Vasquez**. Maya is no longer in **My patients**. Open http://localhost:5173/hospital/patients/1/records/1: the red **Access revoked** panel. Back as Maya, **History → Denied** shows "Dr. Elena Vasquez · Tried to view record list · access revoked".
6. **New hospital in (H3).** Sign in as **Dr. Amir Haddad**. Maya is listed with key status Active; **Open records** → **Psychiatry follow-up note** decrypts in the right-hand panel with a **Sensitive** badge. Maya's History shows "Dr. Amir Haddad · Opened Psychiatry follow-up note".
7. **Request access (H6).** As Dr. Haddad, **Access requests** → search "Daniel" → pick him → a reason of at least 10 characters → **Request access**. The request shows **Pending**. As **Daniel Okafor**, **Keys** shows it; **Deny**, and Riverbend's list flips to **Denied** within a few seconds.
8. **Tamper check (S3 preview).** With the server running: `sqlite3 data/medvault.db "update access_log set summary='nothing' where id=3"`. Maya's **History** badge turns red: "History tampered at entry #3". `make seed` restores a clean chain.

**Access frozen** (H4) and patient alert decisions (P12) arrive with RUL-1 and VLT-10 in Phase 3.

## 4. API checks with curl (server-side guards)

With `make dev` still running:

```bash
curl -s http://127.0.0.1:8000/api/health
```

Expected: `"status":"ok"`, `"db_ok":true`, and `platform.machine` for this computer.

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"persona":"patient"}' http://127.0.0.1:8000/api/auth/demo-login
```

Copy the `token` value, then:

```bash
curl -s -H "Authorization: Bearer PASTE_TOKEN" http://127.0.0.1:8000/api/auth/me
```

Expected: Maya's user JSON. Without the header the same URL returns `401`. Interactive docs: http://127.0.0.1:8000/api/docs.

## 5. Production mode on the laptop (what LinuxONE runs)

```bash
make serve
```

Builds `frontend/dist`, then FastAPI alone serves app and API on http://127.0.0.1:8000. Check that http://127.0.0.1:8000/patient/alerts (a deep link) loads the app, then in another terminal:

```bash
make smoke
```

Expected: one line like `- 2026-10-17 20:00 UTC · arm64 · Darwin · Python 3.13.12 · host … · health ok · demo login ok (Maya Chen) · SPA served · 5 requests in 60 ms`. Paste it into `DECISIONS.md` under FND-6.

## 6. LinuxONE (FND-6, s390x)

Node is not installed on the VM; build the frontend here and copy it over.

1. On the laptop: `make build`, then copy the repo without the heavy folders:

   ```bash
   rsync -a --exclude .venv --exclude node_modules --exclude data --exclude .git ./ USER@LINUXONE_HOST:~/ibm-z/
   ```

2. On the VM, from `~/ibm-z`: `scripts/linuxone_setup.sh` (apt packages, venv, pinned deps, runs the tests). Takes a few minutes.
3. Start the server: `make run`. In a second SSH session: `make smoke`. The line must say `s390x`.
4. From a phone or laptop on a network that reaches the VM, open `http://LINUXONE_HOST:8000` and repeat step 3.1 and 3.4.
5. Paste the smoke line into `DECISIONS.md` under FND-6 and tick FND-6 in `TICKETS.md`.

If `linuxone_setup.sh` fails on `cryptography`, run `sudo apt-get install python3-cryptography` and re-run the script; it skips the pip build on s390x on purpose.

## 7. Reset the demo data

```bash
make seed
```

Drops and reloads every table (hospitals, 8 users, 3 patients, 9 encrypted and tagged records, grants, one pending access request, a valid access-log chain). Sessions are wiped too, so everyone has to sign in again. Also required after changing `MEDVAULT_SECRET_KEY`: the record keys are wrapped under a key derived from it.
