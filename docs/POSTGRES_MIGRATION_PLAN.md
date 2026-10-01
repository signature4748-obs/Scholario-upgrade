# SCHOLARIO-OS — POSTGRES MIGRATION PLAN (PHASE 3 deliverable)

> Status: **PLAN ONLY — no migration executed** (per Phase-3 constraints:
> production Supabase is not connected yet, mock data is not removed yet).
> Source of truth for current state: `docs/DATABASE_INTEGRITY.md`.
>
> This is the runbook for moving Scholario-OS from local SQLite
> (`db/custom.db`, **96 models** as of the pre-integration hardening audit,
> 7 versioned migrations) to managed
> PostgreSQL (target: Supabase) WITHOUT weakening a single Phase-1/2/3
> invariant — ideally strengthening them (RLS, CHECK constraints,
> partial unique indexes, ENUMs, FTS).
>
> PIH CORRECTIONS (2026-10-01, audit-verified against the live DB):
> · DateTime storage is **INTEGER epoch-ms** (NOT TEXT) — verified
>   `typeof(date)=integer`; Prisma-client ETL converts automatically;
>   raw COPY needs `to_timestamp(ms/1000.0)`.
> · The trigger census is **78** (64 tenant-guards + 14 bound-guards +
>   JobRun ×2), not 62.
> · Status vocabularies are STRING-typed with live mixed-case drift
>   (e.g. Exam.status `Scheduled` vs `SCHEDULED`) — normalize + CHECK
>   BEFORE enum creation (§ PIH addendum).

---

## 1. Objectives & non-objectives

**Objectives**
1. Reproduce the current schema + all Phase-3 constraints on Postgres.
2. Replace SQLite-specific guard mechanisms (triggers) with native,
   stronger Postgres mechanisms (CHECK constraints, partial unique
   indexes, RLS).
3. Migrate the data with provable integrity (row counts, checksums,
   invariant re-runs).
4. Zero-downtime cutover with rollback.

**Non-objectives (explicitly out of scope for the migration itself)**
- Changing the application's Prisma client surface (queries stay as-is;
  provider swap + type mapping only).
- Fixing the N+1 residuals / unbounded reads of DATABASE_INTEGRITY §11/§12
  (they remain documented; Postgres makes them cheaper, not free).
- Vercel/Resend/email/provider moves.

## 2. Current state (what must be reproduced)

| Mechanism | SQLite today | Postgres target |
|---|---|---|
| Tenant scoping | `schoolId` column on every tenant row + Phase-2 service guards | same + **RLS policies** keyed on `current_setting('app.school_id')` / JWT claim |
| Cross-school FK safety | 78 BEFORE INSERT/UPDATE triggers (migration `db_level_guards`) | composite FKs where cheap, else **CHECK-free triggers** retained OR RLS + FK validation; prefer `tenant_id` composite FK pattern on hot tables |
| Marks ≤ maxMarks, money > 0, paid ≤ amount, available ≤ copies | 14 bound-guard triggers | native **CHECK constraints** (single-row) + one trigger only for the cross-table mark-vs-config check |
| Business-key uniqueness | 46 `@@unique` (NULLS DISTINCT) | same + **partial unique indexes** for the two NULL-bypass gaps |
| Idempotency keys (eventId, transactionId, receiptNo, referenceNumber, …) | `@unique` columns | same (UNIQUE indexes) |
| Money | `Float` | `NUMERIC(12,2)` (money) / keep `Int` minor-units where already integer |
| Dates | `DateTime` (INTEGER epoch-ms; day-anchored columns are exact midnight-UTC multiples) / `String` (YYYY-MM-DD) | `TIMESTAMPTZ` / `DATE` (map `date`-string columns; `to_timestamp(ms/1000.0)` for raw COPY) |
| Status strings | `String` + zod whitelists | native **ENUM types** (status catalogs in DATABASE_INTEGRITY §3/§9) with `ALTER ... ADD VALUE` governance |
| Search | `LIKE '%q%'` scans | **pg_trgm** GIN indexes (then optionally FTS/tsvector) |
| Sessions | opaque token table | same (token_hash unique, userId index) — consider Supabase Auth later |
| Migrations | prisma/migrations (SQLite dialect) | **regenerated migration lineage for Postgres** (§4) |

## 3. Type & constraint mapping table (per model family)

| SQLite column | Postgres type | Notes |
|---|---|---|
| `School.id/Student.id/...` (cuid TEXT PK) | `TEXT` PK (keep cuids) | do NOT switch to uuid mid-migration — identity continuity beats purity; new rows may use gen_random_uuid if desired |
| `Fee.amount/paid`, `Payment.amount`, `FeeTransaction.amount`, `Settlement.*`, `Route.fare`, `MasterFeeHead.amount`, `FeeHead.amount` | `NUMERIC(12,2)` | migrate via bulk cast; reconcile Σ casts == SQLite sums (Float → NUMERIC is exact for 2-decimal data; verify) |
| `Attendance.date`, `ExamScheduleItem.date`, `NoHomeworkDate.date` (DateTime) | `DATE` (UTC) | prisma `@db.Date` |
| `StudyMaterial/...` n/a (String dates not used here) | — | — |
| `createdAt/updatedAt` (DateTime) | `TIMESTAMPTZ` `DEFAULT now()` | prisma `@db.Timestamptz(3)` |
| Status/role/audience columns | ENUMs: `user_role`, `session_status`, `attendance_status`, `exam_status`, `exam_mark_status`, `fee_status`, `fee_txn_status`, `fee_txn_source`, `payment_method`, `webhook_event_status`, `homework_status`, `notification_audience`, `growth_category`, … | 1:1 with the whitelists already enforced in zod + service code; unknown values fail closed |
| JSON-in-TEXT (`GrowthRule.params`, `AttendanceDraft.entries`, `Homework.attachments`, `FeeStructureVersion.snapshot`, `WebhookEvent.rawPayload`) | `JSONB` | document shapes stay in code |
| `Timetable.day` (free string) | keep TEXT (day names are school-configurable) + CHECK in ('Monday',…,'Sunday', local names)? → keep free, document | — |

**Constraint upgrades (the Postgres bonus round):**
1. `CHECK (paid >= 0 AND paid <= amount)` on `Fee`.
2. `CHECK (amount > 0)` on `Payment` + `FeeTransaction`.
3. `CHECK (available >= 0 AND available <= copies)` on `LibraryBook`.
4. `CHECK (marks >= 0 AND marks <= total_marks)` on `Result`.
5. `CHECK (marks_obtained IS NULL OR marks_obtained >= 0)` + grace `>= 0` on `ExamMark`; the ≤-max check stays a trigger (cross-table).
6. `CHECK (period >= 1)` on `Timetable`.
7. Partial unique indexes:
   - `CREATE UNIQUE INDEX ... ON Timetable(teacher_user_id, day, period) WHERE school_id IS NOT NULL AND teacher_user_id IS NOT NULL;` (closes the teacher NULL-bypass)
   - `CREATE UNIQUE INDEX ... ON FeeStructure(school_id, class_id) WHERE status = 'current';` (frees archived history while keeping one-current)
   - `CREATE UNIQUE INDEX ... ON BookIssue(book_id, student_id) WHERE status = 'ISSUED';` (one active issue per book+student)
8. `pg_trgm` GIN indexes on `Student` names (firstName/lastName via User), `Teacher` name, `LibraryBook.title` — turns the search endpoints' `LIKE '%q%'` into indexed scans.
9. **RLS on every tenant table**: `USING (school_id = current_setting('app.school_id')::text)` with the app setting it per request from the session (Prisma: `prisma.$executeRaw`SET app.school_id=...`  in a request-scoped extension, or Supabase JWT claim). Super-admin paths use `BYPASSRLS` role or a platform role with explicit `app.school_id IS NULL` policies. This makes the DB itself refuse cross-tenant reads — the strongest form of the Phase-2 invariant.
10. Composite FK hardening (optional but recommended on the hottest
    tables): give `Student`, `Class`, `Subject`, `Exam`, `Fee` a
    `UNIQUE(id, school_id)` and change child FKs to
    `(student_id, school_id) REFERENCES Student(id, school_id)` — the
    "tenant-scoped FK" pattern. Apply where query plans tolerate it;
    RLS + triggers already cover the semantics.

## 4. Migration strategy (big-bang is acceptable here — here's why, and the alternative)

The data set is small (≈160 students, 4.3k attendance, 686 marks, 131
payments, 120 fee transactions, 2 schools) — a **big-bang with a
maintenance window** is the honest recommendation:

**Phase A — dry run (repeatable, zero risk)**
1. Stand up a scratch Postgres (Supabase project or local container).
2. `datasource provider = "postgresql"` in a branch of `schema.prisma`
   (keep the SQLite lineage intact on main until cutover).
3. Regenerate the migration lineage for Postgres:
   `prisma migrate diff --from-empty --to-schema-datamodel <pg-schema> --script > pg_baseline.sql`
   → hand-edit to append the CHECK constraints, partial unique indexes,
   ENUM creation, pg_trgm extension + RLS policies (§3). This becomes
   `migrations_pg/0001_baseline/`.
4. ETL script (Node/bun, reads SQLite via Prisma, writes Postgres via
   Prisma batched `createMany` in FK-dependency order): School → User →
   Session → Teacher/Student/Parent-ish → Class/Subject/Room → CSA →
   Exam family → Attendance → Fee family → everything else. Money
   columns cast explicitly; cuids preserved.
5. Run the verification gate (§5) against the scratch Postgres. Iterate
   until green.

**Phase B — cutover (one maintenance window, minutes of downtime)**
1. Freeze writes (gateway maintenance flag / read-only mode).
2. Final delta ETL (re-run the idempotent ETL — it upserts by PK).
3. Point `DATABASE_URL` at Postgres + provider swap on main + deploy.
4. Re-run the full gate on production. Unfreeze.
5. **Rollback plan**: keep `db/custom.db` untouched + the SQLite
   migration branch; revert `DATABASE_URL` and re-enter read-only until
   the forward-fix lands. Data written after cutover is reconciled via
   the payment/attendance idempotency keys (safe because every money
   row carries a unique txnId/receiptNo).

**Alternative (only if the window is unacceptable later):** dual-write
via a Prisma extension writing to both DBs during a soak period, with
the Postgres side gated to reads after checksum parity — NOT
recommended now: dual-write doubles the write-path surface that
Phase 3 just made single-writer and idempotent, and the dataset does
not justify it.

## 5. Validation gates (must ALL pass on the Postgres side)

1. `bun run test:security` → 246/246 (the 41 database-integrity tests +
   the 29 PIH invariant tests
   are provider-agnostic by design: they assert P2002/P2003 semantics,
   upsert idempotency, ledger math, cascade behavior — all of which
   hold on Postgres; the trigger-error-code assertions may need a
   P2003→Postgres-error-code shim, which is exactly the kind of
   intentional edit to review, not weaken).
2. `bun run db:audit` → 0 flagged rows (auditor SQL is ANSI-compatible;
   BigInt replacer already handles COUNT).
3. Row-count parity per table (SQLite vs Postgres) + per-table SHA-256
   checksums over ordered PKs with money columns rounded to 2 decimals.
4. Financial reconciliation: for every school,
   `Σ Payment.amount == Σ Fee.paid deltas` (the ledger invariant the
   Phase-3 tests enforce), receiptNo/referenceNumber uniqueness holds,
   `FeeTransaction(SUCCESS)` rows with feeId all have matching Payment
   mirrors.
5. Cross-tenant FK zero-row audit: re-run every §4 pair query from
   `prisma/audit-db-integrity.ts` → 0 rows.
6. RLS smoke test: with `app.school_id` unset, SELECTs on tenant tables
   return 0 rows; with School A set, School B rows are invisible.

## 6. Post-cutover hardening backlog (ordered)

1. RLS policies per table + `app.school_id` request extension (§3.9).
2. CHECK constraints + partial unique indexes (can land WITH the
   baseline — recommended).
3. pg_trgm search indexes; then consider tsvector for study materials.
4. Attendance partitioning `PARTITION BY RANGE (date)` (or hash by
   school_id) once a single tenant crosses ~10M rows.
5. Receipt/reference minting → per-school `SEQUENCE` or counter table
   (replaces `mintReceiptNo`'s findMany-max scan).
6. Super-admin revenue aggregates → nightly rollup table.
7. Supabase-managed auth swap for `Session` (optional, later — the
   token table is already isolated behind `src/lib/auth.ts`).
8. Money columns → minor-unit BIGINT if any Float rounding drift is
   ever observed (currently none — clamps + NUMERIC make drift
   impossible at 2 decimals).

## 7. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Float→NUMERIC cast drift on money | low (all values are 2-decimal) | checksum gate §5.4; explicit `ROUND(x,2)` in ETL |
| Trigger→CHECK/RLS semantic gap | medium | gate §5.1 reuses the same 41 tests; any semantic difference is reviewed as a deliberate edit |
| cuid collisions with future uuid PKs | none (cuids stay PKs) | — |
| Prisma SQLite↔PG query-plan differences (e.g. compound index usage) | low | EXPLAIN the top-20 hot queries from DATABASE_INTEGRITY §10 during Phase A |
| Downtime overrun | low (dataset is small) | window of minutes; delta ETL is idempotent by PK |
| Secrets/config drift at cutover | low | DATABASE_URL is the ONLY connection knob (`.env` today); documented in SECURITY_BASELINE |

## 8. What deliberately does NOT change

- Mock/demo data ships as-is (per Phase-3 constraints).
- The 41-test gate and `db:audit` remain the invariant source of truth.
- The SQLite migration lineage (`prisma/migrations/*`) stays intact in
  git history for rollback and archaeology.
- No `db push` ever again — Postgres schema changes flow exclusively
  through `prisma migrate dev` (dev) / `prisma migrate deploy` (prod),
  with hand-edited migration files allowed only for what Prisma cannot
  express (CHECK/RLS/partial indexes/triggers), exactly as Phase 3
  practiced.

---

## PIH ADDENDUM — pre-integration hardening audit facts (2026-10-01)

The pre-integration forensic audit (worklog PIH-1..6) verified the live DB and
produced these migration-critical facts. They extend, not replace, the plan.

**Money → NUMERIC strategy (per field):** Fee.amount/paid, Payment.amount,
FeeTransaction.amount, MasterFeeHead.amount, FeeHead.amount → `NUMERIC(12,2)`;
Settlement.grossAmount/fees/netAmount → `NUMERIC(14,2)` (compute in paise
ints, divide once); Route.fare → `NUMERIC(10,2)` (transport fee is money);
marks/percent Floats → `NUMERIC(6,2)` optional (not money). No field is
integer-paise or string money today; 0 fractional rows live. In-app rounding
rules to codify at cutover: single roundToPaise at every input; installment
splits in integer paise with remainder to the last bucket; percent
concessions round-half-up to whole rupee; aggregation via SQL SUM (never JS
float reduce).

**Status-vocabulary normalization (BEFORE enum/CHECK):** live drift exists —
Exam.status {COMPLETED, SCHEDULED, Scheduled} vs code title-case;
Exam.resultStatus two schemes ({Declared, In Progress, Not Started} vs
{Marks Entry, Under Verification, Result Ready, Result Declared});
ParentGrievance 'monitoring' ∉ comment; FeeTransaction.method mixed case.
Full vocabulary register: worklog PIH-3b / PRE_INTEGRATION_HARDENING_REPORT.

**RLS boundary:** 73 tables carry schoolId (policy key
`school_id = current_setting('app.school_id')`); 16 tenant-derived tables
WITHOUT schoolId are trigger-protected today (ExamClass, ExamMark, Result,
NotificationRead, BookIssue, GalleryImage, …) — add schoolId at cutover or
join-based policies; User-scoped: Session, UserPreference; platform plane:
separate policies (PlatformAuditLog, SupportSession cross-tenant by design);
legitimately cross-tenant reads: School (pre-auth login resolution),
PlatformAnnouncement, login lookups.

**Attendance day-anchor rule (now enforced):** canonical attendance dates are
exact midnight-UTC epoch-ms multiples; the `@@unique(studentId, date)` is the
day-level constraint BECAUSE of the anchor (PIH migration
20261001000000_pih_data_integrity deduped + anchored all rows; seeds and all
writers now day-anchor). ETL must preserve the invariant: reject any
non-midnight date.

**LIKE case-sensitivity flip:** 37 `contains:` sites rely on SQLite's
ASCII-case-insensitive LIKE; PG LIKE is case-sensitive — add
`mode:'insensitive'` + pg_trgm GIN at the provider swap.

**event-stream:** `mini-services/event-stream` polls SQLite via bun:sqlite
with epoch-ms comparisons — must be rewritten on Prisma/Supabase Realtime at
cutover (rooms map 1:1 to RLS policies; wire frames unchanged).

**Dead-family note:** FeeStructure/FeeHead/FeeStructureVersion + their routes
are unwired (0 rows, 0 callers — client reads localStorage). Decide
wire-or-drop during the PG lineage regeneration; do not carry dead money
tables into Postgres silently.
