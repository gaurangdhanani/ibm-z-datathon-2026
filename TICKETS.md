# MedVault tickets

One line per ticket, grouped by build phase. Times are CDT. Do the phases in order; NICE and stretch items wait until every MUST works end to end.

Owners: Eng 1 = backend · Eng 2 = AI + frontend · the rest are the non-engineer roles in MEDVAULT_PROJECT.md §5.2. IDs P1–P15, H1–H9 and S1–S6 match the feature spec.

## Phase 1 · Skeleton & risk check (due Sat 13:00 CDT)

**Done when:** login works on a laptop; the s390x smoke test ran on LinuxONE and is recorded in DECISIONS.md.

- [ ] **FND-1** Repo scaffold, pinned dependencies and Makefile · Eng 1
- [ ] **FND-2** FastAPI app skeleton: config, health check, SPA serving, security middleware · Eng 1 · needs FND-1
- [ ] **FND-3** SQLite data model (SQLModel) and demo seed · Eng 1 · needs FND-1
- [ ] **FND-4** Auth: demo login, session tokens, server-side role guards · Eng 1 · needs FND-2, FND-3
- [ ] **FND-5** Frontend shell: React + Vite + Tailwind, role-based routes, shared UI kit · Eng 2 · needs FND-2, FND-4
- [ ] **FND-6** LinuxONE VM setup and s390x smoke test · LinuxONE owner · needs FND-1
- [ ] **P1** Demo login · Eng 2 · needs FND-4, FND-5
- [ ] **H1** Staff login · Eng 2 · needs FND-4, FND-5
- [ ] **PIT-1** Confirm open items with organizers (today) · Pitch lead

## Phase 2 · Vault, crypto, broker, key swap (due Sat 18:00 CDT)

**Done when:** patient → Hospital A → transfer to Hospital B works in the UI, and Hospital A's later attempt is denied and logged.

- [ ] **VLT-1** KMS module and envelope encryption (AES-256-GCM) · Eng 1 · needs FND-3
- [ ] **VLT-2** Hash-chained access log and GET /api/audit/verify · Eng 1 · needs FND-3
- [ ] **VLT-3** Access broker: the single read path · Eng 1 · needs VLT-1, VLT-2
- [ ] **VLT-4** Record upload and patient vault/record endpoints · Eng 1 · needs VLT-3
- [ ] **VLT-5** Grants and access requests · Eng 1 · needs VLT-1, VLT-2
- [ ] **VLT-6** Key swap: atomic transfer with DEK rotation · Eng 1 · needs VLT-1, VLT-5
- [ ] **VLT-8** Hospital endpoints: patients list, record read, patient lookup · Eng 1 · needs VLT-3, VLT-5
- [ ] **P2** My vault (home) · Eng 2 · needs VLT-4, VLT-5, P1
- [ ] **P3** Upload record · Eng 2 · needs VLT-4, P2, ORG-2
- [ ] **P5** View record · Eng 2 · needs VLT-4, P2
- [ ] **P7** Who has my key · Eng 2 · needs VLT-5, VLT-6
- [ ] **P8** Grant access · Eng 2 · needs VLT-5, P7
- [ ] **P9** Approve or deny hospital requests · Eng 2 · needs VLT-5, VLT-6, P10
- [ ] **P10** Move hospitals: key swap with animation · Eng 2 · needs VLT-6, P7
- [ ] **H2** My patients · Eng 2 · needs VLT-8, H1
- [ ] **H3** Patient record view · Eng 2 · needs VLT-8, H2, ORG-4
- [ ] **H5** "Access revoked" screen · Eng 2 · needs VLT-6, VLT-3, H3
- [ ] **H6** Request access · Eng 2 · needs VLT-5, VLT-8, H2

## Phase 3 · Data & anomaly detector (due Sat 23:00 CDT)

**Done when:** firing the bulk-scraping scenario freezes the grant within one request and the patient sees the alert. H13 CHECKPOINT at 23:00: the full demo works end to end on a laptop, or cut features until it does.

- [ ] **VLT-7** Break-glass emergency access (backend) · Eng 1 · needs VLT-5, DET-5
- [ ] **VLT-9** Realtime event bus and SSE streams · Eng 1 · needs VLT-2
- [ ] **VLT-10** Patient access log and alert decision endpoints · Eng 1 · needs VLT-2, DET-5
- [ ] **DET-1** Synthetic data generator: population, notes, access events, labeled attacks · Eng 2 · needs FND-3, ORG-1
- [ ] **DET-2** Leakage-safe feature pipeline · Eng 2 · needs DET-1
- [ ] **DET-3** Rules layer with plain-language reasons · Eng 2 · needs DET-2
- [ ] **DET-4** ML layer: IsolationForest with calibration and numpy fallback · Eng 2 · needs DET-2
- [ ] **DET-5** Hybrid engine: risk levels, explanations, freeze/alert actions, inline scoring · Eng 2 + Eng 1 · needs DET-3, DET-4, VLT-3
- [ ] **DET-6** Evaluation report: reports/eval.json · Eng 2 · needs DET-5
- [ ] **ORG-1** Content: medical note templates and vocab word lists · Content lead
- [ ] **P11** Access history · Eng 2 · needs VLT-10, VLT-2, VLT-9
- [ ] **P12** Alerts: banner, tab and patient decisions · Eng 2 · needs VLT-9, VLT-10, DET-5
- [ ] **P13** Emergency access notice · Eng 2 · needs VLT-7, VLT-9
- [ ] **H4** "Access frozen" screen · Eng 2 · needs DET-5, VLT-3, H3
- [ ] **H7** Break-glass emergency access · Eng 2 · needs VLT-7, H3
- [ ] **S5** Attacker panel (demo only) · Eng 2 + Eng 1 · needs DET-5, VLT-3, VLT-6, VLT-7

## Phase 3.5 · AI record organizer (due Sun 02:00 CDT)

**Done when:** a new knee MRI note shows correct tags within seconds under 'Knee', and a billing clerk opening a psychiatry-tagged record is flagged HIGH. If the H13 checkpoint failed, skip this phase and use pre-filled synthetic tags.

- [ ] **ORG-2** Text extraction and keyword tagger · Eng 2 · needs ORG-1
- [ ] **ORG-3** Encrypted tag storage, re-encryption on key swap, detector wiring · Eng 2 · needs ORG-2, VLT-4, VLT-6
- [ ] **ORG-4** Group-by API for patients and hospitals · Eng 2 · needs ORG-3, VLT-8
- [ ] **ORG-5** Tagging evaluation · Eng 2 · needs ORG-2, DET-1, DET-6
- [ ] **P4** Group-by views · Eng 2 · needs ORG-4, P2

## Phase 4 · Dashboard, polish, LinuxONE (due Sun 05:00 CDT)

**Done when:** benchmark JSON exists for laptop and LinuxONE, and the app is reachable from a phone at the LinuxONE URL.

- [ ] **FND-7** Benchmark script: laptop vs LinuxONE · LinuxONE owner + Eng 1 · needs VLT-1, VLT-3, VLT-6, DET-5
- [ ] **FND-8** Serve the live demo from LinuxONE over HTTPS · LinuxONE owner · needs FND-6, VLT-9
- [ ] **S1** Live alert feed · Eng 2 · needs VLT-9, DET-5, FND-5
- [ ] **S2** Detector metrics dashboard · Eng 2 · needs DET-6, ORG-5
- [ ] **S3** Tamper test · Eng 2 + Eng 1 · needs VLT-2
- [ ] **S4** LinuxONE benchmark panel · Eng 2 · needs FND-7

## Phase 5 · Hardening & rehearsal (due Sun 08:00 CDT)

**Done when:** video recorded, tests green on laptop and LinuxONE, fresh-clone test passes.

- [ ] **S6** Demo reset · Eng 1 · needs DET-1, FND-3
- [ ] **QA-1** Authorization matrix and separation-of-duties tests · Eng 1 · needs FND-4, VLT-8, ORG-4
- [ ] **QA-2** Cross-surface flow tests (tests/test_flows.py) · Eng 1 + Eng 2 · needs P10, H7, S3, S5, S6, ORG-3
- [ ] **QA-3** DEMO_SCRIPT.md: click-through checklist and device setup · Demo lead · needs QA-2
- [ ] **QA-4** QA pass on real phones and permission breaking · QA · needs FND-8
- [ ] **QA-5** Fresh-clone test on laptop and LinuxONE · QA + LinuxONE owner · needs QA-6
- [ ] **QA-6** README, DECISIONS.md and final feature report · Eng 1 + Pitch lead
- [ ] **PIT-2** 7-slide pitch deck · Pitch lead · needs DET-6, FND-7
- [ ] **PIT-3** Project description and judge Q&A sheet · Pitch lead · needs DET-6
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
- [ ] **STR-1** Granite: local tagger and alert text (USE_GRANITE) _(STRETCH)_ · Eng 2 · needs ORG-2, DET-5
- [ ] **STR-2** Honeytoken decoy records _(STRETCH)_ · Eng 2 · needs DET-5

## Open decisions (record each in DECISIONS.md)

- Frozen colour: the design rules say red, but P2 and H4 say amber (FND-5)
- How the hospital sees request status live: polling or a new stream; the spec lists no endpoint (VLT-5)
- New tables not in the data model: access_requests, emergency grants, care_episodes (FND-3)
- Endpoints the spec needs but doesn't list: patient lookup (H6), search (P14), weekly summary (P15), hospital audit (H9)
- Demo-only clock override so the "3 AM" attacks work in a daytime demo (S5)
- The repo is private; make it public before submitting (PIT-5)
