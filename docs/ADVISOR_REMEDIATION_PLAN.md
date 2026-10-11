# Advisor Findings — Remediation Plan (evidence-based)

> 2026-10-11. Supabase advisor findings for `kbyknezedewvgrnqervj`
> (112 × `rls_enabled_no_policy`, 1 × `extension_in_public`,
> 68 × `unindexed_foreign_keys`, 60 × `unused_index`) were pulled live via
> the Management API and **investigated against the live database, the
> Prisma schema, the migration chain and the application's actual access
> paths**. This is the table-by-table disposition: what is intentional,
> what is real, and the exact follow-up. **No blanket changes were made —
> none are warranted by the evidence.**

## 1. RLS enabled with no policy (112 findings) — INTENTIONAL, verified

**Live evidence** (`pg_roles`): `postgres` and `service_role` carry
`rolbypassrls = t`; `anon` / `authenticated` do not. All 112 public
tables have `rowsecurity = t` **with zero policies** — for any
PostgREST/supabase-role query that is a hard **deny-by-default**: not
"missing protection" but the boundary itself.

**Application access-path audit (code-level):**
- There is **no Supabase data client anywhere in `src/`** (no
  `createClient`, no `@supabase/supabase-js`). All data access flows
  through the application's own API routes → server-side Prisma, which
  connects as the schema-owning `postgres` role (`BYPASSRLS`).
- The anon key is used only to hand the browser the **realtime config**
  (`/api/realtime/config` — the public publishable key, by design) and
  the service-role key only server-side (storage uploads, realtime
  broadcast publish). CSP allows only the Supabase origin for realtime.
- Tenant isolation is enforced at the application layer
  (session-derived `schoolId` scoping) and is regression-tested:
  `tests/security/tenant-isolation.test.ts` (57/57) and
  `tenant-isolation-model.test.ts` — both green at `6a6f830`.

**Disposition: keep deny-by-default.** Adding permissive policies would
*weaken* the boundary (a policy that allows `anon` anything is strictly
worse than no policy). Only if a future feature queries tables through
PostgREST (none exists or is planned) should a narrowly-scoped policy be
authored per table, with tenant predicates — reviewed like any security
change. The 112 advisor rows are recorded as **investigated → intentional**.

## 2. `pg_trgm` in the public schema (1 finding, WARN) — cosmetic

`pg_trgm` was installed into `public` by migration
`00000000000002_pg_rls_search` because its 24 GIN search indexes
(`User_name_trgm`, …) are intentional raw-SQL DB-level accelerators
(documented in `docs/CI.md` — the drift gate's sanctioned exception
family). The advisor suggestion (move the extension to the `extensions`
schema) is hygiene, not a vulnerability: the extension exposes no
unprivileged functions of concern here. **Disposition: optional forward
migration, low priority; never a rename of the index family** (the CI
drift gate asserts the counts 24/11).

## 3. Unindexed foreign keys (68 findings) — real, cold-path, scale-dependent

Ground truth (live `pg_constraint` × `pg_indexes`, strict
leading-column rule — reproduces the advisor's 68 exactly):
**197 FK constraints in `public`; 129 covered; 68 uncovered** (36 of
those have the column *somewhere* in a composite index — partial
coverage; 32 have no index containing the column at all).

Row counts of the affected tables (live `pg_stat_user_tables`):
the largest is **653 rows** (`ExamMark`); most are < 100 rows; 17
tables are empty. At this scale every one of these joins is a trivial
seq scan. The hot query paths were already deliberately indexed by the
existing chain (`20261002000200_8c_hot_path_indexes`,
`20261004154000_schoolid_indexes_tenant_tables`,
`20261008071751_fk_hotpath_indexes_settlement_exam_schedule`).

**Disposition — targeted forward migrations only, when evidence appears:**
1. First candidates *if* slow-query evidence appears at scale (largest
   tables + heaviest filter usage):
   `ExamMark(subjectId)`, `ActivityLog(userId)`,
   `CurriculumTopic(subjectId)`, `Timetable(classId | subjectId |
   teacherUserId)`, `ExamScheduleItem(classId | subjectId)`,
   `ExamSubjectConfig(classId | subjectId)`.
2. Everything else (audit-log FKs, junction tables, empty tables,
   admin-surface FKs like `Notification.senderId`) — index **only** when
   a real query pattern demands it, one reviewable migration at a time.
3. **No blanket index creation** — see §4.

## 4. Unused indexes (60 findings) — over-indexing evidence, do NOT add more

The 60 unused findings are dominated by the deliberate families:
24 `*_trgm` search indexes, 25 `*_schoolId*` tenant-scan indexes, 11
hot-path composites — all created for **expected** traffic that
production has not yet generated (84 students, near-zero search/API
volume). They are the documented, sanctioned families; "unused" today
is expected pre-scale, not a defect. But they are also the proof that
index sprawl is a real cost: each new index slows every write.

**Disposition: freeze.** No new indexes without a query-plan or slow-log
citation. Revisit the unused report after real traffic exists; drop
only with a deliberate migration (the trgm/schoolId families are
contractual — never dropped without updating the CI drift gate).

## 5. Email delivery (adjacent finding, from the same audit)

Production `EmailDelivery` (read-only): **25 SENT** — all to the Resend
account owner (the documented `onboarding@resend.dev` shared-sender
restriction: only the owner's address is deliverable) — and **5 FAILED
`HTTP 403 "You can only send testing emails to your own email
address"`** (real-recipient attempts). The pipeline
(outbox → transport → audit) is proven working end-to-end; **real-user
delivery is blocked solely on sending-domain verification**, and the
handoff API key currently fails `GET /domains` (invalid). Owner actions:
valid Resend key → add + verify the sending domain → set `EMAIL_FROM`
on both planes → create the Resend webhook +
`RESEND_WEBHOOK_SECRET` (`docs/EMAIL.md`).

## Summary table

| Finding | Count | Verdict | Action |
| --- | --- | --- | --- |
| `rls_enabled_no_policy` | 112 | **intentional** deny-by-default; access exclusively server-side | none (documented here) |
| `extension_in_public` (pg_trgm) | 1 | intentional raw-SQL index family home | optional cosmetic migration |
| `unindexed_foreign_keys` | 68 | real; cold-path; largest table 653 rows | targeted forward migrations only on slow-query evidence |
| `unused_index` | 60 | expected pre-scale for sanctioned families | freeze — no new indexes without evidence |
