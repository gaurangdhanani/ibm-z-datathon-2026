# OneTrace demo script

How to show that OneTrace works, step by step: setup, a 3-minute main run for the video, extra
demos for judges' questions, and what to do when something goes wrong. Every step lists what to
**do**, what you should **see**, and a line to **say**. All data is synthetic. Every demo
password is `onetrace-demo`.

Every outcome below was checked against a running server on Sat 2026-10-17: the insider freeze,
restore, emergency access, key swap, old hospital blocked, tamper and repair. The hospital tab
flipping to "Access paused" and "Your key no longer works" without a reload was checked in a
browser.

## 1. Before you start (10 minutes)

### 1.1 The server

Use the LinuxONE URL from `scripts/linuxone_https.sh`, for example `https://148-100-x-y.sslip.io`
(see LINUXONE.md). Open `https://<your-url>/api/health` and check it says `"machine":"s390x"`.
That page is the proof that the demo runs on IBM LinuxONE, so keep it open in a tab.

For both bars on the Dashboard, copy `reports/bench-s390x.json` into the repo first (LINUXONE.md
step 6), then re-run the `rsync` and `sudo systemctl restart onetrace`.

No LinuxONE? Run the app on the laptop instead. The phone must be on the same Wi-Fi.

```bash
make serve
```

```bash
ipconfig getifaddr en0
```

The phone then opens `http://<that-address>:8000`.

### 1.2 Devices and windows

A browser keeps one sign-in per site, so each person in the demo needs their own browser or
window.

| Where | Signed in as | Used for |
| --- | --- | --- |
| Phone | **Maya Chen** (patient) | Vault, Keys, History, Alerts |
| Laptop window A, normal Chrome window | **Demo Control** | attacker panel, tamper test, Dashboard |
| Laptop window B, Chrome incognito window | **Dr. Elena Vasquez** (Northside physician) | the hospital side |
| Laptop window C, Safari or Firefox (extra demos only) | **Dr. Amir Haddad** (Riverbend physician) | emergency access |

On the login page, click the person's name under Patients, Hospital staff or Demo control. To
switch people in a window, open the account menu (top right) and choose **Sign out**.

### 1.3 Reset and check the starting state

1. **Do:** Window A, **Reset demo**, then **Reset** in the dialog.
   **See:** every device stays signed in; the data goes back to the seed.
2. **Phone (Maya), Vault tab.**
   **See:** "Your vault · Encrypted", "Only you and Northside General Hospital hold keys.", **Key v1**. The Alerts tab shows a red **1** and an amber banner, "Late-night access to your records".
   **Optional:** for a clean start, open **Alerts** and tap **Looks fine** on that card.
3. **Window B (Elena), My patients.**
   **See:** Maya Chen and Daniel Okafor, both **● Active**. Click **Maya Chen** and leave her records page open.
4. **Window A (Demo Control).**
   **See:** four scenario cards. "Old hospital tries after the key swap" is greyed out, which is correct. The **Tamper test** card says **Chain intact**.

### 1.4 Time of day matters

The off-hours rule treats **10 PM to 6 AM Dallas time** (America/Chicago) as unusual. Inside that
window, every hospital read is flagged **Medium** with "Outside normal hours", and Maya gets an
extra alert for each one. The demo still works, but step 2 below shows "Allowed · Medium" instead
of "Allowed · Low".

**Recording at night?** Set `ONETRACE_TIMEZONE` in `.env` to a zone where it is daytime, for
example `ONETRACE_TIMEZONE=Asia/Kolkata` during the US night. Then restart the server: on the VM,
`sudo systemctl restart onetrace`. The nurse scenario still fires at 11:48 PM because it supplies
its own time.

## 2. The 3-minute run (the video)

Keep the phone visible, on camera or mirrored, next to the laptop. Times are a guide.

**Step 0 · 0:00 · Intro (laptop, health tab)**
- **Do:** show the `/api/health` tab, then switch to window B.
- **Say:** "OneTrace puts patients in control of their medical records. Records are encrypted, the patient holds the key, and hospitals only borrow it. This is running live on IBM LinuxONE."

**Step 1 · 0:15 · A hospital reads with the patient's key (window B, Elena)**
- **Do:** on Maya's records page, under **Knee · 2 records**, click **Knee MRI report**.
- **See:** the decrypted report ("MRI right knee without contrast…") in **Record viewer**. **Record details** lists the doctor, type, body part Knee, condition Orthopedics and sensitivity Standard. The strip at the top says **Access checked · Logged before display**.
- **Say:** "Dr. Vasquez can read this only because Maya gave Northside a key. The read is checked and logged before anything is shown."

**Step 2 · 0:35 · The patient sees every read (phone)**
- **Do:** open the **History** tab.
- **See:** the green **History verified** badge. At the top, under Today: **Dr. Elena Vasquez**, Physician · Northside General Hospital, "Opened Knee MRI report", **Allowed · Low**.
- **Say:** "Maya sees every access the moment it happens. The history is a hash chain, so nobody can quietly edit it."

**Step 3 · 0:55 · An insider snoops (window A, then the phone and window B)**
- **Do:** window A, on **Billing clerk opens a psychiatry note**, click **Fire**.
- **See, window A:** the result **Blocked and frozen · High**, with "Unrelated to the billing clerk role" and "Sensitive record (Psychiatry)".
- **See, window B, with no reload:** Elena's page turns into the amber **Access paused** panel: "Paused by the patient's security system. The patient may restore access."
- **See, phone:** the banner changes to **Unusual access frozen**. Open **Alerts**: "Jordan Price, billing clerk at Northside General Hospital, tried to open your Psychiatry follow-up note…", the same two reasons, and the buttons **Restore access** and **Keep frozen**.
- **Say:** "A billing clerk has no reason to read a psychiatry note. The access rules blocked the read and paused the whole hospital's key in the same request, and Maya was told instantly. The attempt never saw a byte of the note."

**Step 4 · 1:25 · The patient decides (phone)**
- **Do:** tap **Restore access**, then **Restore access** in the dialog.
- **See:** the card moves under **Earlier**: "You restored access". Window B returns to Maya's records by itself.
- **Say:** "Only the patient can lift the pause."

**Step 5 · 1:40 · The patient moves hospitals (phone)**
- **Do:** open **Keys**. On **Riverbend Medical Center requests access** ("Orthopaedic referral: second opinion on knee MRI"), tap **Approve**, then **Move my vault**.
- **See:** the old key breaks at Northside and a new one lands at Riverbend, then "Your vault moved to Riverbend Medical Center". Tap **Done**. **Current holder** is now Riverbend Medical Center, **Active**, key v2. Under **Previous holders**, Northside says **Moved away**.
- **See, window B, with no reload:** the red **Your key no longer works** panel, "The patient has revoked your hospital's access.", **AI risk: High**.
- **Say:** "Every record was re-encrypted with a new key for the new hospital. Northside's old key is now useless, even if someone copied it."

**Step 6 · 2:10 · Tamper-evident history (window A and phone)**
- **Do:** put the phone on **History**. In window A, scroll to **Tamper test** and click **Tamper with the log**.
- **See:** window A shows **Chain broken at entry #N**, with the original line struck out next to the forged "Viewed record list · allowed · low". Within a second the phone's badge turns red: **History tampered at entry #N**.
- **Do:** click **Repair**. **See:** both badges are green again.
- **Say:** "Even an insider with direct database access can't rewrite history without it showing up on the patient's phone."

**Step 7 · 2:35 · Proof on LinuxONE (window A)**
- **Do:** open **Dashboard**.
- **See:** the record organizer at 99.8 % mean field accuracy with 100 % recall on sensitive records over 120 synthetic records. Below that, one bar per machine for encryption, broker reads, key swap and chain verification, with **this server** on the LinuxONE bars.
- **Say:** "The in-vault AI organizer tags records before they are encrypted. The whole system runs on IBM LinuxONE, which accelerates the AES encryption at the core of every read."

**End · 3:00.** Before any re-take, window A, **Reset demo**.

## 3. Extra demos for judges' questions

Run **Reset demo** before each one, unless it says otherwise.

### 3.1 The insider's own screen (hospital side of step 3)

1. **Do:** window B, **Sign out**, then **Jordan Price** (billing clerk, Northside).
2. **Do:** My patients, **Maya Chen**, then expand **Other / Unknown · 3 records**.
   **See:** **Psychiatry follow-up note** with a red **Sensitive** pill.
3. **Do:** click it.
   **See:** no content at all. Instead: **Attempted record** (Psychiatry follow-up note, Sensitive), **Reason for block** with the reasons, the red strip "Patient alerted · Attempt logged as denied. No content displayed.", the **AI risk: High** and **Access paused** pills, and the **Access paused** panel.
4. **Phone:** the same alert as in step 3. Restore from **Alerts**; Jordan's window returns to the record list.

Jordan never sees an **Emergency access** button anywhere. Only physicians and nurses get one.

### 3.2 Emergency access ("break the glass")

Riverbend holds no key for Maya after a reset, which is exactly the situation in an ER.

1. **Do:** window C, **Dr. Amir Haddad**. On My patients, under **Request patient access**, search `Maya`, then pick **Maya Chen**.
   **See:** "Patient ID: MRN-100-2231 | No active grant", an amber **Emergency access** button, and "ER staff only. Use emergency access only for immediate patient care."
2. **Do:** click **Emergency access**. Type a reason, for example "Unconscious patient, car accident."
   **See:** "Minimum 10 characters (current: 34)." and the amber note "Access lasts 1 hour. The patient is notified instantly. Every read has at least MEDIUM risk." **Confirm emergency access** stays disabled until you tick **I confirm this is an emergency.**
3. **Do:** tick the box, then click **Confirm emergency access**.
   **See:** Maya's records open with **Emergency access · 59:59 remaining** counting down, **AI risk: Medium** and **Patient notified.**
4. **Phone:** the vault header adds "Emergency access: Riverbend Medical Center until today at …". **Alerts** shows the red **Emergency access active** card with Dr. Amir Haddad, the reason he typed and when it expires.
5. **Do:** on the phone, tap **End emergency access now**, then **End emergency access**.
   **See:** window C drops to **No key for this patient** with no reload.
- **Say:** "In an emergency a clinician can get in without waiting, but it lasts an hour, every read is flagged, and the patient can end it at any time."

### 3.3 Upload and the AI organizer

The two sample files are in `demo/`. AirDrop them to the phone first, or do this step as Maya in a
spare laptop window.

1. **Do:** phone, **Vault**, **Upload record**, **Choose file**, `knee-mri-followup.txt`, then **Upload**.
   **See:** it lands under **Knee**, tagged **Knee** and **Imaging**. Tap the **Doctor** chip and it sits under **Dr. Lina Park**.
2. **Do:** upload `therapy-session.txt` and open it.
   **See:** a **Sensitive** badge and the Psychiatry tag. The organizer found that on its own, so the access rules now protect this record like the psychiatry note.
3. **Optional:** rename any non-text file to `.pdf` and try to upload it.
   **See:** "Only PDF, JPG, PNG or TXT files can be uploaded." The server checks the file's actual bytes, not its name.
- **Say:** "Records are organized inside the vault, before encryption. No plaintext leaves for an outside AI service."

### 3.4 Late-night read (flagged, not blocked)

1. **Do:** window A, **Nurse reads a record at 11:48 PM**, **Fire**.
   **See:** **Allowed · Medium**.
2. **Phone:** a new card, "Unusual access to your records", with **Looks fine** and **Freeze access**. **Freeze access** asks for confirmation, then **Keys** shows Northside as **Frozen**. Restore it from the card.

### 3.5 The old hospital tries again

Do this after step 5 of the main run, without a reset in between.

- **Do:** window A, **Old hospital tries after the key swap**, **Fire**.
  **See:** **Denied · High**, "Access had been revoked". On the phone, **History**, **Denied** lists Dr. Elena Vasquez's attempts.

### 3.6 Live feed

- **Do:** window A, **Live feed**, then fire any scenario from **Demo control** in another tab.
  **See:** the new line appears at the top with a **New** badge, with no reload. **Everything** lists every logged action across all three patients.

### 3.7 Proof for technical judges

Run these on the laptop:

```bash
make test
```

```bash
cd frontend && npm test
```

Expect `38 passed` from the backend tests and `35 passed` from the frontend tests.

On the VM, run `make smoke`. It prints one line with `s390x`, health ok and demo login ok.

## 4. If something goes wrong

| Problem | Fix |
| --- | --- |
| Data is in a strange state | Window A, **Reset demo**. Nobody needs to sign in again. |
| A scenario's **Fire** is greyed out | Read the hint under it; usually **Reset demo** fixes it. |
| The phone didn't update | Switch tabs or reload the page; live updates reconnect on their own. |
| Wrong person in a window | Account menu, then **Sign out**, then pick the right person. |
| Two windows keep sharing a sign-in | They are the same browser profile. Use incognito or a different browser (section 1.2). |
| Extra "Outside normal hours" alerts | It is between 10 PM and 6 AM Dallas time (section 1.4). |
| The HTTPS URL doesn't load | `sudo journalctl -u caddy -n 50` on the VM, or fall back to the laptop (section 1.1). |
| Sign-in does nothing on `http://<ip>:8000` | After the HTTPS setup only the `https://` URL works. |
