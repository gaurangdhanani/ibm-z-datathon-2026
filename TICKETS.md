# OneTrace tickets

One line per ticket, grouped by build phase. Times are CDT. Do the phases in order; NICE and stretch items wait until every MUST works end to end.

Owners: Eng 1 = backend · Eng 2 = AI + frontend · the rest are the non-engineer roles in MEDVAULT_PROJECT.md §5.2. IDs P1–P15, H1–H9 and S1–S6 match the feature spec.

## Phase 1 · Skeleton & risk check (due Sat 13:00 CDT)

**Done when:** login works on a laptop; the s390x smoke test ran on LinuxONE and is recorded in DECISIONS.md.

- [x] **FND-1** Repo scaffold, pinned dependencies and Makefile · Eng 1
- [x] **FND-2** FastAPI app skeleton: config, health check, SPA serving, security middleware · Eng 1 · needs FND-1
- [x] **FND-3** SQLite data model (SQLModel) and demo seed · Eng 1 · needs FND-1
- [x] **FND-4** Auth: demo login, session tokens, server-side role guards · Eng 1 · needs FND-2, FND-3
- [x] **FND-5** Frontend shell: React + Vite + Tailwind, role-based routes, shared UI kit · Eng 2 · needs FND-2, FND-4
- [ ] **FND-6** LinuxONE VM setup and s390x smoke test · LinuxONE owner · needs FND-1
- [x] **P1** Demo login · Eng 2 · needs FND-4, FND-5
- [x] **H1** Staff login · Eng 2 · needs FND-4, FND-5
- [ ] **PIT-1** Confirm open items with organizers (today) · Pitch lead

## Phase 2 · Vault, crypto, broker, key swap (due Sat 18:00 CDT)

**Done when:** patient → Hospital A → transfer to Hospital B works in the UI, and Hospital A's later attempt is denied and logged.

- [x] **VLT-1** KMS module and envelope encryption (AES-256-GCM) · Eng 1 · needs FND-3
- [x] **VLT-2** Hash-chained access log and GET /api/audit/verify · Eng 1 · needs FND-3
- [x] **VLT-3** Access broker: the single read path · Eng 1 · needs VLT-1, VLT-2
- [x] **VLT-4** Record upload and patient vault/record endpoints · Eng 1 · needs VLT-3
- [x] **VLT-5** Grants and access requests · Eng 1 · needs VLT-1, VLT-2
- [x] **VLT-6** Key swap: atomic transfer with DEK rotation · Eng 1 · needs VLT-1, VLT-5
- [x] **VLT-8** Hospital endpoints: patients list, record read, patient lookup · Eng 1 · needs VLT-3, VLT-5
- [x] **P2** My vault (home) · Eng 2 · needs VLT-4, VLT-5, P1
- [x] **P3** Upload record · Eng 2 · needs VLT-4, P2, ORG-2
- [x] **P5** View record · Eng 2 · needs VLT-4, P2
- [x] **P7** Who has my key · Eng 2 · needs VLT-5, VLT-6
- [x] **P8** Grant access · Eng 2 · needs VLT-5, P7
- [x] **P9** Approve or deny hospital requests · Eng 2 · needs VLT-5, VLT-6, P10
- [x] **P10** Move hospitals: key swap with animation · Eng 2 · needs VLT-6, P7
- [x] **H2** My patients · Eng 2 · needs VLT-8, H1
- [x] **H3** Patient record view · Eng 2 · needs VLT-8, H2, ORG-4
- [x] **H5** "Access revoked" screen · Eng 2 · needs VLT-6, VLT-3, H3
- [x] **H6** Request access · Eng 2 · needs VLT-5, VLT-8, H2

Every P2–P10 and H2–H6 screen runs against the live endpoints (verified Sat, see DECISIONS.md "Phase 2"). `VITE_MOCK_API=true` still builds the browser-side mock for offline UI work.

## Phase 3 · Access rules, alerts & live updates (due Sat 23:00 CDT)

**Done when:** a billing clerk opening a sensitive record freezes the grant within one request and the patient sees the alert. H13 CHECKPOINT at 23:00: the full demo works end to end on a laptop, or cut features until it does.

- [x] **VLT-7** Break-glass emergency access (backend) · Eng 1 · needs VLT-5, RUL-1
- [x] **VLT-9** Realtime event bus and SSE streams · Eng 1 · needs VLT-2
- [x] **VLT-10** Patient access log and alert decision endpoints · Eng 1 · needs VLT-2, RUL-1
- [x] **RUL-1** Rule-based access checks: freeze on HIGH, alert on MEDIUM, plain-language reasons (replaces the AI detector) · Eng 1 · needs VLT-3
- [x] **DATA-1** Synthetic records with note text and ground-truth tags (for the tagging evaluation) · Eng 2 · needs FND-3, ORG-1
- [x] **ORG-1** Content: medical note templates and vocab word lists · Content lead
- [x] **P11** Access history · Eng 2 · needs VLT-10, VLT-2, VLT-9
- [x] **P12** Alerts: banner, tab and patient decisions · Eng 2 · needs VLT-9, VLT-10, RUL-1
- [x] **P13** Emergency access notice · Eng 2 · needs VLT-7, VLT-9
- [x] **H4** "Access frozen" screen · Eng 2 · needs RUL-1, VLT-3, H3
- [x] **H7** Break-glass emergency access · Eng 2 · needs VLT-7, H3
- [x] **S5** Attacker panel (demo only): fires the rule-based scenarios · Eng 2 + Eng 1 · needs RUL-1, VLT-3, VLT-6, VLT-7

Phase 3 verified Sat on a laptop (see DECISIONS.md "Phase 3"): the billing-clerk read freezes the key in one request, Maya's phone shows the alert over the event stream without a reload, and every Phase 3 screen runs on the live endpoints. The browser-side mock is gone.

## Phase 3.5 · AI record organizer (due Sun 02:00 CDT)

**Done when:** a new knee MRI note shows correct tags within seconds under 'Knee', and a billing clerk opening a psychiatry-tagged record is flagged HIGH. If the H13 checkpoint failed, skip this phase and use pre-filled synthetic tags.

- [x] **ORG-2** Text extraction and keyword tagger · Eng 2 · needs ORG-1
- [x] **ORG-3** Encrypted tag storage, re-encryption on key swap, access-rule wiring · Eng 2 · needs ORG-2, VLT-4, VLT-6
- [x] **ORG-4** Group-by API for patients and hospitals · Eng 2 · needs ORG-3, VLT-8
- [x] **ORG-5** Tagging evaluation: reports/eval.json · Eng 2 · needs ORG-2, DATA-1
- [x] **P4** Group-by views · Eng 2 · needs ORG-4, P2

Phase 3.5 verified Sat night: a new knee MRI note is tagged and listed under Knee in the same upload request, and a billing clerk opening a psychiatry-tagged record (seeded or freshly uploaded) is flagged HIGH. `reports/eval.json` scores the tagger on the DATA-1 set.

## Phase 4 · Dashboard, polish, LinuxONE (due Sun 05:00 CDT)

**Done when:** benchmark JSON exists for laptop and LinuxONE, and the app is reachable from a phone at the LinuxONE URL.

- [ ] **FND-7** Benchmark script: laptop vs LinuxONE (encryption, key swap, read latency) · LinuxONE owner + Eng 1 · needs VLT-1, VLT-3, VLT-6
- [ ] **FND-8** Serve the live demo from LinuxONE over HTTPS · LinuxONE owner · needs FND-6, VLT-9
- [x] **S1** Live alert feed · Eng 2 · needs VLT-9, RUL-1, FND-5
- [x] **S2** Tagging metrics dashboard (organizer accuracy, sensitive-record recall) · Eng 2 · needs ORG-5
- [x] **S3** Tamper test · Eng 2 + Eng 1 · needs VLT-2
- [x] **S4** LinuxONE benchmark panel · Eng 2 · needs FND-7

Phase 4 built Sat night (see DECISIONS.md "Phase 4"): Demo Control has **Live feed** and **Dashboard** tabs and a **Tamper test** card; `make bench` wrote `reports/bench-arm64.json` (laptop). Still waiting for the VM: the s390x run (`reports/bench-s390x.json`, finishes FND-7) and the HTTPS deployment (`scripts/linuxone_https.sh`, FND-8). The first-time walkthrough is LINUXONE.md.

## Phase 5 · Hardening & rehearsal (due Sun 08:00 CDT)

**Done when:** video recorded, tests green on laptop and LinuxONE, fresh-clone test passes.

- [x] **S6** Demo reset · Eng 1 · needs FND-3 _(landed with S5: the attacker panel needs it between runs)_
- [ ] **QA-1** Authorization matrix and separation-of-duties tests · Eng 1 · needs FND-4, VLT-8, ORG-4
- [ ] **QA-2** Cross-surface flow tests (tests/test_flows.py) · Eng 1 + Eng 2 · needs P10, H7, S3, S5, S6, ORG-3
- [x] **QA-3** DEMO_SCRIPT.md: click-through checklist and device setup · Demo lead · needs QA-2 _(flows checked against a live server; QA-2's automated flow tests are still open)_
- [ ] **QA-4** QA pass on real phones and permission breaking · QA · needs FND-8
- [ ] **QA-5** Fresh-clone test on laptop and LinuxONE · QA + LinuxONE owner · needs QA-6
- [ ] **QA-6** README, DECISIONS.md and final feature report · Eng 1 + Pitch lead
- [ ] **PIT-2** 7-slide pitch deck · Pitch lead · needs ORG-5, FND-7
- [ ] **PIT-3** Project description and judge Q&A sheet · Pitch lead · needs ORG-5
- [ ] **PIT-4** Record the multi-device demo video (≤3 min) and a backup screen recording · Demo lead · needs QA-3, FND-8

## Submission (due Sun 08:30 CDT)

**Done when:** Submit on Hack2Skill by Sun 08:30 CDT. Internal hard deadline 09:30. Official close listed as 11:30 (confirm).

- [ ] **PIT-5** Submit on Hack2Skill · Pitch lead · needs PIT-2, PIT-3, PIT-4, QA-6

## Nice-to-have & stretch (due after every MUST works)

**Done when:** Only after every MUST item works end to end (feature-spec rule). Record skipped items in the final report.

- [ ] **P6** Edit AI tags _(NICE)_ · Eng 2 · needs P5, ORG-3
- [ ] **P14** Search records _(NICE)_ · Eng 2 · needs ORG-3, P2
- [ ] **P15** Weekly access summary _(NICE)_ · Eng 2 · needs VLT-10
- [ ] **H8** Add record to a patient's vault _(NICE)_ · Eng 2 + Eng 1 · needs H3, ORG-3
- [ ] **H9** Hospital internal audit _(NICE)_ · Eng 2 + Eng 1 · needs VLT-2
- [ ] **STR-1** Granite: local tagger and alert text (USE_GRANITE) _(STRETCH)_ · Eng 2 · needs ORG-2, RUL-1
- [ ] **STR-2** Honeytoken decoy records _(STRETCH)_ · Eng 2 · needs RUL-1

## Open decisions (record each in DECISIONS.md)

- AI anomaly detector removed (IsolationForest, feature pipeline, attack data, detector metrics). Risk levels and alerts now come from fixed rules (RUL-1), and the record organizer is the only AI (ORG-2, scored in reports/eval.json). Check this still meets the datathon's "real AI component" expectation
- Frozen colour: the design rules say red, but P2 and H4 say amber (FND-5)
- How the hospital sees request status live: polling or a new stream; the spec lists no endpoint (VLT-5)
- New tables not in the data model: access_requests, emergency grants, care_episodes (FND-3)
- Endpoints the spec needs but doesn't list: patient lookup (H6), search (P14), weekly summary (P15), hospital audit (H9)
- ~~Demo-only clock override so the off-hours rule can fire in a daytime demo (S5)~~ resolved: the scenario passes the rules an explicit time; there is no global clock override (DECISIONS.md, Phase 3)
- The repo is private; make it public before submitting (PIT-5)
