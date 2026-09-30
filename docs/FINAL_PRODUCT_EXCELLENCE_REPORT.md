# FINAL PRODUCT EXCELLENCE GATE — Report

**Status: COMPLETE · VERIFIED (pre-Phase-8)** · Gate date: 2026-09-30 · Verification date: 2026-09-30 (see §16) · Repo: `signature4748-obs/Scholario-upgrade` @ `main`

Pre-Phase-8 product excellence audit + UX/UI hardening pass over the
post-Phase-7.5 codebase. Phase 7.5 remains CLOSED per its own acceptance
criteria; this gate is a NEW pre-production quality layer
(sequence: PHASE 0–7.5 COMPLETE → **FINAL PRODUCT EXCELLENCE GATE** →
PHASE 8A/8B/8C → PHASE 9).

The motivating evidence — a browser review of the Principal Dashboard's
Fee Collection donut (cramped "24 overdue" in the center, 67% competing
with legend values, ₹20.14L/₹9.86L without hierarchy, decorative rather
than analytical) and the Fee Collections trend's misleading "−₹56K"
bottom Y-axis tick — was treated as a symptom class and hunted across the
whole product.

---

## 1. Audit scope

- **Principal Dashboard** (KPI row, live alerts, charts row, ticker, quick
  actions, admissions, events) — full redesign of the finance charts row.
- **All principal modules' charts**: fees, finance-dashboard, attendance,
  transport, library, inventory, exams, plus document print surfaces.
- **Chart primitives**: `premium-charts.tsx` (AreaTrendChart domain +
  baseline), legacy charts audited.
- **Teacher/student/public/platform chart surfaces** (teacher analytics,
  class-hub, student-growth, student fees/results, platform overview —
  verified no chart rendering of `methodTrend` exists to audit).
- **Global shell** (sidebar, header, profile, notifications, search).
- **Print/PDF documents**: admission letter, issuance tabs (letter /
  fee receipt / credentials / welcome / dispatches), payslip, payroll
  report, fee receipt A5, timetable PDF, monthly attendance report,
  student report cards, certificates, receipts.
- **Data honesty**: every R1–R20 register entry re-audited (EG-9),
  E-class violations fixed, command-palette merge, admissions completion
  claims, finance statements labeling.
- **State coverage**: loading/empty/error/retry across major modules.
- **Responsive**: 10 breakpoints (375/390/430/768/820/1024/1180/1280/
  1440/1920) + 320px public site spot checks.
- **Security regression**: full live-HTTP suites re-run.

## 2. Screens audited

Principal: Dashboard, Admissions, Teachers, Students & Classes,
Timetable, Attendance, Examinations, Fee Management, Salary & Payroll,
Finance Dashboard, Applications & Forms, Communication/Messages, Library,
Transport, Inventory, Certificates, Calendar, Downloads, Settings.
Teacher: dashboard, class-hub, analytics, marks, student-growth.
Student: dashboard, results, fees, notifications, certificates, profile.
Public website + login portal. Platform console (code-level).
Demo tenant AND the Bluebell non-demo fixture tenant (both directions of
every honesty/gating change).

## 3. Problems discovered (selected, by severity)

| Sev | Problem | Where |
|---|---|---|
| CRITICAL | Trend chart's Y domain padded 5% below zero for a non-negative payments series — bottom tick "−₹56K" visually implied negative collections | `premium-charts.tsx` AreaTrendChart |
| CRITICAL | `feesPaid` summed `Fee.paid` only over `status:'PAID'` rows — partial payments silently dropped, so billed = collected + outstanding did NOT hold and the dashboard's two "outstanding" numbers disagreed across cards | `/api/dashboard` |
| CRITICAL | School-branch payment trend included FAILED/PENDING gateway rows while claiming "recorded payments" (platform branch already filtered SUCCESS) | `/api/dashboard` |
| CRITICAL (E-class, per EG-9) | Fabricated Greenwood identity printed on ~20 official documents (payslips, receipts, letters, report cards, PDFs) for any real tenant | print surfaces → `mock/school` |
| CRITICAL (E-class) | Un-gated fabricated client-store seeds rendered for ANY tenant (Messages, Library, Transport, Inventory, Certificates, Calendar, Downloads) | 7 store families |
| CRITICAL (E-class) | Finance P&L / Balance Sheet / Cash Flow presented fabricated ₹9.86 Cr / ₹14.2 Cr statements with no illustrative label | finance-statements |
| CRITICAL (E-class) | Attendance History/Class-Report tabs rendered fabricated rosters, rates and teacher names | attendance module |
| CRITICAL (E-class) | Command palette kept fabricated local people/classes/rooms whenever the server returned no rows of a type | use-command-palette |
| HIGH | Admission completion fabricated portal credentials (loginId/tempPassword/`portal.scholario.app`), claimed SMS/email/WhatsApp dispatch, and recorded `feeStatus:'Paid' ₹86,000, attendance:100` for a brand-new student | completion-slice + issuance |
| HIGH | Fee donut design: three competing messages crammed into a 160px hole; amounts demoted to legend | dashboard charts-row |
| HIGH | `waiveFine` zeroed the fine amount — the "Waived ₹" stat could never render anything but ₹0 | `library-store.ts` |
| HIGH | Attendance tooltip reported the dashed AVERAGE line as the hovered month's value; fixed [80,100] Y windows clipped schools below the floor | attendance-charts |
| HIGH | "Coming Up" finance panel mixed one real payroll line with hardcoded illustrative amounts summed into "Total due this month" | finance-overview |
| MED | Trend X-axis showed raw ISO month keys ("2026-04"); missing months silently skipped (discontinuous time axis read as continuous) | dashboard trend |
| MED | Library fines ledger included ₹0 "Paid" seed rows; "Most Issued Books" rendered five zero-bars instead of the empty state | fines-summary |
| MED | "This Month" panel mixed a rolling-30-day fees window with a calendar-month payroll window under one label | finance-overview |
| LOW | Notification badge slightly cramped; one stale docblock; bar min-width exaggerating 1–2-count months | misc |

## 4. Problems fixed

All CRITICAL + HIGH items above, all MED items in audited chart modules,
the LOW items in chart context. Full per-file detail in the commit and
`worklog.md` (Task IDs EG-4A/EG-4A2/EG-6-8/EG-9/EG-9F + orchestrator).

## 5. Visual / data-visualization improvements

- **Fee Collection card redesigned** (the motivating defect): the donut
  is retired. New analytical stat panel — Total billed hero (₹30.00L) +
  Collection rate (76%) as a secondary stat, a single animated
  proportion bar (emerald collected / rose outstanding), Collected and
  Outstanding value rows, an actionable overdue row ("18 students past
  due · 51 with dues" — same source as the Pending Fees KPI and the
  Outreach tab), and an exact-semantics footnote. VLM review: **9/10**;
  parts now sum to the whole by construction.
- **Fee Collections trend**: zero-baseline Y domain with a nice rounded
  top tick (₹12L, not ₹11.88L), solid ₹0 baseline line, continuous
  month series (real zeros for payment-free months, human labels
  "Apr 26"), tooltip on the real series.
- **AreaTrendChart primitive** hardened for every consumer:
  non-negative data can never render a padded-negative domain.
- **Attendance trends**: honest derived Y domains (no clipped schools),
  correct tooltip series.
- **Finance module**: illustrative statements banner + labeled KPIs
  ("Illustrative · months reserve estimate", "only payroll is live").
- **Print documents**: every official document now prints the REAL
  school identity (useSchoolProfile cascade) — a Bluebell payslip prints
  Bluebell, not Greenwood; print-isolation CSS prints the document alone
  (no app shell/navigation) via `#print-root`.

## 6. Remaining intentional transitional areas

- **R2/R9/R17 static catalogs** (class/subject/fee-band previews,
  FEE_POLICY, receipt config): legitimate domain configuration;
  migration to FeeStructure master data documented in DATA_SOURCE_MAP.
- **R4 families are demo-gated, not server-hydrated** (except where APIs
  already exist): Messages/Inventory/Certificates/Downloads seeds render
  for the demo tenant only; real tenants see honest empties. Full
  server hydration (library/transport APIs exist) is the documented next
  step.
- **R3 finance statements**: labeled illustrative (banner + export
  filename); a real expense/ledger model is the planned permanent fix.
- **R8**: students-store keeps stale visible data on sync failure only
  for the demo tenant; production tenants get the honest retry state.
- **R6 exam corpora** (calendar exam events, certificates generate-tab
  picker): demo-gated; live exam-picker wiring awaits the exam-ops
  surface completion.
- Command palette entity results now wait for the server (250 ms
  debounce) — instant local entity matches were the fabrication vector.
- "Reconnecting…" ticker state observed during direct-localhost QA is
  the designed honest degrade when the socket path isn't routed
  (the sandbox gateway routes it in real preview usage).

## 7. Responsive QA results

Programmatic overflow sweep (document + main scroll width) at 375/390/
430/768/820/1024/1180/1280/1440/1920 on the Dashboard, plus Fee
Management, Students & Classes, Attendance, Examinations at 390px:
**zero horizontal overflow anywhere**. VLM reviews: mobile dashboard
charts row clean (390), Students module 8.5/10 (real 153-student
roster), Admissions mobile 8/10, final desktop 8.5/10.

## 8. Accessibility findings

- Redesigned card: stat rows are semantic text (not color-only), the
  proportion bar carries `role="img"` + a full aria-label
  ("Collected ₹22.75L of ₹30.00L billed (67%); outstanding ₹7.25L").
- Chart tooltips/primitives retain legend-based keyboard paths; the
  credentials sheet uses ordered-list semantics; print sheets keep
  document-level headings.
- LiveChip's `title` inflates the KPI button's accessible name (minor,
  LOW, left as-is — visible label is "live").
- Prior Phase-5 shell a11y (skip link, focus traps, aria-current)
  verified intact after shell polish.

## 9. Performance findings

- No new fetch storms: the Fee Collection card reuses the dues-summary
  store the KPI row already loads (coalesced `ensure()` — zero extra
  requests); the finance hook keeps its 60 s SWR cache + in-flight
  guard.
- Demo-gating actually REDUCES first-render work for production tenants
  (empty initial states instead of large seed objects).
- Dev-server restarts during QA were sandbox memory pressure (4 GB
  cgroup), not an application regression; production memory profile is
  unchanged by this gate.

## 10. Security regression results

- `schoolId` spoofing: hostile-client tests still pass (schoolId is
  session-derived server-side; unchanged).
- Tenant isolation suite: **57/57** (A→B cross-tenant reads/writes fail
  safe, no existence oracle).
- Platform isolation suite: **45/45** (MFA/step-up/rate-limits/support
  sessions, school⇏platform disjointness).
- Phase-7.5 product suite: **14/14** — includes the fee-aggregation
  mirrors updated to the corrected semantics (all-rows `paid` sum,
  SUCCESS-only trend).
- secrets-scan / headers / errors / validation / upload / audit /
  auth-core / rate-limit / file-signing / database-integrity /
  tenant-isolation-model: **0 failures**.

## 11. Test results

| Suite | Result |
|---|---|
| typecheck (`tsc --noEmit`) | **0 errors** |
| ESLint (all touched files) | **0 errors** (11 warnings, all `react-hooks/exhaustive-deps` — the documented pre-existing burn-down class) |
| Unit | 88/88 |
| Integration | 23/23 |
| API | 47/47 (1 cold-compile flake re-verified green) |
| Regression | 18/18 |
| Security | 217/217 across 14 files |
| E2E journeys | 5/5 |

Environmental note: two full-suite runs hit mid-suite "connection
refused" clusters — the dev server being OOM-killed by route-compilation
memory spikes inside the 4 GB sandbox cgroup (the documented sandbox OOM
class from Phase 7.5). Every affected file was re-run against a warm
server and passed cleanly; no code defect was involved.

## 12. Build result

**VERIFIED 2026-09-30 (pre-Phase-8 final verification): `next build` EXIT 0,
no bypasses.** The originally-deviated item (build "not run in sandbox")
was closed by the final verification pass: `NODE_ENV=production next build
--webpack` with `NODE_OPTIONS=--max-old-space-size=3072` (heap sized to
the 4 GiB cgroup) compiled all routes in 69s, completed the TypeScript
phase with `ignoreBuildErrors` absent, emitted the full route table
(every API route, platform page, health probe, middleware/proxy), and the
`output: "standalone"` bundle booted in 119ms with `/health/live`,
`/health/ready`, `/` and `/api/schools/public` all answering 200.

Why the engine note: the default Turbopack build engine OOM-kills inside
this sandbox (Turbopack's resident ~2.5 GiB + the TypeScript build
worker's ~1.5–2.5 GiB cannot coexist under the 4 GiB cgroup — the worker
was SIGKILLed mid-type-check). The webpack engine keeps compile + type
phases in one heap-capped worker and fits. On GitHub CI runners (7 GB+)
the default engine is unaffected; `bun run build` remains the CI command.
Type-safety is independently gated by `tsc --noEmit` (0 errors, re-run
this verification). Build-time diagnostics observed (informational, not
failures): Next 16.1.3's `middleware` → `proxy` file-convention
deprecation warning, and Edge-runtime static-analysis flags on
`src/instrumentation.ts`'s guarded `process.on` handlers (the file is
runtime-safe via its `NEXT_RUNTIME === 'edge'` early-return; a future
refactor to the canonical node-only dynamic-import split would silence
them).

## 13. Browser QA result

Live principal session (demo tenant) across Dashboard, Admissions,
Messages, Library, Transport, Inventory, Certificates, Calendar,
Downloads, Students, Fees, Attendance, Examinations; a second session as
the Bluebell (non-demo) principal verifying honest empty states in every
demo-gated module; login → dashboard → module navigation exercised both
ways. 15 screenshots in `qa-shots/final-gate/`, VLM-reviewed where
visual judgment mattered. No blank screens, no error boundaries, no
hydration crashes in dev.log during QA.

## 14. Known limitations

- ~~Production build not re-run in-sandbox~~ — **closed by the pre-Phase-8
  verification** (see §12, §16): fresh `next build` EXIT 0 + standalone
  boot test, no bypasses.
- The notification bell badge renders slightly cramped at some widths
  (LOW; cosmetic).
- `react-hooks/exhaustive-deps` warning backlog (11 on touched files,
  pre-existing class; 61 warning-level project-wide, 0 errors).
- R4 store families are gated rather than server-hydrated (honest, but
  hydration is the better end-state; documented).
- Teacher analytics trend charts use recharts' auto domain (fine for %
  trends; flagged if future money trends adopt that component).
- Platform console charts: none render `methodTrend` today — the API
  data exists but the console surfaces tables/stats instead (no defect;
  future chart work belongs to the platform roadmap).
- In-sandbox Turbopack builds OOM under the 4 GiB cgroup (engine-level
  constraint, documented in §12; CI runners unaffected).
- CI remains parked at `.github/ci.yml.disabled`: the push token has
  `repo` scope only (no `workflow` scope), so GitHub rejects workflow-file
  pushes. Restore via web-UI rename or a workflow-scoped PAT (§16).

## 15. Final acceptance checklist

- [x] No obviously broken or misleading dashboard visualizations
- [x] Fee Collection visualization redesigned (donut → stat panel, 9/10 VLM)
- [x] Fee Collection trend mathematically meaningful (zero baseline, SUCCESS-only, continuous months)
- [x] Financial numbers have clear definitions (billed = collected + outstanding holds; footnote states sources)
- [x] No fabricated operational data in production flows (E-class fixed: print identity, statements label, store gating, palette merge, completion claims; demo tenant is the sanctioned exception by design)
- [x] Major modules have intentional loading states (skeletons/Loading… verified)
- [x] Major modules have intentional empty states (Bluebell session verified)
- [x] Major modules have intentional error states (retry affordances preserved/wired)
- [x] Major modules respect permission boundaries (role gates unchanged; suites green)
- [x] School branding consistent (documents print real tenant identity)
- [x] Platform branding separate (platform console untouched, suites green)
- [x] Navigation coherent (shell polish only; no regressions)
- [x] Typography coherent
- [x] Spacing coherent
- [x] Cards/tables/forms coherent
- [x] Responsive QA completed (10 breakpoints, 0 overflow)
- [x] Mobile/tablet/desktop layouts work (VLM 8–8.5/10)
- [x] Print/PDF outputs reviewed (identity cascade + print isolation)
- [x] Accessibility baseline reviewed (§8)
- [x] Performance reviewed (§9)
- [x] Security regression tests pass (§10)
- [x] Tenant isolation tests pass (57/57)
- [x] TypeScript passes (0 errors)
- [x] ESLint passes (0 errors)
- [x] Automated test suite passes (398/398 across suites)
- [x] Production build passes — **VERIFIED 2026-09-30**: fresh `next build` EXIT 0, standalone boot test 200s, `ignoreBuildErrors` absent (§12, §16)
- [x] Browser QA passes (both tenants)
- [x] No critical/high product-quality issue remains

**Verdict: FINAL PRODUCT EXCELLENCE GATE — COMPLETE · VERIFIED.**
All 29 checklist items pass with zero deviations: the single previously
-deviated item (production build re-run) was closed by the pre-Phase-8
verification pass below. The project is cleared to proceed to PHASE 8A —
SUPABASE.

## 16. Pre-Phase-8 final verification record (2026-09-30)

A container restart mid-verification wiped all git-ignored runtime state
(`db/`, `.next/`, `dev.log`, `uploads/`) and — via the restore tarball's
`--exclude='upload'` pattern — also dropped every source directory named
`upload/` (7 API route files, restored byte-identical from git) and
mode-drifted the tree (neutralized with `core.fileMode=false`; content
verified identical via `git diff --quiet`). The verification then rebuilt
the environment from the committed artifacts and surfaced three latent
defects that only a fresh-database replay can expose — exactly the class
CI was designed to catch but never ran (workflow parked since the PAT
lacks the `workflow` scope):

1. **Migration lineage could not deploy on a fresh database.**
   `phase6_platform_control_plane` rebuilt the `School` table
   (CREATE→INSERT→DROP→RENAME); SQLite's RENAME re-parses every trigger,
   and the tenant-guard triggers referencing `School` aborted with
   `no such table: main.School` (P3009). Fixed additively (`ALTER TABLE
   ADD COLUMN featureFlags` — the rebuild's only real delta; slug/code
   unique indexes already existed in `0_init`).
2. **Migration↔schema drift (CI Gate 3b would fail).** `phase75` shipped a
   `DEFAULT '1970-01-01'` epoch on `Notification.updatedAt` (schema:
   `@updatedAt`, no DB default) and a `(schoolId, status)` index the
   schema does not declare, while omitting nothing else. Fixed to exact
   parity; `prisma migrate diff` now reports **no difference** on a fresh
   deploy.
3. **Test fixtures incomplete on the canonical CI seed set.**
   `seed-teacher-academics` wrote `Class.classTeacherId` as `Teacher.id`
   while the app APIs, the guard triggers and `seed-teacher-hub` all use
   **User-id** convention (only visible on a trigger-guarded, migrate-
   deployed DB) — fixed to `.userId`. The tenant-isolation matrix read
   School-A room/grade-scale/exam-type probe rows that no canonical seed
   created (they historically came from a one-off data migration + live
   usage) — now provisioned in `seed-tenant-isolation`. The demo tenant's
   website CMS document (hero/gallery/identity) had a dedicated seed
   (`prisma/seed-website-cms.ts`) that was missing from the CI seed step
   — added (`bun run db:seed-website-cms`, script added to package.json;
   CI file updated).

**Verification results (all at HEAD = the gate commit):**

| Check | Result |
|---|---|
| Fresh `migrate deploy` (CI Gate 3) | 6/6 migrations applied cleanly |
| `migrate diff` drift (CI Gate 3b) | No difference detected |
| Production build (CI Gate 4 equivalent) | **EXIT 0** — webpack engine, 69s compile, TS phase clean, full route table, `ignoreBuildErrors` absent |
| Standalone boot test | Ready in 119ms; `/health/live`, `/health/ready`, `/`, `/api/schools/public` all 200 |
| `tsc --noEmit` | 0 errors |
| `eslint .` | 0 errors (61 warning-level, documented class) |
| Full test suite | **437/437 pass** (unit/integration/API/regression/security) |
| E2E journeys | **5/5 pass** |
| Dashboard visual (VLM, focused) | 9/10 — zero-baseline confirmed, no overlap/clipping |
| Fee Collection semantics | UI ≡ API ≡ DB: billed ₹30.00L / collected ₹21.38L / outstanding ₹8.63L (billed = collected + outstanding holds), rate 71%, 56-with-dues / 22-past-due agree across card, KPI and defaulters API; the 6-month SUCCESS-payment trend sums to exactly the collected figure |
| Real-tenant honesty (Bluebell) | Dashboard shows real fixture data (1 student, ₹12.0K real dues, 0% attendance); Messages "Inbox is clear", Library "No books in the catalogue yet", Transport "No routes found", Inventory "No items found" — zero seeded demo content leaks |
| Prisma datasource | `sqlite` (unchanged — Phase 8A has not started; no Supabase/Vercel/Resend deps, imports or services exist) |
| CI configuration | `.github/ci.yml.disabled` (PAT scope: `repo` only — no `workflow`); restore via GitHub web-UI rename or a workflow-scoped PAT; CI seed step corrected in the same pass |

Environment notes: the sandbox DB was rebuilt from migrations + the full
seed suite (absolute figures differ from the pre-incident sandbox — that
long-lived state is gone with the recycle; the canonical seeds are the
reproducible baseline and every semantic invariant above was proven on
them). The project's own keepalive watchdog (v3) + paced chunk warmer was
restarted after the container recycle and now supervises the dev server;
the earlier "lazy-compilation backend unreachable" console symptom was
the container-restart window itself. Evidence: `qa-shots/pre8-verify/`
(dashboard 1440 + charts-row + 390px fee panel + Bluebell module states).

**GATE VERDICT: FINAL PRODUCT EXCELLENCE GATE — COMPLETE · VERIFIED.**
Cleared for PHASE 8A — SUPABASE POSTGRESQL.
