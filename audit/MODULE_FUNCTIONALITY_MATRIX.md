# AUDIT 3/7 — MODULE FUNCTIONALITY MATRIX
Audit date: 2026-10-09 · Roles: Principal / Teacher / Student (school) + Platform admin (separate control plane)

---

## 1. Method and evidence tiers (honesty contract)

No claim below is based on a rendered page alone. Evidence tiers:
- **H1 historical runtime (strong):** live-HTTP/browser-verified matrices — Final Product Excellence Gate 2026-09-30 (437/437 tests + 5/5 e2e, dual-tenant browser QA, 10-breakpoint responsive sweep) and Phase 8C 2026-10-02 (518 pass/0 fail/14 designed skips, provisioning/tenant acceptance 12/12 + 15/15). Code for these modules is **byte-identical today** (6-file diff touches none of them — Audit 2).
- **S static (today):** route/page/API existence, data-source wiring, mock-import scan (0 in `src/app/`), schema constraints.
- **R runtime (today):** dev server started 12:40; probes recorded in Audit 4 §3.

**Global runtime status NOW: the app boots and serves pages (200) but EVERY DB-backed API returns 500** (prisma datasource URL invalid; DB stack wiped — Audit 1 §2). Therefore every module whose data is DB-backed is **runtime-blocked by the workspace, not by code**. The matrix separates these.

Legend: VW = VERIFIED WORKING · PW = PARTIALLY WORKING · MD = MOCK/DEMO ONLY · BR = BROKEN · IN = INERT/UNIMPLEMENTED · NT = NOT TESTED (this session).

## 2. Principal panel (~20 modules)

| Module | Data source (DATA_SOURCE_MAP §4.3) | Classification | Evidence |
|---|---|---|---|
| Dashboard (KPIs, charts, alerts, notices, events) | `/api/dashboard`, `/api/attendance/overview`, `/api/fees/defaulters`, `/api/announcements`, `/api/events`, `/api/auth/me` — all canonical | **VW (H1)** / runtime-blocked today (R: `/api/schools/public` 500) | fee-aggregation semantics fixed & test-pinned at the Sept-30 gate |
| Students & Classes | students-store → `GET /api/students/roster` server-sync; profiles `/api/students/[id]` | **VW (H1)** / runtime-blocked | demo-seed flash is D-tier, documented |
| Teachers | teachers-store → `GET /api/teachers` (server-sync, retry) | **VW (H1)** / runtime-blocked | mock store deleted at Phase 7 |
| Attendance (Overview/insights) | `/api/attendance/overview` → Attendance rows | **VW (H1)** for Overview; **PW** — History/class-report/student-workspace tabs are C-class client mock (R7); Staff tab honest-IN (no model) | register R7 |
| Examinations | `/api/exams/**` → Exam/ExamMark/Result | **VW (H1)** / runtime-blocked | marks pipeline canonical; scan-preview dialogs C-class (R6) |
| Fee Management | `/api/fees/**` → Fee/FeeTransaction/Payment (two-stage verify workflow, unique receipt constraint) | **VW (H1)** / runtime-blocked | **fee-integrity exceptions documented in Audit 6 (admission-side)** |
| Salary & Payroll | employees derived from hydrated teachers store; payroll history honest-empty (no payroll model) | **PW (by design)** — structure real, history inert | register (DATA_SOURCE_MAP §4.3) |
| Finance Dashboard | fees-in canonical; P&L/balance-sheet/cashflow **illustrative mock** (no expense model) | **MD — labeled illustrative** | register R3; banner + labeled KPIs at the gate |
| Timetable | `GET/POST /api/timetable` (+publish, conflict guard — recent fix `33f4826`) | **VW (H1)** / runtime-blocked | publish 409 domain codes fixed Oct 8 |
| Admissions (wizard + verification + issuance) | client workspace + real upload pipeline; official letters client-computed | **PW — functional but financial authority is client-side (PR-3 backlog, Audit 6)** | letter-data.ts imports client `computeFeeSnapshot` |
| Applications & Forms | client workspace, honest-empty | **PW** (in-session workspace, I-class) | register |
| Communication (broadcasts) | `/api/announcements` → Notification | **VW (H1)** | announcements tab C-class history (R4) |
| Messages | messaging-store seeds (demo-gated) | **MD (demo-gated)** — server hydration pending | register R4 |
| Library / Transport / Inventory | client stores (demo-gated); **DB models + some APIs exist** | **PW/MD** — canonical APIs exist for library/transport; stores not yet hydrated | register R4 |
| Certificates / Downloads | client stores | **MD (demo-gated)** | register R4 |
| Calendar | calendar-store mock events/holidays | **MD (demo-gated)** | register R4 |
| School Settings | `school-settings/server-api.ts` → DB-backed settings tabs | **VW (H1)** / runtime-blocked | identity/tab surfaces server-backed |
| Live shell (notifications bell, event ticker) | `/api/notifications-feed` + socket.io :3003 | **PW** — API canonical; socket service currently failing its PG connection (Audit 1 §3) | event-stream service.log |

## 3. Teacher panel (12 modules)

| Module | Source | Classification |
|---|---|---|
| Dashboard, Marks, Class Attendance, Class Hub, Timetable, Students, Analytics, Growth, Lesson Planner, Fee Collection, Communication | `/api/teacher/**`, `/api/exams`, `/api/attendance` — **fully canonical** per DATA_SOURCE_MAP §4.4 | **VW (H1)** / runtime-blocked today |
| My Salary | salary module (honest-empty) | **PW (by design)** |
| Applications | workspace (honest-empty) | **PW** |

## 4. Student panel (11 modules)

| Module | Source | Classification |
|---|---|---|
| Dashboard | `/api/student/dashboard` (aggregate) | **VW (H1)** / runtime-blocked |
| Timetable, Learning (materials/planner/groups/flashcards), Fees & Payments | `/api/student/*`, `/api/study-materials/*` | **VW (H1)** / runtime-blocked |
| Attendance | `/api/student/attendance` (own rows) | **VW (H1)** / runtime-blocked |
| Results | `/api/results` (role-scoped) | **VW (H1)** / runtime-blocked |
| Notifications/Announcements | `/api/notifications-feed` + `/api/student/notices` | **VW (H1)** / runtime-blocked |
| Messages | honest-empty (contacts guard) | **PW (by design)** |
| Bus tracking | real assignment + honest no-GPS state | **PW (by design)** |
| My Class / Profile | roster (server-sync) + hydrated teacher names | **VW (H1)** / runtime-blocked |

## 5. Platform control plane (10-module console, separate identity boundary)

Platform admin (NOT a school role): schools list/detail/activate/suspend (step-up MFA), plans/flags, audit trail, support oversight sessions, announcements, provisioning (atomic, race-safe 8/8), setup-readiness parity.
**Classification: VW (H1)** — platform-isolation 43–45 live-HTTP tests; MFA + step-up + rate limits verified. Runtime-blocked today (same DB layer). Dev-preview demo authenticator is double-gated (prod 404).

## 6. Public surfaces

Public website (hero/trust-bar real DB counts, notices, admissions form), school login doors `/s/[slug]/login` (real school branding via `/api/schools/public`), platform login. **VW (H1)**. Today: home 200; door 404s because the school cannot be resolved without the DB (R, Audit 4 §3).

## 7. Cross-cutting invariants (verified, evidence-backed)

- **Tenant isolation:** 57/57 seeded pair + 15/15 freshly-provisioned pair (H1); schoolId always session-derived server-side (schoolId-spoofing probes green).
- **Role model:** canonical school roles PRINCIPAL/TEACHER/STUDENT enforced server-side; platform disjoint token space (43–45/… green).
- **Financial invariants:** billed = collected + outstanding (fixed & pinned at the Sept-30 gate); NUMERIC(12,2) money columns; one payment = one FeeTransaction; ledger moves only on principal verification; `Payment.transactionId @unique` (webhook replay cannot double-mint); `WebhookEvent.eventId @unique` (webhook idempotency); `FeeTransaction @@unique([schoolId, receiptNo])`.
- **Honest degradation:** loading/empty/error states contract (DATA_SOURCE_MAP §3/§7) — re-verified by today's health probe: `/health/ready` correctly reports `database:failed` (503) instead of faking readiness.

## 8. Regressions caused by recent work

None found in code (tree identical to baseline except the 6 audited files). The regressions are **environmental**: DB stack wiped, event-stream failing, preview previously pointing at the quarantined rebuild app.
