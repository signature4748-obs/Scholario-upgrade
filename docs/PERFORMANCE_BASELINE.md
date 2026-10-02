# SCHOLARIO-OS — PERFORMANCE BASELINE (Phase 8A, Supabase PostgreSQL)

> Measured live against the integration database (ap-south-1, Supavisor
> session pooler) on 2026-10-01 by `scripts/db-perf-probe.ts`
> (mission §56). Corpus: Sunrise Academy (~154 students / 4,173 attendance)
> plus synthetic throwaway schools at 1,000- and 5,000-student scale
> (fully cleaned up afterward; money parity verified untouched).

## Hot query shapes (EXPLAIN ANALYZE + wall time over the pooler)

| Query | 1,000-student scale | 5,000-student scale | Plan |
|---|---|---|---|
| Students roster (school-filtered join) | 137 ms | 271 ms | Index Scan (schoolId key); seq at 5k (12 ms server) |
| Fee aggregation (SUM by school+status) | — | — | aggregate, low ms server-side |
| Attendance range (class + date range) | 300 ms | 1.44 s | Index Scan `Attendance_schoolId_classId_date_idx` (75k rows at 5k scale) |
| Search `ILIKE '%aarav%'` (User.name) | 133 ms | 261 ms | pg_trgm GIN, 1.4–6.6 ms server-side |

Server-side execution times are single-digit-to-127 ms; the remainder of
every wall time is the pooler round-trip (~130 ms) and row transfer. The
trigram GIN indexes (migration 00000000000002) are doing their job.

## Endpoint N+1 finding (deferred fix, tracked)

`GET /api/teacher/dashboard` = **7.7 s** (QA-observed 9–13 s cold). Root
cause: ~70 sequential queries (per-class attendance snapshots, per-assignment
lesson-plan/growth/exam-mark lookups — each `Promise.all` group still waits
one pooler RTT per query batch). On SQLite this was invisible (µs RTT); on
PG it dominates. RECOMMENDATION (ordered):
1. Batch teacher/dashboard: single `findMany` with `in: [...]` class
   filters for attendance snapshots; one grouped query for exam-mark
   counts; lesson-plan lookups batched per (class, subject) set.
2. Consider a dataloader for include fan-outs on other dashboard routes.
3. Attendance range at 5k scale (1.44 s) is index-served but row-heavy —
   fine at current volumes; partition only beyond ~10M rows (per the
   migration plan's backlog).

## Connection budget (Supavisor session mode)

Supavisor session-mode hard limit for this project: **pool_size 15**
(observed `EMAXCONNSESSION` before budgeting). Steady-state budget:
dev server 6 (`DATABASE_URL connection_limit=6`) + shared test client 6
(`tests/helpers/db.ts`) + event-stream 1 = **13/15**, 2 headroom for
transient scripts. Never raise these without re-checking the project's
pool_size. Transaction mode (:6543) is NOT usable with Prisma interactive
transactions (SAVEPOINT pinning).

## Capacity notes

- Sandbox memory ceiling (3.9 GiB) is the binding constraint for the full
  live-HTTP suite + dev server concurrently (kernel OOM-killer observed;
  mitigated: dev heap 1.4 GiB, event-stream shed during canonical runs).
- All measurements above are single-instance (Next dev + Prisma pool 6).

---

# PHASE 8B — Teacher Dashboard N+1 Fix (2026-10-02)

## What changed

`GET /api/teacher/dashboard` hot path, batched without changing
authorization or the response shape (verified top-level keys identical:
teacher/today/nextDay/assignments/classTeacherOf/attendance/curriculum/
hub/notices):

| Block | Before (Phase 8A) | After (8B) |
|---|---|---|
| Attendance snapshot (class-teacher classes) | 1 query **per class** in `Promise.all` map | 1 batched `findMany({ classId: { in: [...] }, date })` |
| Lesson plans (per assignment) | `getLessonPlan()` per (class,subject) — ~5 queries × N assignments | `getLessonPlansBatch()` — 5 queries total (school + topics + completions + timetables + holidays) with OR'd (classId,subjectId) pairs, grouped in memory |
| Notice audience filter | `.filter(n => audienceAllows(...))` on an **async** function (never awaited — latent bug) | synchronous `audienceAllowsStaff(n.audience, user.role)`; teacher-visible semantics preserved (staff pass-through) |
| Sequential query count | ~70 | ~24 |

## Measured (sandbox → Supavisor ap-south-1 session pooler)

| Metric | Before | After |
|---|---|---|
| Warm GET /api/teacher/dashboard | ~7.7 s (QA-observed 9–13 s cold) | **3.38–3.62 s** (3.83 s cold incl. dev compile) |

Remaining wall time is dominated by the sandbox→Mumbai pooler RTT:
every single query in this route logs `db_slow_query durationMs≈270`
with single-digit-ms server-side plans (see Phase 8A EXPLAIN ANALYZE).
On the Vercel deployment (function region `bom1` — same region as the
Supabase database) the RTT collapses from ~250 ms to ~1–5 ms, which
projects the same request to **well under 1 s** without further changes.

## Not done / notes

- Principal `/api/dashboard` was already flat (12 parallel aggregates, no
  await-in-loop) — untouched.
- No caching introduced: the fix is real batching; the DB stays the only
  source of truth.
