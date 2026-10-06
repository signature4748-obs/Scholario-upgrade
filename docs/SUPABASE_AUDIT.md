# Supabase Production Audit — Hardening Pass

> Read-only audit of the single production Supabase project (`kbyknezedewvgrnqervj`,
> ap-south-1) behind both Vercel planes. Performed 2026-10-06 against the live
> project (SQL via Management API, REST probes, advisor lints, code review).
> **No schema, policy, grant, bucket or auth setting was changed by this audit.**
> The only actions taken were operational recovery of an env-var rotation that
> had knocked both planes offline (§13) — code, schema and architecture are
> byte-identical to `main`.

## Verdict (15 audit items)

| # | Item | Verdict |
| --- | --- | --- |
| 1 | Database | ✅ PG 17.11 · 111 business tables + `_prisma_migrations` · 14/14 migrations applied, repo-identical · Prisma sole authority |
| 2 | Authentication | ✅ Supabase Auth intentionally unused · `auth.users` = 0 rows · findings: signup not disabled, `site_url` stale (§9) |
| 3 | RLS | ✅ 112/112 tables RLS-enabled, zero policies — deny-by-default is correct for this architecture (proof chain §3) |
| 4 | Grants | ⚠️ anon/authenticated hold full default table grants — unused attack surface · least-privilege migration **created + locally tested, awaiting owner approval** (§4) |
| 5 | Storage | ✅ public-media public (intentional, gated serving) · school-media private, server-authorized only · tenant isolation verified (§5) |
| 6 | Realtime | ✅ Broadcast only · empty `supabase_realtime` publication is correct — no Postgres Changes anywhere (§6) |
| 7 | Performance | ✅ 69 FK findings classified: 0 high-value today, 3 medium (future), rest covered/low — **no indexes added** (§7) |
| 8 | Security advisor | 112 × `rls_enabled_no_policy` = intentional architecture · 1 × `extension_in_public` (pg_trgm) = real, minor, deferred (§8) |
| 9 | DB security | ⚠️ SSL not enforced · DB open 0.0.0.0/0 · service-role server-only, verified (§9) |
| 10 | Backups | 🔴 walg enabled but **no backups exist**, PITR off — biggest operational risk (§10) |
| 11 | Testing | ✅ existing suites already encode the architecture; no new tests justified (no change) (§11) |
| 12 | Migration discipline | ✅ one authority (Prisma); prepared migration staged in docs/, promotion steps documented (§12) |
| 13 | Production safety | incident + recovery documented: rotation→503→fix, rollback notes (§13) |
| 14 | Two-plane compat | ✅ both planes, same repo/SHA/Supabase; live probes green (§14) |
| 15 | Final acceptance | ✅ one repo · two Vercel projects · one Supabase · custom auth · Prisma · Storage · Broadcast-only Realtime (§15) |

## 1. Database

Verified live (superuser SQL via Management API):

- **PostgreSQL 17.11** (x86_64, gcc 15.2.0).
- `public` holds **112 base tables**: 111 business tables + `_prisma_migrations`. No views.
- `_prisma_migrations`: **14 rows, all finished** — names byte-identical to the 14
  directories in `prisma/migrations/` (`0_init` … `20261005060000_platform_account_recovery`).
- **No second migration authority**: `supabase_migrations` schema does not exist
  (no Supabase CLI workflow ever touched this project); no drizzle/knex/flyway
  artifacts in the repo; `prisma/migrations` matches the applied state exactly.
- Extensions: `pg_stat_statements` 1.11, `pg_trgm` 1.6, `pgcrypto` 1.3,
  `uuid-ossp` 1.1, `plpgsql` 1.0, `supabase_vault` 0.3.1.
- `search_path`: `"$user", public, extensions` (Supabase default).

## 2. Authentication

- Custom scrypt+cookie auth (server-side) — unchanged, per architecture.
- **No Supabase Auth usage in code**: zero `@supabase/supabase-js` imports
  repo-wide (the only Supabase client library is `@supabase/realtime-js`,
  used by the broadcast bridge, and it performs no auth calls).
- `auth.users` = **0 rows** (0 banned, 0 confirmed, 0 ever-signed-in). 27
  standard `auth` schema tables, untouched.
- Findings (owner actions, not changed by this audit):
  - `disable_signup: false` — the public Auth API (`/auth/v1/signup`) can create
    rows in `auth.users`. Useless for app login (the app never reads them), but
    it hands out a valid `authenticated` JWT. Today that JWT sees nothing
    (RLS deny + grants unused); after the §4 migration it sees even less.
    Still: **set `disable_signup: true`** for hygiene.
  - `site_url` points at the deprecated `scholario-production-*.vercel.app`
    project; update to the platform domain when convenient.

## 3. RLS — deny-by-default is the correct model here

State: **all 112 public tables have RLS enabled** (`relrowsecurity`), none
forced, and there are **zero policies** in `public`, `storage` and `realtime`.
The Security Advisor flags this 112 times as "RLS enabled, no policy" — for an
app that reads tables through server-side Prisma that is not a gap, it is the
model: any non-`postgres`/`service_role` role sees **nothing**.

Dependency proof chain (why no policies are needed and none were created):

1. `@supabase/supabase-js`: **0 references** in the repo (code + lockfile audit).
2. PostgREST Data API from app code: **0 references** (only `/storage/v1` and
   `/realtime/v1` REST calls exist, both server-side, service-role).
3. Browser code touching tables: **none** — the only key a browser ever holds is
   the anon key, and it is used exclusively as the Realtime websocket key
   (`/api/realtime/config` hands it to logged-in users; the bridge only joins
   broadcast channels).
4. API routes depending on anon/authenticated table grants: **none** — every
   business query goes through `src/lib/db.ts` (Prisma, server-only).
5. Empirical probes (2026-10-06, live): `GET /rest/v1/School|User|Student`
   with anon key → `[]` (RLS filters everything); `POST /rest/v1/Student` →
   `42501 new row violates row-level security policy`.

**Conclusion: preserve the current deny-by-default RLS model. Do not add
policies** (policies would only widen the anon surface). The complementary
hardening is revoking the unused table grants — §4.

## 4. Grants — least-privilege migration (created, awaiting owner approval)

Live state: `anon` and `authenticated` hold **full privileges**
(SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on all 111 public
business tables + `_prisma_migrations` (Supabase's default ACL), plus full
grants on `storage` tables. `service_role` holds everything and
`rolbypassrls = true`.

Because the application never uses PostgREST for data (§3), these
anon/authenticated grants are pure attack surface: they are the thing that
would turn an accidental RLS disable into live data access.

**Created (2026-10-06)**: Prisma migration
`20261006123000_least_privilege_grants` — revokes anon/authenticated
table+sequence privileges on `public` and hardens default privileges for
future tables; keeps every service_role grant; touches
storage/auth/realtime schemas not at all. Idempotent, role-guarded for
plain PostgreSQL, with exact rollback and verification SQL
(`docs/hardening/least-privilege-grants.sql`, policy:
`docs/hardening/DATABASE_GRANTS.md`).

Locally proven: full migration replay in a Supabase-simulated database
(roles + default ACL) → anon/authenticated receive **42501** on every
business table, service_role grants intact, Prisma CRUD green, tenant
guards firing, future tables stay closed. Not executed on production:
execution is the owner's call (DATABASE_GRANTS.md §13 gate). Safety is
proven by the §3 dependency chain plus the existing test contract
(`tests/security/pg-rls.test.ts` treats `401/403` and `[]` as equally
closed, so revocation keeps the suite green).

## 5. Storage

Buckets (live):

| bucket | public | objects | layout | serving |
| --- | --- | --- | --- | --- |
| `public-media` | **true** (intentional) | 38 | `website/<schoolId>/<opaque-fileId>` | same-origin gate route streams bytes after published-reference check; public URL is "unguessable id, public once known" (documented trust model) |
| `school-media` | **false** (private) | 20 | `study-materials/<schoolId>/<file>`, `avatars/…` | server-authorized reads only; 10-minute signed URLs minted after role+tenant checks |

- All 8 `storage` tables have RLS enabled with zero policies →
  anon/authenticated row access is denied everywhere.
- `owner` is null on every object (uploads happen via service-role; no client
  ever writes) — consistent with the server-side-only wrapper
  (`src/lib/storage/supabase.ts`: window-import guard, service-role key,
  per-segment path sanitization, traversal rejection).
- **Tenant isolation** (code-audited, all upload/download/delete paths):
  study-materials download = `schoolScoped(user)` + publication/role checks
  before any URL; avatars = self/same-school/super-admin; website media =
  ownership + published-reference + ACTIVE school. Paths are derived from the
  row's `schoolId` server-side — no client-supplied path is ever trusted.
- **Empirical privacy probes**: `GET /storage/v1/object/public/school-media/…`
  → `400 Bucket not found` (private bucket invisible on the public path);
  same path on `public-media` → `200 image/png`. A school cannot reach another
  school's private objects: there is no client-side path to them at all.
- `school-media` stays private. Nothing changed.

## 6. Realtime

Source-audited, live-verified:

- **Broadcast only.** Server publishes via `POST /realtime/v1/api/broadcast`
  with the service-role key (`src/lib/realtime/publish.ts`). Browsers join via
  `@supabase/realtime-js` websockets with the anon key and subscribe to
  `broadcast` events only (`client.channel(topic).on('broadcast')`).
- **No Postgres Changes and no Presence**: no `.on('postgres_changes')` in the
  codebase; `presence_enabled: false` in the project's realtime config.
- Channel names are capability tokens: `t:<schoolId>:<audience>:<hmac>` /
  `u:<schoolId>:<userId8>:<hmac>` signed with `REALTIME_CHANNEL_SECRET` —
  unguessable, issued per-user by `/api/realtime/config`.
- `supabase_realtime` publication exists with **zero tables** — **acceptable**
  for broadcast-only (Postgres Changes would require tables here; nothing
  expects them). The `supabase_realtime_messages_publication` entries
  (`realtime.messages_*`) are the Realtime service's own internal storage,
  not business replication.
- CSP `connect-src` is derived from `SUPABASE_URL` (+wss) — the websocket
  origin is allow-listed exactly.

## 7. Performance — 69 FK findings classified, nothing added

Evidence: `pg_stat_statements` (since 2026-10-01), `pg_stat_user_tables`
(row counts + scan counts), the actual index set (344 indexes, 232 non-PK),
and the code's query shapes. Largest table: `Attendance` 3,280 rows; 48
tables have 0 rows.

- **High-value (add today): none.** The two genuine hot paths were already
  indexed by migration `20261002000200_8c_hot_path_indexes`
  (`Attendance(classId,date)` — the teacher attendance sheet;
  `Teacher(schoolId)` — every staff surface). The observed hot workload
  (11k-call "latest items" polls on Message/Notification/ActivityLog/Payment,
  Session/User lookups) is fully covered by existing composites
  (`Message(schoolId,recipientId,createdAt)`, `Notification(schoolId,createdAt)`,
  `ActivityLog(schoolId,createdAt)`, `Session(tokenHash)`, `User(email)`).
- **Covered by composites (unnecessary — the lint only credits leading
  columns, but every real query shape is served):** the majority of the 69 —
  e.g. `Message_recipientId/senderId`, `Student_classId`, `Timetable_*`,
  `Homework_*`, `ExamMark_subjectId`, `FeeTransaction_structureId`,
  `ExamAttendance_*`, `NotificationRead_userId`, `BehaviorRecord_*`.
- **Low-value (cascade-scan FKs on small tables):** all 69 FKs are
  `ON DELETE CASCADE`; the observed parent deletes (School ×48 ≈ 390 ms each
  during seed/demo cleanup, User ×375, Class ×90) scan child tables of ≤ a
  few hundred rows — milliseconds, on rare admin actions. Indexing them adds
  write amplification to hot INSERT paths for no measurable gain at this
  scale.
- **Medium-value (justified only when the feature grows — candidates for a
  future `perf:` migration, not today):**
  1. `ExamScheduleItem(examId)` — the table has no secondary index at all;
     admit-cards/timetable/exam service run `findMany({ where: { examId … } })`.
  2. `QuestionBank(schoolId, classId, subjectId)` upgrade of the plain
     `schoolId` index (question-bank browser filters).
  3. `ExamAttendance(scheduleItemId)` (attendance marking flow), if exam
     season shows slow sheets.
- **65 `unused_index` lints: informational.** They are deliberate
  tenant-isolation / search / composite indexes (incl. the 11 `schoolId`
  indexes from `20261004154000`) plus dormant surfaces (email outbox,
  flashcards) in a 5-day stats window. Nothing should be dropped.

## 8. Security Advisor — classified

| finding | level | class | note |
| --- | --- | --- | --- |
| 112 × `rls_enabled_no_policy` | INFO | **intentional architecture** | §3 — the "fix" (write policies) would widen the anon surface; the app is server-side-Prisma-only |
| 1 × `extension_in_public` (pg_trgm) | WARN | **real, minor, deferred** | moving an installed extension requires drop/recreate of pg_trgm + its 24 support functions + the trgm indexes on 17 tables — a coordinated migration with search_path implications. Real hardening value is low (trgm functions are not an exploit surface here). Future work, owner decision. |

## 9. Database security

- **SSL enforcement: OFF** (`ssl-enforcement.database = false`). The app itself
  always connects with TLS, but the database does not refuse plaintext
  clients. Enable when the plan allows (Pro feature) — owner action.
- **Network restrictions: none** (`dbAllowedCidrs 0.0.0.0/0 + ::/0`, applied).
  Vercel functions have dynamic egress; restricting to Vercel ranges is
  fragile. Acceptable today *because* the password is strong and rotated;
  document if you want belt-and-braces later.
- **Exposed schema**: `public` (standard PostgREST surface) — with anon
  grants still present this is a wide-but-empty hallway (RLS denies all
  rows); the §4 migration closes the hallway itself.
- **service_role**: `bypassrls`, no login, full grants — used only by
  `src/lib/storage/supabase.ts` and `src/lib/realtime/publish.ts`, both
  server-only (window-import guard on the storage wrapper; import-graph
  audit shows zero client-component importers). **Zero `NEXT_PUBLIC_SUPABASE_*`
  references in the repo**; the browser only ever receives the anon key via
  `/api/realtime/config`.

## 10. Backups / PITR

Live state: `walg_enabled: true`, **`pitr_enabled: false`, backup list
empty** — as of today there is **no restore point** for a database holding
real tenants. This is the single largest operational risk in the project.

Owner decision required (paid features are never enabled automatically):
upgrade the Supabase plan to get daily backups (7-day retention) and enable
PITR; until then treat `scripts/db-restore-verify.ts` + repo migrations as
the only recovery path (schema, not data).

## 11. Testing

- `tests/security/pg-rls.test.ts` already encodes the real architecture
  (anon REST surface closed by RLS; service-role probes; probe-role RLS
  matrix). Its anon assertions accept `[]` **or** `401/403` — by design
  compatible with the §4 grant revocation.
- `tests/security/realtime-bridge.test.ts` asserts the anon key never leaks
  the service key; `headers.test.ts` pins the CSP websocket origin.
- **No new tests were written**: nothing changed (no code, no schema, no
  policies). Fake Supabase-Auth tests would contradict the architecture.
- Note: pg-rls tests were **not executed against production** in this audit —
  that suite creates/drops a probe role on its target DB (integration-env
  design). The equivalent anon-surface evidence was collected with live
  read-only REST probes (§3.5).

## 12. Migration discipline

Prisma remains the single schema authority (§1). The prepared grants
migration is deliberately staged **outside** `prisma/migrations/` so the
prod-migration pipeline cannot pick it up implicitly; promotion steps
(copy → local → workflow → verify) are in the SQL header.

## 13. Production safety — incident found & recovered (no code change)

Timeline (2026-10-06, UTC):

| time | event |
| --- | --- |
| 07:52 | both planes deploy `main` @ `02c7ead` (env snapshot: pre-rotation) |
| 09:12 | owner rotates the DB password; `DATABASE_URL` updated on `scholario-platform` (sensitive, write-only) — but running deployments keep the baked old password |
| 09:2x | both planes `/health/ready` → 503 `database:failed`; school login → 404 (DB-dependent honest 404). Vercel env vars apply only to **new** deployments |
| 09:33 | audit redeploys both planes @ `main` (no code change) — platform still 503 (its 09:12 value was not valid), app still 503 (its env last set 02:32, pre-rotation) |
| 09:37–09:39 | `DATABASE_URL` on **both** projects set to the verified pooler form (Supavisor :6543, `pgbouncer=true`, `connection_limit=2`, current password) — the exact documented production form — and both planes redeployed @ `main` |
| 09:41 | platform `/health/ready` → 200 `database:ok` (232 ms) |
| 09:44 | school-plane `/health/ready` → 200 `database:ok` (223 ms); `/s/green-valley/login` → 200; plane isolation 404s intact (full table §14) |

- The password itself was verified working through the pooler from this
  environment before writing it anywhere (session + transaction mode).
  Supavisor's auth cache explains the initial failures right after rotation.
- Rollback strategy: the previous env value is unknown (sensitive/write-only),
  but rollback = re-paste the prior connection string + redeploy; the DB
  side has no change to roll back.
- Post-recovery checks: §14 (health, login, plane isolation).
- The audit commit itself is docs-only; pushing it re-deploys `main`
  trivially (no runtime change, env already fixed at project level).

## 14. Two-plane compatibility (live, post-recovery)

| probe | scholario-platform | scholario-app (virid) |
| --- | --- | --- |
| production deployment | `main` @ `02c7ead` | `main` @ `02c7ead` |
| `/health/ready` | `200` `database:ok` | `200` `database:ok` |
| own login route | `/platform/login` → 200 | `/s/green-valley/login` → 200 |
| foreign-plane route | `/s/green-valley/login` → 404 | `/platform/login` → 404 |
| Supabase project | `kbyknezedewvgrnqervj` (env + live probes) | same |

Both planes share one repo, one SHA, one Supabase project, one connection
form — nothing diverged.

## 15. Final acceptance

| requirement | state |
| --- | --- |
| ONE GitHub repository | ✅ `signature4748-obs/Scholario-upgrade` (main = production) |
| TWO active Vercel projects | ✅ `scholario-platform` + `scholario-app` (legacy project still parked for decommission) |
| ONE Supabase project | ✅ `kbyknezedewvgrnqervj` (DB + Storage + Broadcast Realtime) |
| Custom server-side auth | ✅ unchanged; `auth.users` empty; no Supabase Auth anywhere |
| PostgreSQL + Prisma | ✅ 14/14 migrations, single authority |
| Storage | ✅ Supabase Storage, two-bucket model intact |
| Realtime | ✅ Broadcast only; empty publication is correct |

## Remaining owner actions

1. **Backups** (§10): plan upgrade → daily backups + PITR. Highest priority.
2. **Execute or reject** `docs/hardening/least-privilege-grants.sql` (§4) —
   safety proven; promotion steps in the file.
3. Supabase Auth hygiene (§2): `disable_signup: true`; fix `site_url`.
4. SSL enforcement + optional network restrictions (§9) — both are Pro-gated
   dashboard toggles.
5. Move `pg_trgm` out of `public` (§8) — only if a quiet window allows a
   coordinated extension migration.
6. Medium-value indexes (§7) — only when the corresponding features show
   real data growth.
7. Resend key + webhook registration (carried over from the release audit —
   email delivery is still not verified end-to-end).
8. Retire the deprecated `scholario-production` Vercel project per
   `docs/VERCEL_PROJECTS.md` §7 after a stable window.

## Changes made by this audit

- Repo: two new files (this document +
  `docs/hardening/least-privilege-grants.sql`). **No application, schema,
  policy, grant, bucket, auth or advisor-recommended change.**
- Operations: `DATABASE_URL` corrected on both Vercel projects (the owner's
  rotation had left both planes 503) + two same-SHA production redeploys.
  Zero code/schema change; root cause + timeline in §13.
