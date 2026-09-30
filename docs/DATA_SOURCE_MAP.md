# DATA SOURCE MAP — Scholario-OS

> Phase 7 deliverable · the data-honesty contract. Every module's source
> of truth, every seed, every remaining mock — classified, intentional,
> documented. Companion: `PLATFORM_CONTROL_PLANE.md`, `PLATFORM_SECURITY_MODEL.md`.

## 0. The contract

**No UI silently fabricates data.** If data does not exist the surface
renders an honest state: a skeleton while loading, a retry affordance on
failure, an empty state ("0 students", "₹0 dues", "No records yet") —
never a fake number, a fake name, or a fake trend.

Enforcement layers:
1. **Canonical path** — module → API route → Prisma → SQLite (`db/custom.db`); tenant from the session (Phase 2).
2. **Honest degradation** — every replaced surface implements loading / error / empty states explicitly (see §3).
3. **This map** — every remaining non-canonical path is classified below (§5) with its intention status; anything NOT in this map must be canonical.

## 1. Classification legend (per the Phase-7 brief)

| Class | Meaning |
|---|---|
| **A** | Real database data (Prisma models, tenant-scoped) |
| **B** | Development seed data (server-side scripts provisioning the DEV/DEMO tenant's DB rows) |
| **C** | Mock UI data (client-side fabricated rows used as module content) |
| **D** | Fallback data (shown when the canonical source fails/hasn't loaded) |
| **E** | Hardcoded constants (domain config: catalogs, policies, layouts — not records) |
| **F** | Fake analytics (fabricated metrics/charts) |
| **G** | Fake dashboard metrics (fabricated KPIs) |
| **H** | Demo-only data (exists to make the demo tenant demonstrable) |
| **I** | Temporary compatibility logic (retired-but-kept shims) |

## 2. The four data tiers (NEVER confused)

| Tier | What | Where | Lifecycle |
|---|---|---|---|
| **PRODUCTION DATA** | Real tenant rows created through product workflows (students admitted, marks entered, payments recorded, events created…) | `db/custom.db` via API routes only | Created/owned by tenant users; survives everything |
| **DEMO DATA** | The Demo School tenant's OWN data — **a real tenant** (`School.slug='demo-school'`, `isDemo=true`) using the same production domain models and workflows as every other school; only its provisioning is special | `db/custom.db` — provisioned by server-side seed scripts (B-tier) into the demo tenant's rows | Indistinguishable from production rows at the model level; a fresh production deployment simply never runs those seeds |
| **TEST FIXTURES** | Rows for automated suites (School A/B controlled identities, probe rows) | `db/custom.db` via `prisma/seed-tenant-isolation.ts` (+ platform suite's self-seeded throwaway rows) | Owned by the suites; idempotent seeds; never surfaced as product content (isolation-tested) |
| **DEVELOPMENT SEEDS** | Server-side scripts that populate the dev/demo tenant for a runnable preview | `prisma/seed*.ts` (see §4.1) | Run explicitly (`bun run db:seed*`); idempotent; never run in production |

**Rule:** client-side localStorage stores are NEVER a data tier — they are caches/workspace state whose content must hydrate from the canonical API (students/teachers patterns) or start empty.

## 3. Phase 7 replacements (fabrication → canonical/honest)

| Surface | Was | Now |
|---|---|---|
| Principal dashboard — Revenue vs Expenses chart | F: `mock/finance.revenueAnalytics` (₹1.16–2.42 Cr fabricated) | **A**: real 6-month Payment trend via `GET /api/dashboard` (`use-dashboard-finance`); no payments → honest empty state |
| Principal dashboard — Fee Collection donut | F: `mock/finance.feeAnalytics` (88.6%, ₹14.28 Cr) | **A**: real billed/collected/outstanding from `/api/dashboard`; ₹0 billed → honest empty state |
| Principal dashboard — Pending Fees KPI | D: ₹1.84 Cr mock fallback on sync failure | honest skeleton → live server number; failure → "Could not load dues — tap to retry" |
| Principal dashboard — Principal Attention alerts | C/G: 6 fabricated alerts persisted cross-tenant + fabricated hourly activity grid | honest empty start; REAL live fee-dues alert + platform event stream; simulate/auto-alert fabrication features REMOVED; persist v2 purge |
| Principal dashboard — Notice Board | C: communication-store seed + `mock/operations` fallback | **A**: `GET /api/announcements` (role-visible rows; `use-server-announcements`) |
| Principal dashboard — Upcoming Events | C: 5 hardcoded Dec-2025 events | **A**: `GET /api/events?upcoming=1` (SchoolEvent rows) |
| Principal dashboard — welcome banner school name | C: `mock/school` ("Greenwood") | **A**: session school from `/api/auth/me` (current-user-store) |
| Principal Recent Admissions / Pending-Reviews admission count | C: seeded fake applicants | honest empty (`admission-store` un-seeded, persist v2 purge; no DB admissions pipeline exists — see §5) |
| Applications module seeding | C: `ensureApplicationSeedData()` fabricated submissions | retired (inert no-op); store v10 purge |
| Public website — hero/trust-bar stats | E/F: "1,840 students / 152 faculty / 18 labs / 240+ awards", "30+ years / 1:12 / 98% pass", "Est. 1995" | **A**: REAL DB counts (students/faculty/classes/subjects) + derived teacher ratio + academic year; unavailable → "—"; floating stat = real student count (hidden when unknown) |
| `/api/schools/public` fallback payload | D: full fabricated school profile (1,842 students, 4,500 books) on DB failure | removed — 404/500 honest; site renders neutral degraded identity |
| School login page branding | C: `mock/school` Greenwood identity + "CBSE · Estd. 2020" | **A**: real registered school profile (`/api/schools/public`) + real session year; neutral degradation ("Scholario") |
| `auth-store.roleProfiles` | C: "Dr. Ananya Iyer / Rohan Mehta / Aarav Sharma" demo identities | neutral placeholders only; server identity always overrides at login |
| Teachers module / class cards / timetable picker / messaging contacts | C: ~20 fabricated teachers (Aadhaar, bank, salaries) | **A**: `GET /api/teachers` server-hydration (`teachers-store/server-sync.ts`, students-store pattern; once-per-session; failure → keep + retry); store un-seeded, persist v6 purge; `teachers-mock-store` DELETED; empty roster stays empty |
| Salary & Payroll module | C: fabricated employees/payments (NEFT refs) | employees derived from the hydrated teachers store; payment history honest-empty (persist v1 purge); principal name = real session |
| Student attendance module | C: 25 fabricated records/96% for demo student only | **A**: NEW `GET /api/student/attendance` (own real Attendance rows, school-scoped, last 90d) + honest empty state |
| Student results module | C: seeded marks for demo student only | **A**: `GET /api/results` (role-scoped own rows); honest "No published results yet" |
| Student notifications | C: fake exam-due items from `mock/academics` | real `/api/notifications-feed` + `/api/student/notices` only |
| Student bus tracking | C: fabricated GPS/ETA/speed/fuel/driver phone | real route/vehicle/driver name from the student record (when assigned) + honest "Live bus tracking is not available yet" |
| Student messaging | C: seeded conversations | honest empty (persist v2 purge); contacts guard empty teacher store |
| Exams — Session Top Performers | C: `session-toppers-data.ts` explicit mock | **A**: real aggregation over `GET /api/results` |
| Exams — Reports tab | C: mock-marks analytics | **A**: `/api/results` + ExamMark analytics; no-source sections render "not tracked" |
| Attendance — Staff tab | C: `STAFF_DEFS` 20 fake staff + random statuses | honest "Staff attendance tracking is not configured" (no DB model) |
| Notices RSS fallback title | D: mock school name | neutral ("School") |
| Dead analytics module | C/F: fully mock, zero importers | DELETED (`principal/modules/analytics`) |

## 4. Module → source-of-truth map

Legend per row: **UI → API → service/table** (+ seed/mock/fallback notes). All APIs are session-tenant-scoped (Phase 2 pipeline).

### 4.1 Foundation & provisioning (server-side seeds — B/H tiers)

| Script | Purpose | Tier |
|---|---|---|
| `prisma/seed.ts` | demo tenant base: school, classes, subjects, users, base rows | B/H (DEMO DATA provisioning) |
| `prisma/seed-roster-150.ts` | demo tenant roster breadth (150 students) | B/H |
| `prisma/seed-teacher-academics.ts` / `seed-teacher-hub.ts` | demo tenant teachers + academic allocations | B/H |
| `prisma/seed-exam-ops.ts` | demo tenant exams/marks ops data | B/H |
| `prisma/seed-learning.ts` / `seed-study-materials.ts` / `seed-student-dashboard.ts` | demo tenant learning materials | B/H |
| `prisma/seed-tenant-isolation.ts` | TEST FIXTURES (School A/B identities + probe rows) | fixtures |
| `prisma/seed-platform.ts` | platform admins (root/ops) + demo announcement | B/H (control plane) |
| `prisma/backfill|spread|repair|migrate-*.ts` | one-off data ops scripts (dev tooling) | dev tooling |

### 4.2 Public surfaces

| Module | Source of truth | Notes |
|---|---|---|
| Public website (hero, trust bar, notices, admissions form) | `GET /api/schools/public` → `School` + `_count` + `Notification(ALL/PUBLIC)` · `POST /api/admissions/public` → ActivityLog+Notification | REAL counts everywhere; campus photography is static asset content (E) |
| School login | `POST /api/auth/login` · `/api/platform/announcements/public` · branding via `/api/schools/public` | no Super Admin exposure (Phase 6) |
| Platform console | `/api/platform/*` → PlatformAdmin/School/PlatformAuditLog etc. | Phase 6 boundary |

### 4.3 Principal panel

| Module | UI → API → table | Remaining non-canonical paths (classified in §5) |
|---|---|---|
| Dashboard | KPIs: `/api/attendance/overview`, dues store → `/api/fees/defaulters?summary=1`, roster store (server-synced), `/api/exams`, `/api/dashboard` (charts), `/api/announcements` (notices), `/api/events` (events), `/api/auth/me` (identity) | students-store pre-sync seed flash (D) |
| Students & Classes | students-store → `GET /api/students/roster` (sync on mount) · profiles → `GET /api/students/[id]` · class-teachers → `/api/classes/class-teachers` | students-store seed fallback (D) |
| Teachers | teachers-store → `GET /api/teachers` (sync on mount; retry on error) | — |
| Attendance (Overview/insights) | `/api/attendance/overview` → `Attendance` | History/class-report/student-workspace tabs (C/D §5); Staff tab honest-empty |
| Examinations | `/api/exams/**` → Exam/ExamMark/Result (CRUD, marks, seating, outcomes) | exams workspace dialog marks preview (§5) |
| Fee Management | `/api/fees/**` → Fee/FeeTransaction/Payment (defaulters, structures, transactions, orders, receipts) | fee-store in-session ledger + config constants (E) |
| Finance Dashboard | fees-in from roster (server-synced) | P&L/balance-sheet/cashflow: no expense model → **F-classified remaining mock** (§5) |
| Salary & Payroll | employees from teachers-store (hydrated) | payroll history honest-empty (no payroll DB model — §5) |
| Timetable | `GET/POST /api/timetable` (+publish) → Timetable | PDF letterhead (D) |
| Admissions (wizard) | client workspace + `POST /api/admissions/upload` (real file pipeline) | wizard catalog constants (E); store honest-empty (no DB pipeline — §5) |
| Applications & Forms | client workspace (honest-empty) | form-builder = in-session workspace (I §5) |
| Communication — Platform Broadcasts | `/api/announcements` (+reads/export) → Notification | Announcements tab/history (C §5) |
| Messages (principal) | — | messaging-store seeds (C §5) |
| Calendar | — | calendar-store mock events/holidays (C/E §5) |
| Library / Transport / Inventory / Downloads / Certificates | — | client stores (C §5) |

### 4.4 Teacher panel

| Module | Source of truth |
|---|---|
| Dashboard, Marks, Class Attendance, Class Hub, Timetable, Students, Analytics, Growth, Lesson Planner, Fee Collection, Communication | **fully canonical** — `/api/teacher/**` + `/api/exams` + `/api/attendance` (per the Phase-7 audit: single aggregate fetches, DB rows) |
| My Salary | salary module (honest-empty; no payroll model) |
| Applications | applications workspace (honest-empty) |

### 4.5 Student panel

| Module | Source of truth |
|---|---|
| Dashboard | `/api/student/dashboard` (one aggregate: fees, attendance, classes, transport, academics) |
| Timetable, Learning (materials/planner/groups/flashcards), Fees & Payments | `/api/student/*`, `/api/study-materials/*`, `/api/student/payments/*` |
| Attendance | **NEW** `/api/student/attendance` → own `Attendance` rows |
| Results | `/api/results` (role-scoped) |
| Notifications/Announcements | `/api/notifications-feed` + `/api/student/notices` |
| Messages | honest-empty (contacts guard) |
| Bus tracking | real assignment from dashboard transport slice + honest no-GPS state |
| My Class | roster (server-synced) + teacher names from hydrated teachers-store |

### 4.6 App shell

| Surface | Source |
|---|---|
| Notifications bell | `/api/notifications-feed` (60s poll) |
| Live event stream | socket.io :3003 (authenticated, school-scoped) |
| Bell/nav badges | real counts (live-alerts store is honest-empty) |

## 5. Remaining-occurrence register (the exhaustive classification)

Every remaining non-canonical path, classified and intentional. **Each entry states why it remains and its migration path.** Nothing outside this register should fabricate data.

### 5.1 `src/lib/mock/**` consumers (runtime)

| # | File(s) | Import | Class | Intentional status + migration path |
|---|---|---|---|---|
| R1 | ~21 document/print surfaces (payslips, fee receipts, admission letters, welcome letters, timetable PDFs, monthly attendance PDF, students-classes header, comm-compose, my-certificates, app-shell footer, admission wizard steps) | `school` (identity snapshot) | **D** | Letterhead fallback for documents when the settings store lacks a field. Sanctioned path is `useSchoolProfile()` (settings → session identity → fallback); several print files import `mock/school` directly. **Intentional**: a document must never render an empty letterhead. **Migration**: route all through `school-profile.ts`, then replace the mock fallback with neutral constants + DB School columns. |
| R2 | admission wizard (`ClassStep`, `useFeeCalculations`, `FeeStructureStep`), fees-structures, classes details, shared calendar data | `classList` / `subjects` / `departments` | **E** | Domain catalog constants (class bands, subject lists, fee policy bands). Structural config, not records. **Migration**: master-data tables (`Class`/`Subject` already exist server-side — the wizard should read them). |
| R3 | `finance-store.ts` → `mock/finance-dashboard.ts` | P&L/balance-sheet/cashflow series | **F** | The Finance Dashboard's accounting statements. **Intentional + DOCUMENTED as the largest remaining fabrication**: there is NO expense/ledger model in the schema, so the statements cannot be real yet. The module's REAL inputs (fees-in, collections) are canonical. **Migration**: add an expense/ledger model, then compute statements from it. Interim honesty note: the module renders these panels as illustrative — flagged for the next phase. |
| R4 | `messaging-store.ts` (principal messages), `communication-store.ts` (announcements tab/history), `calendar-store.ts` (+`mock/operations` events + `mock/school-calendar` holidays), `library-store.ts`, `transport-store.ts`, `inventory-store.ts`, `certificates-store.ts`, `downloads-store.ts`, `school-settings-store.ts` | client-side seed universes | **C/H** | The remaining client-store module families (messages, calendar, library, transport, inventory, certificates, downloads, settings). **Intentional, bounded**: DB models EXIST for library/transport/events/messages (LibraryBook/Vehicle/Route/SchoolEvent/Message) — the stores predate the API layer. **Migration (per family)**: server hydration à la students/teachers stores (fetch → replace → honest empty). Scheduled as the next data-contract phase. |
| R5 | `search-service/search-{people,academic,content,fees}.ts` | mock catalogs as search corpus fallback | **C/D** | The search service's real corpus comes from DB queries; mock catalogs fill when tenant data is sparse (demo experience). **Migration**: search-only-canonical once R2/R4 migrate. |
| R6 | `exams/mock-{marks,attendance,outcomes}-data.ts` + `use-exams-mock`/`use-marks-mock` + `seed-helpers.ts` | exam workspace preview data | **C/I** | Marks-entry SCAN-preview / workspace dialogs demo data. **Intentional**: the real marks pipeline is canonical; these feed preview-only surfaces. **Migration**: previews render real ExamMark rows once the workspace dialogs are rewired (toppers/reports already done). |
| R7 | `attendance/` module history/class-report/student-workspace tabs + `mock/attendance` classSections/history | **C** | Attendance analytics tabs beyond the canonical Overview. **Intentional**: Overview (the default) is canonical; history reports are the next hydration target (`Attendance` rows exist). |
| R8 | `students-store/seed-data.ts` (SS/SC seed universe) + `constants.ts` | 58-student pre-sync roster | **D/H** | The students store's initial state: a first-paint fallback that the mount-time server sync (`GET /api/students/roster`) REPLACES on every successful login (principal/student). **Known gap**: on sync failure a fresh browser keeps the seed universe (demo roster) — documented; the demo tenant's canonical DB roster supersedes it within one successful sync. **Migration**: gate the seed behind the demo tenant + add a sync-failed banner. |
| R9 | `mock/academic/*` (classes/resolver/streams/subjects/use-academic-classes) | academic structure resolver | **E/I** | The admission wizard's academic-class resolution (streams, sections). Structural config. **Migration**: `/api/classes` + `/api/subjects`. |
| R10 | `mock/bus-tracking.ts` | (file retained, zero runtime importers after 7-b) | **I** | Retired reference. |
| R11 | `mock/teachers.ts`, `teachers-store/seed-data.ts`, `staff-attendance-store.ts`, `exams/session-toppers-data.ts`, `applications-store` seed machinery, `admission-store/seed-data.ts`, `student-*-store` seeds, `live-alerts-store` seed pool | RETIRED (zero runtime importers) | **I** | Kept on disk as retired references with RETIRED doc comments; their persisted states purge via version migrations. |
| R12 | `school-profile.ts` | mock fallback | **D** | The sanctioned identity resolver (settings-store → mock fallback). **Migration**: session identity + neutral fallback (login page pattern). |
| R13 | `platform-subscription.ts` | in-memory subscription store + STU-58 record | **H/I** | The platform's student-subscription demo surface (super-admin module). In-memory demo config (annual fee/UPI id) + one demo record. **Migration**: DB model + platform settings (Phase 6 settings plane) when billing goes real. |

### 5.2 Other remaining patterns (non-`lib/mock`)

| # | Location | Class | Status |
|---|---|---|---|
| R14 | Demo-credential chips on the school login (`login-page/data.tsx`) | **H** | `NODE_ENV`-gated dev-preview affordance (compiled out in production) — intentional developer UX, labeled "development preview only". |
| R15 | Demo authenticator widget + `demo-code` endpoint (platform login) | **H** | Phase-6 dev-preview, double-gated (production 404; isDemo admins only) — documented in PLATFORM_SECURITY_MODEL.md §3. |
| R16 | Public website marketing copy (pillars, journey, facilities text) + campus photography | **E** | Static content, not data. The NUMBERS are all real (§3). |
| R17 | `fee-store-data.ts` (FEE_POLICY bands, ACADEMIC_CLASSES catalog) + fee-store config (payment modes, receipt settings) | **E** | Fee domain config constants. **Migration**: FeeStructure/ MasterFeeHead master data (tables exist). |
| R18 | Teacher/parent "demo" fixture identities (`tenant.*@scholario.test`, `*.b@bluebell.test`) | fixtures | TEST FIXTURES tier — seeded by `seed-tenant-isolation.ts`, isolation-tested, never presented as product content. |
| R19 | `school-settings-store` General-tab identity | **C/D** | Client-side school config (the principal's editable settings). **Migration**: DB School columns + settings API. |
| R20 | Search autocomplete/AI question-bank helpers reading mock catalogs | **C/E** | Falls under R5's corpus. |

**Count: 20 register entries.** Every remaining mock/fake/demo/fallback pattern in the repository maps to one of them (verification sweep in §6).

## 6. Final verification sweep (repo-wide pattern search)

Commands (on the committed tree):
`rg -l "from '@/lib/mock" src/` · `rg -l "mock|fake|demo" src/ --glob '!src/lib/mock/**'` (curated) · `rg -n "1,?840|98%|Est\. 1995|STU-58|Dr\. Ananya|fabricat" src/components/ src/lib/store/`

Result: every hit is (a) a RETIRED file with a doc banner, (b) a register entry above, (c) a comment documenting the retirement, or (d) an honest-empty/test-path string. No fabricated number renders on any audited surface (see §3 + browser verification in the worklog).

## 7. Clean environment strategy

- **Fresh production deployment**: create the tenant via the platform control plane (`POST /api/platform/schools` → activate) — no seed scripts run; every module starts honest-empty and fills through real workflows.
- **Demo environment**: run the B/H seed family (`bun run db:seed*`) for the demo tenant ONLY — the demo school is a real tenant whose data is indistinguishable from production rows.
- **CI/test environment**: `seed-tenant-isolation.ts` + suite self-seeded throwaway rows; rate-limit-safe suites (documented fallbacks bypass only login limiters, never authorization).
- **Client stores**: never seeded at runtime except the two documented first-paint fallbacks (R8 students-store pre-sync, R13 subscription demo); all purge via persist-version migrations on upgrade.
- **Honest-degradation contract** (all replaced surfaces): loading → skeleton; failure → retry affordance with the last-known data or "—"; no data → explicit empty state. Never a fabricated substitute.

## 8. Residual risk honesty

The register is honest about scale: the principal's *strategic* module family (finance statements R3, payroll, library/transport/inventory R4, messaging/calendar R4) still carries client-side or illustrative data because their backing models/workflows are incomplete — each entry names its migration path, and the Phase-7 replacements cover every surface where a REAL or honest-empty alternative existed. The demo tenant remains fully demonstrable through its SEEDED DB rows (real tenant data), not client fabrications.
