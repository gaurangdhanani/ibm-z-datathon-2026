# OneTrace demo script (2 minutes, on IBM LinuxONE)

Everything runs on the LinuxONE VM (s390x). The phone and the laptop windows only point at it.
All data is synthetic. Every demo password is `onetrace-demo`.

## Setup (5 minutes before)

**1. The URL.** The Community Cloud blocks inbound ports except SSH, so the laptop opens a tunnel
to the VM and shares it with the phone over Wi-Fi. Leave this running in a terminal:

```bash
ssh -i ~/.ssh/onetrace.pem -N -L 0.0.0.0:8000:127.0.0.1:8000 linux1@148.100.98.88
```

- Laptop windows use `http://localhost:8000`.
- Phone, on the same Wi-Fi, uses `http://<laptop-ip>:8000` (laptop IP: `ipconfig getifaddr en0`).
- If the organizers opened port 8000, skip the tunnel and use `http://148.100.98.88:8000` everywhere.

Open `http://localhost:8000/api/health` in a laptop tab and keep it: it says `"machine": "s390x"`.

**2. Three sign-ins, one per browser** (a browser keeps one sign-in per site):

| Where | Signed in as |
| --- | --- |
| Phone | **Maya Chen** (patient) |
| Laptop, Chrome window A | **Demo Control** |
| Laptop, Chrome incognito window B | **Dr. Elena Vasquez** (Northside physician) |

**3. Starting state.** Window A, **Reset demo** → **Reset**. Window B: My patients → click **Maya Chen**,
leave her records page open. Phone: **Alerts** → **Looks fine** on the seeded late-night card, then
back to **Vault**. Window A back on **Demo control**.

Recording between 10 PM and 6 AM Dallas time? Reads show "Allowed · Medium" instead of "Low" (the
off-hours rule). Fine for the demo; or set `ONETRACE_TIMEZONE=Asia/Kolkata` in `.env` on the VM and
`sudo systemctl restart onetrace`.

## The run

**0:00 · Intro (laptop, health tab)**
Say: "OneTrace puts patients in control of their medical records. Records are encrypted, the patient
holds the key, hospitals only borrow it. This is running live on IBM LinuxONE." Point at `s390x`.

**0:10 · A hospital reads with the patient's key (window B)**
Do: under **Knee · 2 records**, click **Knee MRI report**.
See: the decrypted report in **Record viewer**, the details panel, and **Access checked · Logged before display**.
Say: "Dr. Vasquez can read this only because Maya gave Northside a key. Checked and logged before anything is shown."

**0:25 · The patient sees every read (phone)**
Do: open **History**.
See: **History verified**, and at the top: Dr. Elena Vasquez · Opened Knee MRI report · **Allowed · Low**.
Say: "Maya sees every access the moment it happens. The history is a hash chain; nobody can quietly edit it."

**0:40 · An insider snoops (window A, then both screens)**
Do: on **Billing clerk opens a psychiatry note**, click **Fire**.
See, window A: **Blocked and frozen · High**, "Unrelated to the billing clerk role", "Sensitive record (Psychiatry)".
See, window B, no reload: the amber **Access paused** panel.
See, phone: banner **Unusual access frozen**; open **Alerts**: the card with the same reasons, **Restore access** / **Keep frozen**.
Say: "A billing clerk has no reason to read a psychiatry note. The rules blocked the read and paused the whole hospital's key in the same request. The clerk never saw a byte. Maya was told instantly."

**1:10 · The patient decides (phone)**
Do: **Restore access** → **Restore access**.
See: window B returns to Maya's records on its own.
Say: "Only the patient can lift it."

**1:20 · The patient moves hospitals (phone, then window B)**
Do: **Keys** → on Riverbend's request, **Approve** → **Move my vault** → **Done**.
See, phone: the old key breaks, a new one lands; Current holder Riverbend, key v2; Northside "Moved away".
See, window B, no reload: **Your key no longer works**, "AI risk: High".
Say: "Every record was re-encrypted with a new key. Northside's old key is useless even if someone copied it."

**1:50 · Close (window A, Dashboard)**
Do: open **Dashboard**.
See: the organizer at 99.8 % field accuracy, 100 % sensitive-record recall; benchmark bars with **this server** on LinuxONE.
Say: "The in-vault AI organizer tags records before encryption; nothing leaves the vault. All of it runs on IBM LinuxONE, which accelerates the encryption behind every read."

**2:00 · End.** Before a re-take: window A, **Reset demo**.

## If a judge asks (30 seconds each, reset first)

- **Tamper-evident log:** phone on **History**; window A, **Tamper with the log** → phone badge turns red at the same entry; **Repair** → green.
- **Emergency access:** a third browser as **Dr. Amir Haddad**: search `Maya` under Request patient access → amber **Emergency access** → reason + tick → **Confirm**. Records open with a 59:59 countdown; phone shows the red emergency card and **End emergency access now** drops him out at once.
- **The insider's own screen:** window B as **Jordan Price** → Maya → **Psychiatry follow-up note**: no content, "Attempted record", "Reason for block", "Patient alerted · Attempt logged as denied."
- **Upload + organizer:** phone, **Upload record**, `demo/therapy-session.txt` → lands with a **Sensitive** badge; `demo/knee-mri-followup.txt` → under Knee / Dr. Lina Park.
- **Proof:** on the VM, `uname -m` → `s390x`; `make test` → 38 passed; laptop `cd frontend && npm test` → 35 passed.

## If something breaks

| Problem | Fix |
| --- | --- |
| Odd state | Window A, **Reset demo**; nobody signs in again |
| Phone can't load the page | Same Wi-Fi as the laptop? Tunnel still running? Try `http://localhost:8000` on the laptop first |
| A **Fire** button is grey | Read its hint; usually **Reset demo** |
| Wrong person in a window | Account menu → **Sign out** → pick the right one |
| App down on the VM | `sudo systemctl restart onetrace`, logs: `sudo journalctl -u onetrace -n 50` |
