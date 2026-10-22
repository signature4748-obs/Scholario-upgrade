# PHASE 1/9 — TEST MATRIX (feature-level, click-by-click method for Phases 2+)

Purpose: this is the **execution method** for the later phases. Phase 1 only seeds it with statuses Phase 1 actually earned. Rows are NOT claimed tested unless evidence exists. Phase 2 executes rows in the priority order given at the end.

**Test discipline (applies to every row):**
- Run against the **local stack** (embedded PG 18.4 + canonical 12-seed corpus + supervised dev server, CI-parity env per BASELINE §6) using **dedicated test tenants**. Wizard experiments use freshly provisioned test schools (never Hawkings/Green Valley beyond read-only assertions, never production).
- Every destructive action targets rows the test itself created (`QA *` / `Wizard Academy *` / `Reliability Test *` naming), cleaned up by the suite's own teardown.
- Cross-tenant probes use the seeded tenant-isolation fixtures (principal A/B etc.) and assert fail-safe 404s — never read another tenant's data.
- Evidence: screenshots/artifacts under `audit/phase2-*/…`, plus API/DB assertions recorded inline. Status vocabulary: **PASS / FAIL / PARTIAL / NOT TESTED** (with reason).

**Row schema:** `ID · Route · Preconditions · Click sequence · Expected UI · Expected API · Expected DB · Validation & errors · Refresh/repeat · Authz/cross-tenant · Evidence · Status`

---

## M1 — Platform console (role: root admin + granted admin)

| ID | Feature / route | Preconditions | Click sequence | Expected UI | Expected API | Expected DB | Validation / error | Refresh / repeat | Authz / cross-tenant | Status (Phase 1) |
|---|---|---|---|---|---|---|---|---|---|---|
| M1-01 | Platform login `/platform/login` | root admin seeded | enter email+password (valid) → submit | console Overview | `POST /api/platform/auth/login` 200 + session cookie | `PlatformAdminSession` row | wrong password → generic 401 + lockout counter UI | logout → /platform/login renders; re-login OK | anonymous /api/platform/* → 401 envelope | **NOT TESTED (UI)** — API contract PASS (platform-lockout-recovery, auth suites) |
| M1-02 | Lockout + recovery | 5 wrong logins | repeat wrong password | lock banner, honest retry-after | 429 RATE_LIMITED envelope | RateLimitBucket row | 6th attempt blocked even with correct password | persists across refresh | recovery ticket flow resets | **NOT TESTED (UI)** — API PASS (account-recovery §H) |
| M1-03 | Step-up MFA gate | root session, TOTP configured | open suspend dialog → submit reason → enter TOTP | step-up modal then action completes | `POST /api/platform/auth/step-up` → action 200 | `PlatformAuditLog` row + session stepUpAt | wrong TOTP → STEP_UP_REQUIRED | re-open dialog state preserved | non-root without schools.manage → hidden + 403 | API PASS (platform-mfa-config unit) · UI NOT TESTED |
| M1-04 | Schools directory `/platform/schools` | ≥2 tenants | filter demo/production/readiness/subscription; sort name/created | rows filter+sort | `GET /api/platform/schools?demo=…&readiness=…&sort=…` | no change | — | sort stable on reload | school-session cookie cannot call it | API PASS (schools-management-overhaul) · UI NOT TESTED |
| M1-05 | Add-School wizard (7 steps) `/platform/schools/new` | root, step-up fresh | walk Identity→Subscription→Academic (Class 1–12 preset)→Branding→Address→Review→Create | success panel with loginUrl, tempPassword once, bootstrap counts | `POST /api/platform/schools/precheck` then `POST /api/platform/schools` 200 | ONE School (PENDING) + subscription + principal (mustChangePassword) + 12 Class rows + 1 invite EmailDelivery + audit row | PIN validation (e.g., 1234 blocked); duplicate slug → 409; ICSE/STATE/CUSTOM boards → 422 | resubmit same payload → idempotent replay message, no dup school | only schools.provision holders see Add button | API PASS (wizard 785-line suite) · **full-UI 7-step walk NOT TESTED in this repo on this box** (fd14234 pack did it; re-verify in Phase 2) |
| M1-06 | School record tabs `/platform/schools/[id]` | PENDING school from M1-05 | Activate; toggle feature flags; view setup-readiness; Users; Subscription terms record; Domains CRUD+verify; Audit tab | status chips update | activate 200; flags 200 per toggle | status ACTIVE; audit rows per action; flags JSON | suspend requires step-up+reason 10–400 chars | audit tab shows new events after refresh | cross-school id → 404 for another admin scoping | PARTIAL — API side PASS (overhaul + provisioning suites); tab UI NOT TESTED |
| M1-07 | Subscriptions console | plans seeded | registry summary, plans CRUD, code issue/revoke | tables + dialogs | `platform/subscriptions/*` | SubscriptionPlan/Order/codes rows | revoke twice → idempotent 409-class | summary recalcs | billing.manage required | API PASS (platform-subscriptions-registry-summary) · UI NOT TESTED |
| M1-08 | Announcements | root | create → publish → edit → delete | list updates | `platform/announcements*` | PlatformAnnouncement rows | empty body blocked | public feed reflects after reload | support/admins scoping per permissions | API PASS · UI NOT TESTED |
| M1-09 | Audit Log `/platform/audit` | audit rows exist | paginate, filter by action | rows render | `GET /api/platform/audit` | no change | — | direct URL + refresh + new tab all render (the "Audit Log incident" regression) | audit.read required | E2E PASS in CI (platform-console-journeys); locally blocked by box (see BASELINE §6) → **NOT TESTED locally** |
| M1-10 | Operations center | ops data | run health check; ack alert; resolve error by fingerprint | statuses flip | `platform/operations/*` | MonitoringCheck / Alert / OperationalError rows | ack twice → 409-class or idempotent per contract | overview updates | ops.read required | API PASS (ops suites) · UI NOT TESTED |
| M1-11 | Admins & permissions | admins.manage holder | grant/revoke permission keys; suspend/reactivate; reset password; recovery tickets | matrices update | `platform/admins/*` | PlatformAdmin/Permission rows; audit | cannot strip own schools.manage root-safety? (verify contract) | sessions revoked immediately on suspend | non-root sees only granted modules | API PASS (account-recovery) · UI NOT TESTED |
| M1-12 | Sessions & settings | root | list sessions, revoke other session; change own password; TOTP setup; Google link start | security UI | `platform/auth/*`, `platform/sessions` | session rows; hash rotation | old password wrong → 401 | revoked session 401s on next call | cross-admin isolation | API PASS (platform-password-change, session-gate) · UI NOT TESTED |

## M2 — Principal plane (canonical school door `/s/<slug>/login`)

| ID | Feature | Click sequence (abridged) | Expected | Status (Phase 1) |
|---|---|---|---|---|
| M2-01 | Tenant login door + forced password change | open `/s/<slug>/login` → tempPassword → forced setup screen → new password | door branded per tenant; bootstrap credential refused after change | API PASS (credential-reset, auth suites) · UI NOT TESTED |
| M2-02 | **Classes module display (the D1 surface)** | login as principal of a **wizard-created test school** → Classes | EXPECT AFTER FIX: 12 class cards "Class 1…Class 12", 1 section A each. CURRENT CODE: one "Grade 0 · 12 sections" card (D1) | **FAIL (repro-proven)** — this row is the acceptance test for the D1 fix |
| M2-03 | Add Class flow | Students & Classes → Add Class → name/sections/capacity/class-teacher | new persisted class; gradeLevel written; grouping correct after fix | PARTIAL — store logic exists; API+UI walk NOT TESTED; note write-path leaves gradeLevel `''` today (D1 trigger #2) |
| M2-04 | Students CRUD + roster | create student (guardian fields, class+section picker) → edit → archive | row in roster, per-section occupancy chips update | API PASS (regression+security suites) · UI NOT TESTED |
| M2-05 | Admissions lifecycle | inquiry → application → decision → enrol → fee snapshot → admission letter | state machine transitions + audit | API PASS (admission suites) · UI NOT TESTED |
| M2-06 | Timetable editor + publish | build grid → publish (atomic) | classes/subjects/CSA auto-created in one tx | API PASS (timetable suites) · UI NOT TESTED; verify no D1-style rows created via publish (D1 trigger #3) |
| M2-07 | Fees two-stage flow | structure draft→publish → quote → verify → receipt → defaulters → refund → reconcile | ledger integrity, receipt uniqueness | API PASS (fee suites incl. signed gateway) · UI NOT TESTED |
| M2-08 | Exams full chain | create exam → schedule → marks entry → verify → lock → outcomes → declare → report card | state transitions + lock enforcement | API PASS (exam suites) · UI NOT TESTED |
| M2-09 | Attendance day capture | mark day → publish → overview | Attendance rows + analytics | API PASS (attendance-real-data) · UI NOT TESTED |
| M2-10 | Salary payroll | structure → payment → void → payslip | SalaryPayment ledger | API PASS (salary-persistence) · UI NOT TESTED |
| M2-11 | Website CMS | notices/media/social/admissions settings → public site reflect (incl. RSS) | tenant site updates | API PASS (website/tenant-domains) · UI NOT TESTED |
| M2-12 | Messaging/communication | announce to class; message parent thread | rows + read states | API PASS (messaging-persistence) · UI NOT TESTED |
| M2-13 | Settings + profile-change request | edit school profile → request → platform approves | SchoolProfileChangeRequest flow | API PASS (plan-marker-sync) · UI NOT TESTED |
| M2-14 | Subscription surfaces | view terms; record payment; student entitlement list | honest billing states | API PASS (subscription/ saas suites) · UI NOT TESTED |

## M3 — Teacher plane; M4 — Student plane

| ID | Feature | Expected | Status (Phase 1) |
|---|---|---|---|
| M3-01 | Teacher dashboard + duties | day/week load | journeys E2E green in CI; UI NOT TESTED locally |
| M3-02 | Class attendance draft→board | two-phase publish | API PASS · UI NOT TESTED |
| M3-03 | Marks entry grid + scan-draft + submit/verify | marks rows + lock states | API PASS · UI NOT TESTED |
| M3-04 | Class-teacher hub (own class only) | roster, marksheet, comms | API PASS (class-teacher-regression) · UI NOT TESTED |
| M3-05 | Relieved-staff restricted mode | only profile/payroll/fee-collections visible | NOT TESTED |
| M3-06 | Parent connect threads | conversations | API PASS · UI NOT TESTED |
| M4-01 | Student dashboard/profile/results | self-scoped data only | journeys E2E green in CI; UI NOT TESTED locally |
| M4-02 | Learning: materials/bookmarks/flashcards/groups/tasks | L2D surfaces | API PASS (assignment-scope, search) · UI NOT TESTED |
| M4-03 | Student fees checkout (sandbox) | order→verify→receipt | API PASS (fee-gateway BATCH2-B4) · UI NOT TESTED |
| M4-04 | My Subscription + activation claim | entitlement states | API PASS (subscription-entitlement) · UI NOT TESTED |
| M4-05 | Messages/notices/settings | self-scoped | API PASS · UI NOT TESTED |

## M5 — Cross-cutting (all roles)

| ID | Check | Status (Phase 1) |
|---|---|---|
| M5-01 | Cross-tenant isolation sweep (A→B reads/writes/deletes) | **API PASS** (tenant-isolation 57-case battery; PHASE 2/3/6/8C phases) |
| M5-02 | Plane architecture gates (platform↔school route absence) | **API PASS** (plane-architecture, route-inventory) |
| M5-03 | Rate limits (login, strict surfaces) | **API PASS** (rate-limit suites) |
| M5-04 | Session lifecycle (revoke, expiry → login door, ?next= honored) | **API PASS** (auth suites) · UI NOT TESTED |
| M5-05 | Feature-flag honesty (modules vanish when flag off) | API PASS (honesty-sweep, phase75) · UI NOT TESTED |
| M5-06 | Mobile 390 px integrity of principal/teacher/student shells | NOT TESTED this box (prior pack verified schools shell only) |
| M5-07 | D1 regression row (wizard-created class display) | **FAIL — repro-proven** (see M2-02) |

## Execution priority for Phase 2 (from this matrix)

1. **M2-02/M5-07 first** — reproduce D1 in the UI on a fresh wizard test tenant, apply the minimal display-layer fix + regression test, re-run the row to PASS (the one confirmed product defect).
2. M1-05 full 7-step wizard UI walk + M2-01 forced-change flow (new-tenant onboarding spine).
3. M2-03…M2-14 principal module sweep (the widest surface).
4. M3/M4 role sweeps.
5. M5-06 mobile + the NOT TESTED UI rows above, closing statuses with evidence.
