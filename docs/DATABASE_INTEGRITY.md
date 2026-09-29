# SCHOLARIO-OS — DATABASE INTEGRITY BASELINE (PHASE 3)

> Status: **implemented and test-verified** (2026-02-01).
> Scope: complete Prisma schema audit + every database write path.
> Constraints: no Supabase connection yet, no mock-data removal, no destructive workflows.
> Companion docs: `docs/POSTGRES_MIGRATION_PLAN.md` (target state),
> `docs/SECURITY_BASELINE.md` + `docs/TENANT_ISOLATION_MODEL.md` (Phases 1–2).
>
> **Honesty note:** this document claims only what the automated gate
> demonstrates. The gate is `bun run test:security` (202 tests, of which
> 41 are the Phase-3 database-integrity suite in
> `tests/security/database-integrity.test.ts`) plus the read-only auditor
> `bun run db:audit` (0 flagged rows at close).

---

## 1. Executive summary

| Dimension | Before Phase 3 | After Phase 3 |
|---|---|---|
| Schema management | `db push --accept-data-loss`, no migration history | 3 versioned migrations (`0_init` baseline, `integrity_constraints`, `db_level_guards`); `db:push` is a loud guard script |
| Business-key uniqueness | ~30 of 46 required keys enforced | **46/46 enforced at the DB level** (§3) |
| Cross-school FK safety | service layer only (Phase 2) | service layer **+ 62 DB tenant-guard triggers** (§4) |
| Marks ≤ maxMarks, money > 0, paid ≤ amount | service hopes | **14 DB bound-guards** (triggers) + service validation (§7) |
| Financial writes | 5 ways the ledgers could disagree (6-a audit) | ONE canonical ledger writer, transactional + idempotent-by-txnId + clamped (§5) |
| Timetable conflicts | none at DB level | class-slot + teacher double-booking uniques (§8) |
| Hot-path indexes | 20 models had ZERO secondary indexes (every school-scoped query = cross-tenant full scan) | 30 new `@@index` entries (§11) |
| Deletion | school delete orphaned Payments, declared exams deletable | tenant teardown is complete + audited; declared results refuse deletion (§9) |

Write-path audit method: two parallel read-only audit agents swept all
~290 DB write sites across 90 files (Task IDs 6-a / 6-b in `worklog.md`),
classified each against the Phase-3 rubric (transactional / idempotent /
FK-in-tenant / deletion-safety / unique-reliance), and the fixer agent
(Task ID 7) closed every CRITICAL/HIGH finding. Findings F1–F29 with
file:line evidence live in the worklog.

---

## 2. Migration discipline (replacing destructive db push)

**The old workflow** — `prisma db push --accept-data-loss` — created schema
without history and silently dropped data on drift. It is now impossible
to run accidentally:

```jsonc
// package.json
"db:push":  "bun scripts/db-push-guard.ts",   // exits 1 with instructions
"db:reset": "bun scripts/db-reset-guard.ts",  // refuses in production
"db:migrate":      "prisma migrate deploy",   // production-safe apply
"db:migrate:dev":  "prisma migrate dev",      // create + apply (dev)
"db:migrate:status": "prisma migrate status",
"db:audit":  "bun prisma/audit-db-integrity.ts"  // read-only integrity auditor
```

**Migration history** (all applied to `db/custom.db`):

| Migration | Content |
|---|---|
| `0_init` | Baseline of the full 83-model schema (baselined via `migrate diff --from-empty` + `migrate resolve --applied` — no data touched) |
| `20260201000000_integrity_constraints` | 12 new unique constraints, 30 new indexes, `Payment.schoolId` (required, backfilled from `Fee.schoolId` in the same migration), `Payment.transactionId` unique |
| `20260201010000_db_level_guards` | 76 triggers: 62 tenant guards + 14 bound guards (§4, §7) |

Rules going forward (enforced socially + by the guards):
1. Schema changes go through `prisma migrate dev --name <change>` — never
   `db push`. The DB and `schema.prisma` are kept at **zero drift**
   (verified: `prisma migrate diff --from-schema-datasource … --to-schema-datamodel`
   → empty).
2. Hand-written SQL (triggers, checks, backfills) is allowed ONLY inside
   a versioned migration file — Prisma does not manage triggers, so they
   survive every future `migrate dev` diff.
3. Production uses `prisma migrate deploy` (applies pending migrations
   only; never resets, never drops).
4. `prisma/audit-db-integrity.ts` (`bun run db:audit`) is the
   pre-deploy read-only check: duplicate-key blockers, cross-school FK
   violations, dangling plain-string refs, data-bound violations.

---

## 3. Unique-constraint catalog (goal 2)

Every key the business requires, now enforced by the DATABASE (P2002 on
violation). "Service" = the Phase-2 central guards; "Test" = the
automated demonstration in `tests/security/database-integrity.test.ts`.

| Entity | Unique key | Status | Test |
|---|---|---|---|
| **Students** | `(schoolId, admissionNo)` | NEW | ✅ `admission numbers are unique per school` |
| **Admission numbers** | same as above (the admission number IS the student identity) | NEW | ✅ |
| **Roll numbers** | `(schoolId, classId, rollNo)` | NEW | ✅ `roll numbers are unique within (school, class)` |
| **Attendance** | `(studentId, date)` [named `studentId_date`] | pre-existing | ✅ idempotency test |
| **Fees (ledger rows)** | no key by design — the legacy `Fee` row is a per-student×title display ledger; the *financial* identity keys live on `FeeTransaction`/`Payment` (below) | documented | — |
| **Receipts** | `FeeTransaction (schoolId, receiptNo)` | NEW | ✅ |
| **Payments** | `Payment.transactionId` (gateway ref; replay guard) + `FeeTransaction (schoolId, referenceNumber)` (duplicate-detection key) | NEW | ✅ both |
| **Exams** | `(schoolId, name, session)` | NEW | ✅ |
| **Marks** | `ExamMark (examId, classId, subjectId, studentId)` (duplicate-submission guard) | pre-existing | ✅ |
| **Timetable** | `(schoolId, classId, day, period)` — class-slot; `(schoolId, teacherUserId, day, period)` — teacher double-booking | NEW | ✅ both |
| **Rooms** | `(schoolId, name)` + `(schoolId, active)` index | pre-existing | — (pre-existing, verified in 0_init) |
| **Teacher assignments** | `ClassSubjectAssignment (classId, subjectId)` (+ `(schoolId, teacherUserId, isActive)` index) | pre-existing + NEW idx | ✅ CSA tenant test |
| **Class assignments** | `Class (schoolId, name, section)` | NEW | ✅ |
| **Subjects** | `(schoolId, code)` | pre-existing | — |
| **Documents (files)** | `UploadedFile.id` = stored fileId (PK) + `(schoolId, scope)` index; `StudyMaterial` has no natural key (titles repeat) — access control is the registry + path guards (Phase 2) | mixed | — |
| **Library** | `LibraryBook (schoolId, isbn)` | NEW | ✅ |
| **Report cards** | `Result (studentId, examId, subjectId)` | NEW | ✅ |
| **Webhook events** | `WebhookEvent.eventId` (idempotent delivery) | pre-existing | ✅ |
| **Reconciliation** | `(transactionId, settlementId)` (replay cannot re-insert match rows) | NEW | ✅ |
| **Exam papers/seat/outcomes** | `ExamSeatAssignment (examId, room, seatNumber)` + `(examId, classId, studentId)`; `ExamResultOutcome (examId, studentId)`; `ExamSubjectConfig (examId, classId, subjectId)` | pre-existing | — |
| **Growth ledger** | `GrowthEvent (schoolId, dedupeKey)`; `GrowthEvalRun (schoolId, kind, periodKey)` | pre-existing | — |
| **Homework submissions** | `(homeworkId, studentId, attemptNumber)` | pre-existing | — |
| **School config rows** | `AttendanceSetting/AdmitCardConfig/ReportCardConfig/GrowthSetting (schoolId)`; `ExamTypeConfig (schoolId, name)`; `GradeScale (schoolId, grade)`; `NoHomeworkDate (schoolId, date)`; `HomeworkPolicy (schoolId, gradeLevel)` | pre-existing | — |

SQLite caveat (documented, deliberate): columns that participate in a
unique key but are NULL bypass the constraint (SQL standard NULLS
DISTINCT). This is the intended behavior for "not yet assigned"
admission/roll numbers, unset receipt/reference numbers, and
teacher-less timetable cells. The Postgres plan tightens two of these
with **partial unique indexes** (`WHERE teacher_user_id IS NOT NULL`;
`WHERE status = 'current'` for fee structures — see the migration plan).

---

## 4. Cross-school FK safety (goal 3)

Three layers, innermost first:

1. **Service layer (Phase 2)** — every write accepting client-supplied
   ids re-verifies the referenced row belongs to the caller's school
   (`assertFkInTenant` / `findFirst({ id, schoolId })` → fail-safe 404).
2. **Schema-level tenant columns** — every tenant-owned row carries
   `schoolId`; `Payment` gained it in Phase 3 (required, backfilled,
   cascading with the school).
3. **DATABASE triggers (NEW)** — 62 `BEFORE INSERT/UPDATE` guards
   (migration `db_level_guards`) on 31 tables. A row whose parent
   reference resolves to another school — or which is missing its school
   binding — is ABORTed by SQLite itself, no matter which code path
   wrote it. Trigger ABORTs surface through Prisma as P2003.

Guarded tables (parent → school consistency): `Student` (class, route,
guardian user), `Class` (room, class-teacher user), `ClassSubjectAssignment`
(class, subject, teacher user), `Exam` (class), `ExamClass`,
`ExamSubjectConfig`, `ExamScheduleItem`, `ExamMark` (4-way exam/student/
class/subject), `ExamAttendance`, `ExamSeatAssignment`, `ExamResultOutcome`,
`Result`, `Attendance`, `AttendanceDraft`, `AttendanceAuditLog`,
`Timetable` (class, subject, teacher user), `Fee`, `Payment` (school-bound
+ fee), `FeeTransaction` (student, fee, structure — plain-string refs),
`BookIssue` (book vs student), `Homework` (class, subject, teacher user),
`HomeworkSubmission`, `StudyMaterial` (loose subject FK), `StudyMaterialTarget`,
`QuestionBank`, `GrowthEvent`, `BehaviorRecord`, `ParentConversation`
(teacher, parent, student), `Assignment`, `StudyTask`, `Reconciliation`.

Verified: **zero pre-existing violations** on every guarded pair
(`bun run db:audit`, 0 flagged rows) — no row was frozen by the guards.
Demonstrated by 8 cross-school tests (`cross-school FK guards` describe
block): Student↔class, Payment↔fee, Payment not school-bound, ExamMark
exam/student mix, Timetable foreign teacher, FeeTransaction foreign
student (plain string), CSA foreign class, BookIssue foreign student,
Homework foreign subject.

---

## 5. Financial operations are transactional (goal 4) + idempotent (goal 5)

**Single canonical ledger writer** — `applyPaymentToLedger`
(`src/lib/fee-workflow.ts`), now called by EVERY money-landing path:

| Path | Before | After |
|---|---|---|
| `fees/verification` verify / record-direct | transactional, but record-direct read balances OUTSIDE the tx (TOCTOU) | all checks + mint + ledger INSIDE one `$transaction`; ledger writer is status-guarded + idempotent |
| `student/payments/verify` | PENDING check outside tx (double-credit race); early-return on SUCCESS → webhook-won races never landed the money | conditional `updateMany({ status: 'PENDING' })` inside the tx (count 0 → idempotent no-op); already-SUCCESS txns reconcile-if-unapplied |
| `webhooks/razorpay` payment.captured | marked SUCCESS, never touched `Fee.paid` / no Payment row | capture + ledger apply in ONE transaction, idempotent key = gateway payment/order id |
| `webhooks/razorpay` settlement.processed | 2 non-atomic writes; linked EVERY success txn in the date window (misattribution) | one `$transaction`; link constrained to the transfers' order ids (+window); catch-all only when transfers[] empty |
| `fees` POST payment-record | balance read outside tx, absolute write (lost update) | in-tx read + clamped `increment` + status |
| `fees/payments/confirm` (demo) | SUCCESS with no ledger effect | applies ledger idempotently; env-gated in production |
| `fees/transactions` POST | client-supplied receiptNo persisted; SUCCESS with no ledger | server-minted receiptNo; referenceNumber duplicates → 409; SUCCESS with feeId applies ledger |
| `fees/structures/[id]/publish` | 3 non-atomic writes, P2002 mid-flow | one `$transaction`; conflicts → 409 |
| `teacher/fee-collection` | check-then-act reference uniqueness | DB unique backstop → 409 on race |

**Idempotency guarantees** (each demonstrated by a test):
- **Webhooks**: insert-first `WebhookEvent.eventId` unique gate + a
  DETERMINISTIC fallback id when the payload has none
  (`evt_` + HMAC-SHA256(body, secret)) — a signed replay reuses the same
  event id and is a no-op. `Reconciliation (transactionId, settlementId)`
  unique prevents duplicate match rows.
- **Payments**: `Payment.transactionId` is UNIQUE — a replayed webhook or
  double-verify can never mint a second money mirror. The ledger writer
  checks it first (replay → `alreadyApplied: true`, zero writes).
- **Amounts are clamped**: `Fee.paid` can never exceed `Fee.amount` —
  in code (`applied = min(amount, outstanding)`) AND in the database
  (bound-guard trigger). Overpay attempts land as partial applies.
- **Fee targeting is deterministic**: `resolveFeeIdForTxn` picks
  txn.feeId → exact feeHeadName title → oldest UNSETTLED fee → never a
  paid row (test-verified), never a random first row.

**Reconciliation invariant** (test-verified): after any sequence of
applies/replays/clamps, `Fee.paid == Σ applied Payment amounts` for that
fee, `Payment` rows exist only for distinct txnIds, and `fee.status`
transitions UNPAID → PARTIAL → PAID exactly at the amount boundary.

---

## 6. Attendance writes are idempotent (goal 6)

- DB: `Attendance (studentId, date)` unique — the idempotency key.
  Because `Student.id` is globally unique, this key is strictly
  tenant-safe (one student row = one school).
- Service: the canonical workflow (`writeCanonicalAttendance`) is a
  replace-semantics transaction (delete-day + recreate + journal +
  draft-clear) — double-POST leaves one row-set and journals only real
  changes. The legacy `POST /api/attendance` is a tenant-safe
  create-or-update on the same key (Phase-2 rewrite).
- Drafts: `AttendanceDraft (classId, date)` unique upsert; auto-finalize
  is roster-derived and complete-sheet-only.
- Test: `double-POST attendance = one canonical row, latest status`.

## 7. Marks writes are safe against duplicate submission (goal 7) and can never exceed configured marks (goal 9)

- **Duplicate submission**: `ExamMark (examId, classId, subjectId,
  studentId)` unique + upsert write paths (setMark / marks-entry save /
  import / batch) — re-submitting a paper updates the same row, never
  duplicates (test-verified).
- **Bounds — two layers**:
  1. Service: setMark / marks-entry save / importMarksCsv validate
     `marksObtained ≤ ExamSubjectConfig.maxMarks` (and ≥ 0) BEFORE
     writing → 422 with a human message.
  2. Database: `tg_bound_ExamMark_ins/upd` triggers compare against the
     config row (`COALESCE(config.maxMarks, 2^31-1)`) and reject
     violations even from future unvalidated code paths; negative
     graceMarks also rejected. Tests: `marksObtained can never exceed
     the configured maxMarks`, negative marks, negative grace.
- Same treatment: `Result.marks ≤ totalMarks` (service + trigger + test).

## 8. Timetable writes cannot create invalid conflicts (goal 8)

- DB uniques: a class cannot have two slots at the same
  `(school, class, day, period)`; a teacher cannot be double-booked at
  the same `(school, teacher, day, period)`. Both test-verified
  (including the isolated teacher-conflict case across two classes).
- `Timetable.period ≥ 1` bound guard (trigger + test).
- Service: `POST /api/timetable/publish` wraps the wipe + rebuild in ONE
  transaction (a failure can no longer leave the school timetable-less),
  auto-created subjects get deterministic code-collision handling, and
  P2002 surfaces as 409 TIMETABLE_CONFLICT. All timetable writes are
  in-tenant (Phase 2 + tenant-guard triggers).
- Known gap (deliberate, documented): teacher-less legacy cells
  (`teacherUserId IS NULL`, name-matched) bypass the teacher unique —
  SQLite NULLS DISTINCT. Postgres plan: partial unique index
  `WHERE teacher_user_id IS NOT NULL`.

---

## 9. Deletion behavior is deliberate (goal 10) — cascade audit (goal 11)

**Deletion policy decisions (each deliberate):**

| Deletion | Behavior | Rationale |
|---|---|---|
| School (SUPER_ADMIN tenant teardown) | Cascades **everything**, now including `Payment` (new `Payment.schoolId` FK, Cascade). Previously payments survived as unattributed orphans in platform exports. | Tenant teardown must be complete — no financial ghosts. Test-verified. |
| Exam with `resultStatus = 'Result Declared'` | **REFUSED** (409 CONFLICT — auditable academic history; archive instead). Test-verified. | Declared results feed report cards/compliance. |
| Exam (not declared) | Cascades marks, results, schedules, seating, outcomes, audit rows. Test-verified (no orphans). | Exam scaffolding without declared results is editable/discardable. |
| Student | Cascades attendance, marks, fees, payments(via fee), issues, growth… (`userId` 1:1 Cascade deletes the login too). Preferred path is status change (INACTIVE) — hard delete is the explicit ops action. | Academic history dies with the student identity (privacy-clean teardown). |
| Fee row | Payments survive with `feeId` SetNull (amount/method/txnId retained). | Financial mirrors are audit records; they must outlive the ledger row they credited. |
| User | Sessions cascade; logs/notifications/messages SetNull (audit survives staff churn); Student/Teacher profiles cascade. | Communication + audit history remain readable. |
| Class | Students SetNull (unassigned, not destroyed); timetables/CSA/homework Cascade; question banks SetNull. | Re-teaming a class must not destroy students. |
| Master data (Subject/Room/LibraryBook) | Referencing rows SetNull (questions, class rooms, book issues Cascade for book). | Historical records stay valid (Spec §16/§25). |
| WebhookEvent school | SetNull (event log survives tenant). | Gateway audit trail. |
| Uploads | Registry-owned (`UploadedFile`), file delete is ownership-verified (Phase 2). | — |

**Nullable FK audit (goal 12)** — the intentional ones, with meaning:
`Student.classId/routeId/guardianId` (unassigned/reassignment),
`Class.roomId/classTeacherId` (vacant), `Subject.classId` (legacy,
canonicalization target), `CSA.teacherUserId` (vacant slot),
`Timetable.subjectId/teacherUserId` (free periods/legacy name-match),
`Payment.feeId` (SetNull audit mirrors), `BookIssue.studentId`,
`QuestionBank.subjectId/classId`, `StudyMaterial.subjectId` (loose FK —
trigger-guarded), `Homework.subjectId/teacherId`,
`Notification/Message sender+recipient` (account deletion),
`ActivityLog.userId/schoolId` (platform events), `WebhookEvent.schoolId`
(unattributed events), `ExamAttendance.scheduleItemId`,
`Driver.userId`, `TeacherFollowUp.*`, `GrowthEvent.createdById`,
`FeeTransaction.studentId/feeId/structureId` (**plain strings, no FK —
trigger-guarded**, §4). Each is either a lifecycle state or an
audit-survives-deletion decision.

---

## 10. Index audit (goal 13)

Before Phase 3 the 6-b audit verified against the live SQLite index set
that `Student, Timetable, Fee, Payment, Notification, Message,
ActivityLog, Class, Exam, Result, BookIssue, User, QuestionBank,
Homework, LibraryBook, Session, ClassSubjectAssignment, Attendance`
carried **zero secondary indexes** — every school-scoped query was a
cross-tenant full-table scan (at 1,000 schools, a 40-row dashboard read
scanned millions of rows).

Added in `integrity_constraints` (30 entries, leftmost-prefix chosen
from the real where-clauses in code):

| Model | New indexes |
|---|---|
| Student | `(schoolId, classId)`, `(guardianId)` |
| Class | `(schoolId, classTeacherId)` |
| CSA | `(schoolId, teacherUserId, isActive)` — the hottest permission lookup |
| Exam | `(schoolId, status, startDate)` |
| ExamMark | `(classId, subjectId)`, `(studentId)` — roster/analytics/growth paths the examId-led compound unique cannot serve |
| Result | `(examId, studentId)`, `(studentId)` |
| Fee | `(schoolId, status)`, `(studentId)` |
| Payment | `(schoolId, createdAt)`, `(feeId)` |
| Attendance | `(schoolId, classId, date)`, `(schoolId, date)` |
| Timetable | `(schoolId, classId, day)`, `(schoolId, teacherUserId, day)` |
| Notification | `(schoolId, createdAt)` — the bell-feed poll |
| Message | `(schoolId, recipientId, createdAt)`, `(schoolId, senderId, createdAt)` |
| ActivityLog | `(schoolId, createdAt)` |
| Session | `(userId)` |
| User | `(schoolId, role, status)` |
| LibraryBook | `(schoolId)` |
| BookIssue | `(bookId, status)`, `(studentId, status)` |
| Homework | `(schoolId, classId, dueDate)` |

---

## 11. N+1 query audit (goal 14)

**Fixed in Phase 3** (behavior-preserving rewrites):
- `createExam` mark seeding: was C + Σ(students×subjects) sequential
  upserts (~2,800 queries for 8 classes) → ONE roster findMany +
  `createMany` inside one transaction.
- Homework submission seeding (create/duplicate): per-student creates →
  `createMany`.
- `fees/defaulters/remind`: per-defaulter sequential `message.create` →
  one `createMany`.
- Teacher-scope resolution inside loops: `setMarksBatch`/CSV import now
  pre-validate batches once (roster pre-validation already present).

**Documented residuals** (with the recommended fix, not yet applied —
all are read-path latency, not correctness):
1. `setMarksBatch` still calls `setMark` per row (~7 queries/row incl.
  CSA + timetable re-resolution) — hoist exam/config/CSA resolution out
  of the loop, then batch upserts.
2. `importMarksCsv`: 2 queries/row → one findMany + createMany/updateMany split.
3. `autoMarkAttendanceFromExamMarks`: per-mark schedule lookups → memoize per subject.
4. Teacher dashboard: per-class attendance snapshots → `groupBy(classId, status)`; curriculum fan-out re-resolves teaching assignments per assignment (~8×A queries) → pass computed scope.
5. `audienceAllows` per-notification student/ward lookups (bell feed ≤24, notices ≤60, announcements ≤20/query) → resolve viewer class/wards once per request, pass into a pure predicate.
6. `message-class` parent fan-out: 2×N sequential upsert+create → findMany + createMany in one tx.
7. Lesson-planner `rewriteOrderIndexes` per-topic updates → batched/gap-tolerant ordering.
8. Seating generate: per-seat creates → createMany.
9. `generateSeatingPlan`/oversight class lookups duplicated per row → single `findMany({ id: { in } })`.

## 12. Scale analysis (goal 15)

Row-growth model (per school-year): attendance ≈ students × 200 school
days; marks ≈ students × subjects × exams; fees/payments ≈ students ×
heads; notifications/messages grow unbounded with usage; ActivityLog
grows forever with school age.

| Scenario | Students | Attendance rows/yr | Marks rows | What breaks first (pre-Phase-3 → now) |
|---|---|---|---|---|
| 1 school, 1,000 students | 1,000 | 200k | ~7k/exam | nothing critical now; the roster/overview full-history loads (~200k rows/req) are the first pain — needs date windows (documented) |
| 1 school, 10,000 students | 10,000 | 2M | ~70k/exam | `attendance/overview` unbounded read (2.2M rows) → **needs the date-window + SQL groupBy fix** (documented residual); roster photo blobs (~1–3 GB materialized) → needs `select` projection; exam list embeds all marks → needs counts-only include |
| 1 school, 100,000 students | 100,000 | 22M | — | SQLite is the wrong engine at this scale: single-writer lock, 2880-slot timetables, LIKE scans. **Postgres required** (migration plan) + attendance partitioning by (school, date) |
| 1,000 schools | ~200/school avg | 40M+ platform-wide | — | cross-tenant scans are now index-bounded (Phase-3 indexes); remaining platform risks: superadmin payment aggregates (no pre-aggregation), export routes loading full tables (take 1000–2000 caps today), LIKE search scans → FTS5/Postgres trigram |

Cost classes fixed by the index migration: every `where: { schoolId, … }`
on the 20 formerly-unindexed models (students list, fee ledger,
notifications feed, message inboxes, audit trails, timetable reads,
marks by class/student). Cost classes still open (documented):
unbounded date-range reads (attendance overview, roster history),
unbounded includes (EXAM_INCLUDE marks), CSV in-memory builds,
`LIKE '%q%'` search scans, per-school receipt minting scans
(`mintReceiptNo` findMany — replace with a counter row or Postgres
sequence), superadmin whole-platform aggregates.

---

## 13. Verification (the gate)

```
$ bun run test:security
  202 pass / 0 fail        # 161 Phase-1/2 + 41 Phase-3 database-integrity
$ bun run db:audit
  TOTAL flagged rows: 0    # duplicates / cross-school FK / bounds / dangling refs
$ bunx tsc --noEmit
  0 errors
$ bun run lint
  0 errors 0 warnings
$ bunx prisma migrate status
  3 migrations found — Database schema is up to date!  (zero drift)
```

The 41-test database-integrity suite asserts, against the live database:
unique rejections (14), bound-guard rejections (10), cross-school FK
guard rejections (8), idempotent writes (2), transactional ledger
math (2), deliberate deletion behaviors (4), plus one structural
assertion per business key. Failure of any of these fails CI.

## 14. Known limitations (honest list)

1. SQLite is a single-writer engine — Phase-3 guarantees are
   correctness guarantees, not throughput SLAs. At 10k+ students or
   multi-school production load, execute the Postgres plan.
2. Trigger ABORTs surface from Prisma as generic P2003/P2002 — the
   error sanitizer (Phase 1) keeps messages safe, but callers cannot
   distinguish "trigger guard" from "plain FK" without reading
   `error.meta`. The service layer remains the first gate; triggers are
   the backstop.
3. NULL-bypass on nullable unique-key columns (admission/roll numbers
   unset, receipt/reference numbers unset, teacher-less timetable
   cells) — intended; Postgres partial indexes tighten two cases.
4. `FeeStructure (schoolId, classId, status)` unique blocks legitimate
   multi-version history (one row per status) — kept for now (loosening
   would REMOVE a constraint in an integrity phase); publish handles
   conflicts with 409; the Postgres plan replaces it with a partial
   unique on `status='current'`.
5. N+1 residuals and unbounded reads of §11/§12 are documented, not yet
   fixed.
6. Money is `Float` (pre-existing). The ledger clamps make drift
   impossible at the invariant level, but Postgres migration moves all
   money columns to `NUMERIC(12,2)` / minor-unit BIGINT.
