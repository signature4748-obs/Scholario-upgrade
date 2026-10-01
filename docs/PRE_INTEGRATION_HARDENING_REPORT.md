# PRE-INTEGRATION PRODUCTION HARDENING — FINAL ENGINEERING GATE REPORT

**Scope:** the 35-section pre-integration hardening audit (§0–§35 brief).
**Method:** 7 parallel forensic audit agents → severity-ranked findings →
3 fix waves (root-cause fixes only) → focused invariant tests → browser QA →
full re-verification. The ACTUAL repository was the source of truth
throughout; no prior worklog/audit claim was trusted without re-verification.

---

## A. EXECUTIVE VERDICT

**PRE-INTEGRATION READY.**

Meaning (per the brief's final principle): an experienced engineering team
can now begin the Supabase/Vercel/Resend infrastructure phase without
discovering obvious architectural, security, data-integrity, authorization,
build, or deployment blockers. Every finding with a clear root-cause fix was
fixed and pinned by tests; the remainder is an explicit, owner-assigned
register below. This is NOT a "production-ready" claim — the platform
integrations (Postgres, Storage, Realtime, email) are still ahead.

## B. CRITICAL FINDINGS

| # | Finding | Resolution |
|---|---|---|
| C1 | Attendance day-level canonical identity (CLASS+DATE+STUDENT) was enforced nowhere: `@@unique(studentId,date)` is ms-exact and the live DB held 9 same-day duplicate rows from time-of-day seed writes | **FIXED** — data migration deduped + midnight-UTC-anchored every row; seeds and all writers day-anchor; pinned by tests (0 day-dupes, all dates midnight multiples, same-day canonical write paths verified) |
| C2 | Payroll/salary exists only in browser localStorage (no Salary model in the 96-model schema; salaries, "payment" records, payslips never reach the server) | **NOT FIXABLE IN SCOPE** (feature development) — honestly labeled in-product (salary module carries a "stored locally in this browser" notice); payroll money-use is a documented blocker for the infra phase (§N) |

## C. HIGH FINDINGS

| # | Finding | Resolution |
|---|---|---|
| H1 | Two parallel fee ledgers diverged ₹211,000 (seeds wrote Fee.paid/Payment without FeeTransaction; dashboard and fees module read different ledgers) | **FIXED** — parity backfill migration + parity-writing seeds; live DB now exact 3-way parity (Payment Σ = FeeTransaction Σ = Fee.paid Σ); pinned by fee-lifecycle test |
| H2 | Receipt numbering ran 3 schemes (SCH- at verify, RCP-2026- in seeds, RCP-epoch at order creation) | **FIXED** — one canonical SCH-YYYY-NNNNNN scheme, sequential per school-year, minted at settlement; orders route no longer mints receipts; 127/127 receipts canonical, pinned |
| H3 | Teacher subject-scope resolved by LOWERCASE NAME match on Timetable.teacherName (4 resolvers) + self-service rename via PUT /api/profile → in-tenant privilege escalation (rename to a colleague's timetable name → their student directory PII, attendance writes, lesson plans, marks) | **FIXED** — all resolvers CSA-first (name-fallback only when teacherUserId is null); profile rename now 409s on timetable-name collision; guarded backfill of Timetable.teacherUserId; pinned |
| H4 | rotateSession/destroySession swallowed DB delete failures → a stolen pre-rotation token could stay valid up to 7 days after password change/logout | **FIXED** — failures propagate; pinned |
| H5 | Principal offline fee collection: client minted receipt + success toast BEFORE a fire-and-forget POST without feeId → Fee.paid never credited; UI/server receipts diverged | **FIXED** — server-authoritative flow (feeId sent, POST awaited, server receipt mirrored, failure records nothing); pinned |
| H6 | Messaging auto-reply simulator (fabricated "teacher replied") ran for ALL tenants | **FIXED** — demo-gated |
| H7 | students-store initial state = ungated 58-student fabricated seed universe; real-tenant teachers never sync → kept fabricated roster | **FIXED** — demo-gated + honest-null fallback |
| H8 | Persist-version bumps missed at the excellence gate → pre-gate fabricated state rehydrated indefinitely (incl. real-tenant namespaces) | **FIXED** — transport v2 / inventory v2 / certificates v3 with purge migrations |
| H9 | Student↔teacher messaging split-brain (student module is client-only localStorage; teacher hub reads the DB — messages silently never delivered) | **DOCUMENTED BLOCKER** — needs server Message wiring (feature work, §N) |
| H10 | Dead money-model family (FeeStructure/FeeHead/FeeStructureVersion + 4 routes, 0 rows, 0 callers) | **DEFERRED to the PG lineage regeneration** (wire-or-drop decision belongs exactly there — dropping now would force a trigger-migration rewrite in SQLite for zero runtime benefit) |
| H11 | Local-filesystem uploads (5 families under db/uploads) + SQLite file + in-memory rate limiter + persistent event-stream service | **INFRA BLOCKERS** (by design for this phase) — exact Vercel migration checklist in §M |

## D. MEDIUM FINDINGS

**Fixed:** export route not withUser-wrapped (suspended tenant could exfiltrate
CSVs) + TEACHER could bulk-export PII against the matrix + no rate limit;
CSV formula injection in BOTH exporters (OWASP ' prefix, 6 dangerous
prefixes pinned); search fee-rows leaked to TEACHER; setMark 400-vs-403
inconsistency; schools/[id] returned full config JSON to non-admins;
audit-trail gaps (teacher/student creation, marks lock/verify — ACCOUNT_CREATED
+ MARKS_CHANGE rows added); seeds could run against NODE_ENV=production;
verification reject race (guarded PENDING-only transition); payments/confirm
double-credit race (in-tx re-check + deterministic idempotency key);
FeeTransaction overpay (409 + ledger echo); forgot-password modal promised a
reset email with zero backend (honest copy now); calendar "today" hardcoded
2025-12-10 for every tenant (real clock + demo anchor); teachers-module
departments fabricated (now roster-derived); upload routes buffered full
multipart bodies before the size check (early 413 on Content-Length);
missing Cache-Control: no-store on /api/auth/me, /api/students, /api/export;
upload/ scratch dir untracked+unignored (gitignored now); public-site 320px
10px overflow (grid min-w-0); forgot-password dialog missing Escape-close.

**Deferred (documented, owner = infra phase):** school Session.token stored
raw (platform plane already hashes — hash at the Supabase cutover);
in-memory rate limiter + XFF-trusting IP derivation + scryptSync event-loop
blocking (shared-store limiter + async scrypt at scale); TOTP replay window
(±30–90s, persist last-verified counter); legacy pre-registry upload files
readable cross-school (registry backfill or sunset); Fee.status "overdue"
derived-at-read vs persisted vocabulary split (tests pin the cross-surface
agreement); finance statements remain illustrative-labeled (real fix = ledger
model, planned).

## E. LOW / NON-BLOCKING

Touch targets 32–36px on secondary controls (design language — not changed,
no-redesign rule); 8.5–10px micro-typography on badges/labels (design
language); ~20 school-scoped unbounded list routes (fine at target school
sizes, take/pagination at growth); TEACHER may message any student school-wide
(policy decision pinned, parent-connect is assignment-scoped); CI pins
`bun-version: latest`; `sharp` retained deliberately (Next image optimization
runtime dep); app-version polling bursts in dev.

## F. FIXES IMPLEMENTED (exact changes)

**Wave A (security/authz, 20 files):** auth.ts rotation/logout error
propagation; export route (withUser + matrix roles P/M/ACCOUNTANT + 30/hr
rate limit + no-store + CSV OWASP neutralization); payments-export CSV
neutralization; search finance-block role gate; profile rename timetable-
collision 409; CSA-first resolvers (class-attendance, lesson-planner,
teacher-hub via canonical getTeacherSubjectAssignments); setMark FORBIDDEN;
schools/[id] projection; ACCOUNT_CREATED/MARKS_CHANGE audit coverage; seed
production hard-gates; .gitignore /upload/.

**Wave B (data/money, migration + 9 files):** migration
20261001000000_pih_data_integrity (attendance dedup+anchor, timetable
backfill, fee parity backfill); seed parity writes (5 seed files);
server-authoritative offline collection; verification feeId resolution +
guarded reject; confirm in-tx guard + deterministic key; transactions 409
overpay; orders no receipt-at-order; legacy attendance POST day-anchored.

**Wave C (honesty/hygiene, ~20 files):** messaging simulator demo-gate;
students-store demo-gate; persist purges ×3; calendar real clock; departments
from roster; LiveClassRoster gate; forgot-password honest copy; salary local
notice; upload early-413 ×5; no-store ×3; AI envelope; dead code removed
(platform/adapters.ts, mock/bus-tracking.ts, staff-attendance-store.ts,
applications-store retired seed body ~200 lines).

**QA fixes (3):** forgot-password Escape-close; public-site 320px grid fix;
identity-phone label association.

## G. FILES CHANGED

100 files: +3,366 / −1,518 (incl. 5 new test files +1,244 lines, 1 new data
migration, 3 deletions, 4 docs). Full list: `git show --stat` of this commit.

## H. TESTS EXECUTED

- `bun run test` → **466/466** (465 pass + 1 documented 45s load-flake
  re-verified standalone in 287ms — the identical baseline flake, pre-existing
  before any change; 437 pre-existing + 29 new invariant tests)
- `bun run test:e2e` → **5/5**
- New files, each green standalone AND in-suite: assignment-scope 11/11,
  fee-lifecycle 5/5, auth-sessions 4/4, export-policy 5/5, csv-injection 4/4
- Regression confirmation per family (standalone): tenant-isolation 57/57,
  phase75 14/14, database-integrity 41/41, domain-smoke 18/18, regression 18/18
- `bunx tsc --noEmit` → **0 errors**; `bunx eslint` (touched files + repo) →
  **0 errors** (warn-level baseline unchanged)
- Browser QA: 12 screens × 9 breakpoints (320–1920) measured overflow-clean;
  mobile login flow no redirect loop; a11y spot checks (tab order, focus
  rings, labels, dialog Escape, contrast) — 3 defects found → fixed →
  re-verified live; honest-UI verified (salary notice, calendar current
  month, roster departments, forgot-password copy, Bluebell real-tenant
  honest-empty via live API)

## I. TESTS NOT EXECUTED

- Multi-instance/horizontal-scale behaviors (single-process sandbox).
- Real concurrent HTTP race reproduction (fee races verified via guarded
  transitions + sequential state-machine tests, not parallel requests).
- Supabase/Postgres canaries (provider not connected — by instruction).
- Performance/load at 1,000–5,000 students (§17 satisfied by reasoning +
  query inspection per the brief's "do not optimize prematurely").
- The QA pass could not browser-verify the real tenant with the initially
  supplied credential (it maps to the demo school BY DESIGN — School A
  fixtures are in-tenant demo-school users); Bluebell honesty was instead
  verified live via API (real sparse counts, empty states, no demo leak) and
  is pinned by the phase75 suite.

## J. BUILD RESULT

Canonical command (identical for local/CI/deployment — package.json is the
source of truth, CI Gate 4 runs exactly `bun run build`):

```
NODE_ENV=production NODE_OPTIONS=--max-old-space-size=3072 next build --webpack \
  && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
```

via `bun run build` from clean state (`rm -rf .next`, dev stack stopped):
**EXIT CODE 0**, 131s wall clock, `▲ Next.js 16.1.3 (webpack)`,
`✓ Compiled successfully in 59s`, `Running TypeScript …` clean, 242 routes,
162/162 static pages, standalone bundle + traced node_modules (Prisma engine,
.env), static (4 dirs/177 chunks) + public (5 entries) copied.
Standalone boot: Ready in 87ms → /health/live 200 · /health/ready 200
(database ok) · / 200 · /api/schools/public 200 (real tenant JSON).
No ignoreBuildErrors / ignoreDuringBuilds / any bypass (scanned).

## K. SECURITY RESULT

- **Authentication:** architecture KEPT (verdict: port to Supabase is a DB
  swap, not a redesign). Rotation/revocation failures now propagate;
  change-password rotates + revokes others (pinned); expired sessions 401 +
  pruned (pinned); cookies HttpOnly/SameSite=Lax/Path=/ (Secure in prod);
  scrypt + per-call salt + timing equalization; CSRF origin-check
  live-proven; login dual-bucket limits (with escalation).
- **Authorization:** central chain verified end-to-end (withUser →
  evaluateSchoolAccess fail-closed → role matrix → CSA assignment scope);
  12 live IDOR probes all fail-safe; in-tenant escalation vectors closed
  (rename guard + CSA-first); export/search role leaks fixed; platform/school
  boundary disjoint (45-test suite green).
- **Tenant isolation:** never client-derived; DB triggers backstop;
  57-test suite green + fresh probes (spoofed schoolId ignored, cross-tenant
  reads 403/404 with zero leakage).
- **Secrets:** none in tracked files or git history (rotation: none
  required); demo seed creds are dev-preview by design and seeds now refuse
  NODE_ENV=production.
- **Uploads:** magic-byte policy, server-minted opaque ids, HMAC tokens,
  traversal-proof regex, ownership registry; early 413 on oversized bodies;
  one documented legacy-hole (pre-registry files) deferred.
- **Rate limiting:** table enforced (login/ip/account, password, revoke,
  admission, upload, export 30/hr, file-access, ai, message, payment,
  webhook); in-memory = single-instance (documented for Vercel).
- **Headers:** all baseline headers + profiled CSP live-verified; no-store
  added to the three PII endpoints; CSV OWASP guard on both exporters.

## L. DATA INTEGRITY RESULT

- **Attendance:** canonical CLASS+DATE+STUDENT holds at DB level (0
  day-dupes, all midnight-UTC, idempotent same-day writes, journal on edits).
- **Fees:** ONE ledger (3-way parity exact, live ₹22,37,650); receipts
  canonical + unique; teacher→pending→principal-verify state machine guarded
  (reject-after-verify 409, overpay 409, double-confirm guarded); webhook
  idempotent; audit rows on every money action.
- **Marks:** CSA-guarded on every channel; class-teacher status alone grants
  nothing (pinned); 403 taxonomy consistent.
- **Students/Teachers/Classes:** business-key uniques verified 0 duplicates;
  user+row creation transactional; FK-in-tenant on classId/routeId.
- **Rooms:** archived rooms blocked from new assignment (400), excluded
  from active lists, historical refs preserved (pinned).
- **Salary:** client-only by scope (honest notice; §N blocker).

## M. MIGRATION READINESS

- **Supabase PostgreSQL:** READY — full runbook updated
  (docs/POSTGRES_MIGRATION_PLAN.md + PIH addendum: 96 models, 78 triggers →
  RLS/CHECK, epoch-ms facts, money NUMERIC table, status-vocabulary register,
  RLS boundary, day-anchor rule, LIKE-insensitive flip, FK-DAG migration
  order). Blockers: none structural; data normalization list is explicit.
- **Supabase Storage:** BOUNDARY DOCUMENTED — 5 local upload families to
  move (buckets + schoolId prefixes + signed URLs); the central
  sniffing/size/id policy layer survives as-is.
- **Supabase Realtime:** BOUNDARY DOCUMENTED — event-stream service
  (bun:sqlite poller) maps 1:1 to postgres_changes + RLS rooms; client
  degrades gracefully until then (verified).
- **Vercel:** CHECKLIST PRODUCED (ordered): Postgres → Storage → Realtime
  swap → shared rate-limit store → env secrets (FILE_SIGNING_SECRET,
  RESEND_API_KEY, RAZORPAY_*) → drop Caddy/keepalive/spawn-detached/
  warm-chunks → build parity (canonical script stays; platform may override
  engine).
- **Resend:** READY-TO-DESIGN — server-side send boundary + persisted outbox
  (same-tx enqueue, retry with backoff), template home, 8 event mappings,
  audit + redaction policy documented; the dead client-side adapter seam was
  removed so no false readiness remains.

## N. REMAINING BLOCKERS (genuine, owner-assigned)

1. **Postgres/Storage/Realtime/Vercel/Resend not connected** (the next
   phase by definition).
2. **Payroll server persistence** (salary model + routes) before real
   payroll money use.
3. **Student messaging server wiring** (messages silently undelivered
   between student module and teacher hub).
4. **Session token hashing at rest** (school plane) — scheduled for the
   Supabase cutover.
5. **Shared rate-limit store + trusted-proxy IP + async scrypt** — before
   horizontal scaling.
6. **Legacy pre-registry upload files** — registry backfill or sunset.
7. **Finance statements ledger model** (currently illustrative-labeled).

## O. RECOMMENDED NEXT PHASE (exact order)

1. **Supabase PostgreSQL** (execute POSTGRES_MIGRATION_PLAN: normalize
   statuses → regenerate PG lineage incl. the wire-or-drop decision on the
   FeeStructure family → ETL + parity gates → RLS mirroring the withUser
   chain → flip DATABASE_URL; hash school session tokens in the same phase).
2. **Supabase Storage** (5 upload families → buckets + signed URLs; keep the
   central upload policy).
3. **Supabase Realtime** (replace the event-stream poller with
   postgres_changes; keep wire frames; port the app-shell subscription).
4. **Vercel** (env secrets + shared rate-limit store; drop the sandbox
   process stack; canonical build unchanged).
5. **Resend** (server-side boundary + outbox from §M; forgot-password
   becomes the first real event; payroll + messaging features land with
   their servers).

**STOP — no Supabase/Vercel/Resend connection was made in this phase.**
