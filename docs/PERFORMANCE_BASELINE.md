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
