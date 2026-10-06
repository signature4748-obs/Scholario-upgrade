# Database Grants Policy — Least-Privilege for the Data API Surface

**Status (2026-10-06):** migration `20261006123000_least_privilege_grants` is
**APPLIED TO PRODUCTION and fully verified** (owner-approved run, §16).
Applied at 2026-10-06T14:23:33Z via the prod-migration pipeline; every
verification in §14/§16 is green. anon/authenticated now hold **zero**
public-business-table privileges; service_role/postgres unchanged; RLS
unchanged (112/112 enabled, 0 policies); default ACL closed for future
postgres-created tables.

The application's access model, proven by repo audit + live probes:

```
browser → Vercel → custom auth/session → Prisma → PostgreSQL (role postgres)
                 ↘ Supabase Realtime (broadcast, anon key = channel key only)
                 ↘ Supabase Storage  (server-side REST, service-role only)
```

The Supabase Data API (PostgREST, roles `anon` / `authenticated`) is **not
used for business data — by design** — and this migration makes that
enforced at the grant layer instead of relying on RLS alone.

## 1. Why the grants were removed

Live inventory (read-only, 2026-10-06):

| object class | count | state before |
|---|---|---|
| public tables | 112 (111 Prisma models + `_prisma_migrations`) | 108 carried full anon/authenticated grants (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) |
| views / matviews / sequences | 0 | — |
| functions | 65 | 31 pg_trgm (extension), 33 tenant-guard trigger fns, 1 `rls_auto_enable` event trigger |
| default ACL (`FOR ROLE postgres IN public`) | 3 entries | future tables/sequences/functions auto-granted anon/authenticated |

Four tables (`EmailDelivery`, `SalaryPayment`, `SalaryStructure`,
`TenantDomain`) were already cleaned by migration
`20261002000100_8c_rls_close_8b_gap` — this migration generalizes that
repair to the whole schema.

The removed grants were **dormant but dangerous**: RLS (enabled on 112/112
tables, zero policies) already denies every row for anon/authenticated, so
the grants surfaced as empty result sets, not data. But they are the exact
thing that would turn *one accidental `ALTER TABLE … DISABLE ROW LEVEL
SECURITY`* into live read/write data access through the auto-REST surface
with only the publishable anon key. Removing them makes the deny
two-layered: RLS *and* privilege.

## 2. Why RLS policies remain zero

Zero policies is the intended posture (audit §1): the application connects
as `postgres` (bypassrls) through Prisma and performs authorization in the
server layer; client-facing roles get deny-by-default with no per-role
policy surface to maintain or get wrong. This grants change does not add
policies — it removes privileges. RLS stays 112/112 enabled, 0 policies.

## 3. How Prisma accesses PostgreSQL

`src/lib/db.ts` → `new PrismaClient()` with `env("DATABASE_URL")` —
the Supavisor pooler as role `postgres` (owner of every public table,
`rolbypassrls`). 235 server modules import `@/lib/db`. The migration does
not touch postgres's grants, ownership, or the datasource URL; the only
files that hold `SUPABASE_SERVICE_ROLE_KEY` are server-side (`storage`
wrapper with a window guard, realtime REST publisher) and the anon key is
only handed to browsers as the Realtime websocket key — never used for
business-data queries.

## 4. Why the Data API is intentionally unavailable for business data

- No `@supabase/supabase-js` anywhere in the codebase.
- No `createClient()`, no `/rest/v1/` calls, no GraphQL, no `.rpc()`.
- Storage is accessed through server-side REST wrappers (service-role).
- Realtime is Broadcast-only; channels are HMAC capabilities
  (`REALTIME_CHANNEL_SECRET`), and broadcast never reads `public` tables.

Because nothing legitimate speaks to PostgREST as anon/authenticated,
closing it costs nothing and removes an entire attack class. The anon key
leaking (it is public by design) now yields: **42501 permission denied**
on every business table, instead of RLS-filtered empty sets.

## 5. What the migration does (forward)

`prisma/migrations/20261006123000_least_privilege_grants/migration.sql`:

1. `REVOKE ALL` from `anon, authenticated` on every current table/view in
   `public` (per-object loop, notices, no-ops where grants are absent).
2. Same for all sequences in `public` (0 exist today — future-proofing).
3. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL
   ON TABLES/SEQUENCES FROM anon, authenticated` — future Prisma-created
   tables no longer auto-grant the client roles. `service_role` default
   grants are retained.
4. `NOTIFY pgrst, 'reload schema'` so the Data API cache refreshes.

All blocks are guarded by `to_regrole('anon')` so plain PostgreSQL (local
dev, CI, Prisma shadow DB) skips them with a NOTICE — same portability
pattern as the 8c migration. REVOKE of absent privileges is a NOTICE, so
the migration is idempotent.

## 6. What is deliberately NOT changed

| surface | decision |
|---|---|
| `service_role` / `postgres` grants | untouched — storage wrapper, realtime REST publish, future PostgREST probes all keep working |
| function EXECUTE | untouched (see §7) |
| default privileges `FOR ROLE supabase_admin` | untouched — internal Supabase role; its public objects are pg_trgm extension objects |
| schema USAGE on `public` for anon/authenticated | kept — USAGE without table privileges grants nothing (no CREATE either); removing it would only break PostgREST's ability to answer cleanly |
| `storage` / `realtime` / `auth` / `extensions` / `graphql*` schemas | untouched — Supabase internals |
| RLS state | untouched — 112/112 enabled, 0 policies |

## 7. Functions are a separate surface (review, no revokes)

Full live review of all 65 public functions:

- 31 pg_trgm support/scalar functions (owner `supabase_admin`, C): extension
  objects; revoking EXECUTE would risk extension behavior — kept. The
  scalar ones (`similarity`, `show_trgm`, …) remain anonymously callable
  via RPC and only compute trigrams of caller-supplied strings — no
  database data access. Accepted.
- 33 tenant-guard functions: return type `trigger` — PostgreSQL refuses
  direct invocation, and PostgREST RPC with a trigger function errors.
  No callable surface exists; EXECUTE grants are inert for Data API
  purposes. Trigger invocation runs as the mutating role (postgres).
- `rls_auto_enable` (`SECURITY DEFINER`, `search_path = pg_catalog`,
  owner postgres, EXECUTE limited to postgres+service_role): already
  locked down by migration
  `20261002000300_8c_n_function_security_closure`. Reviewed — body only
  enables RLS on new public tables; no args, no data access.

New SECURITY DEFINER functions must always pin `search_path` and restrict
EXECUTE (follow `rls_auto_enable`'s pattern). If a future callable
function is added to `public`, review its EXECUTE grants before it ships.

## 8. Expected behavior after deployment: 42501 is success

| probe | before | after |
|---|---|---|
| `anon` SELECT business table (SQL) | 0 rows (RLS silent deny) | **42501 permission denied** |
| `anon`/`authenticated` INSERT | 42501 row-level security | **42501 permission denied** |
| `GET /rest/v1/Student` with anon key | 200 `[]` | **403/401, no data** |
| `service_role` reads | rows | rows (unchanged) |
| Prisma (role postgres) | full CRUD | full CRUD (unchanged) |

`tests/security/pg-rls.test.ts` accepts `[]` or 401/403 as "equally
closed" — it stays green. A 42501 from a Data API probe is the *intended
result of this hardening*, not a Scholario failure.

## 9. How to audit a new table

Every new Prisma model lands in `public` with:

1. RLS auto-enabled by the `ensure_rls` event trigger (verify anyway).
2. No anon/authenticated grants (default ACL hardened by §5.3).
3. `service_role` grants from the retained default ACL.

Checklist for any new table:

```sql
-- RLS on, grants closed:
SELECT c.relrowsecurity AS rls,
       has_table_privilege('anon', 'public."NewTable"', 'SELECT') AS anon,
       has_table_privilege('authenticated', 'public."NewTable"', 'SELECT') AS auth,
       has_table_privilege('service_role', 'public."NewTable"', 'SELECT') AS svc
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'NewTable';
-- expect: rls = true, anon = false, auth = false, svc = true
```

If a new table needs a tenant guard, add a trigger function following the
`tg_guard_*` pattern (returns `trigger`, plain plpgsql, tenant predicate).

## 10. How to verify default privileges

```sql
SELECT d.defaclobjtype AS objtype, d.defaclacl::text AS acl
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public'
  AND pg_get_userbyid(d.defaclrole) = 'postgres';
-- expect objtype 'r' and 'S' ACLs WITHOUT anon/authenticated,
-- WITH service_role; objtype 'f' unchanged (see §7).
```

And the end-to-end probe — create a throwaway table as postgres, then:

```sql
SELECT has_table_privilege('anon', 'public.__probe', 'SELECT');  -- false
SELECT has_table_privilege('service_role', 'public.__probe', 'SELECT'); -- true
DROP TABLE public.__probe;
```

## 11. Adding a Data API exception (future public endpoint)

If a future feature genuinely needs PostgREST access to a table (e.g. a
public read-only API), do it **per object, never by re-opening the schema**:

```sql
GRANT SELECT ON TABLE public."PublicThing" TO anon;         -- read-only
ALTER TABLE "PublicThing" ENABLE ROW LEVEL SECURITY;         -- stays on
CREATE POLICY public_read ON "PublicThing"                   -- explicit, scoped
  FOR SELECT TO anon USING (published = true);
-- REVOKEs stay revoked for everything else; review like a SECURITY
-- DEFINER function: what exactly does this expose, to whom, for which rows?
```

A named RLS policy scoped to one table is an explicit, reviewable
exception — the opposite of the blanket grants this migration removed.

## 12. Rollback procedure

Exact inverse (restores the Supabase baseline), executed as postgres:

```sql
DO $$
BEGIN
  IF to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT ALL ON SEQUENCES TO anon, authenticated;
    NOTIFY pgrst, 'reload schema';
  END IF;
END $$;
```

Rollback takes effect immediately (no redeploy needed — the application
never used these grants). Use the §9/§10 queries to confirm state, and
expect `GET /rest/v1/<table>` with the anon key to return `[]` again.

## 13. Production deployment gate (owner approval required)

**EXECUTED 2026-10-06.** The gate was honored end-to-end:

- Current/target/impact/rollback were presented as below (and as the
  migration header) BEFORE execution.
- The owner explicitly approved applying this migration to production
  (recorded in §16).
- Execution went through the standard prod-migration pipeline
  (`scripts/prod-migration` — preflight snapshot → transactional apply →
  verify), never SQL by hand.

For the historical gate record:

- Current: anon/authenticated → full public-table privileges (dormant
  under RLS).
- Target: anon/authenticated → no public-table privileges.
- Impact: direct Supabase Data API access to business tables is
  denied (42501/401-403). Application path Vercel → Prisma → PostgreSQL is
  unchanged. Expected application impact: **none** (repo + live evidence,
  §3/§4).
- Rollback: §12.
- Execution: the standard prod-migration workflow
  (`scripts/prod-migration` pipeline — apply, verify, then the §14
  checklist). Do NOT run SQL by hand if the pipeline is available.

## 14. Post-deploy verification checklist — RESULTS (2026-10-06 run)

1. `SELECT count(*) … anon/authenticated grants` → **0** ✓ (live re-run:
   0 objects, 0 privilege pairs; was 108 objects / 864 pairs per role).
2. service_role still has 8 privileges on 112 tables ✓ (896 pairs —
   unchanged).
3. RLS census still 112/112, 0 policies ✓.
4. `pg-rls.test.ts` (Supabase integration env) green; anon REST probe →
   401/403 ✓ (live probes below — the suite's "equally closed" contract
   accepts the new 401 bodies; the suite was not re-executed against
   production in this run — its probe-role design forbids that — the live
   REST/SQL probes are the production evidence).
5. `/health/ready` → 200 `database:ok` on both Vercel planes ✓ (re-probed
   after the migration).
6. Platform login + school login (green-valley, hawkings-prithvipur) +
   cross-plane 404s ✓.
7. Storage smoke ✓ — service-role list 200; sign+fetch of a real
   school-media object (HTTP 200 application/pdf); anon direct fetch
   denied; public-media no-key fetch HTTP 200 image/png.
8. Realtime broadcast smoke ✓ — websocket subscribe + REST publish
   (service-role) → frame delivered to subscriber; `phx_reply` shows
   `postgres_changes: []`.
9. Supabase Security Advisor re-run ✓ — 112 × `rls_enabled_no_policy`
   (INFO, intentional) + 1 × `extension_in_public` (WARN, pre-existing
   deferred pg_trgm) — identical to the audit baseline, **no new
   findings**, no grant-related findings.

## 15. Residual risks

- Objects created by `supabase_admin` in `public` (extension installs,
  e.g. pg_trgm upgrades) still follow Supabase's own default ACL —
  platform-managed, out of scope by policy.
- Function default privileges for `FOR ROLE postgres IN public` still
  grant EXECUTE to anon/authenticated, and PostgreSQL grants PUBLIC
  EXECUTE on functions by default. Deliberate: blanket revoking PUBLIC
  EXECUTE without function-by-function need risks extension breakage;
  today no callable function has data access (§7). Re-review whenever a
  new non-trigger function is added.
- `pg_trgm` scalar functions stay anonymously callable (no data access).
- If Supabase re-applies default grants during a platform upgrade, the
  §10 verification query catches it; re-run the migration statements
  (idempotent) to re-close.

## 16. Production application record (2026-10-06)

| field | value |
|---|---|
| migration | `20261006123000_least_privilege_grants` (sha256 `01e6e09e17efff53…`) |
| approval | owner-approved in writing before execution (gate §13 honored) |
| applied at | 2026-10-06T14:23:33Z (UTC) |
| channel | `scripts/prod-migration` apply (Supabase Management API, role postgres, single transaction + `_prisma_migrations` row with true Prisma checksum) |
| checkout / deployed SHA | `c8b0521` — identical on both Vercel planes (platform + school) |
| duration | 4.2 s, one transaction (REVOKEs + default ACL + history row) |

**Before → after (live inventory, read-only SQL):**

| measure | before | after |
|---|---|---|
| public objects with anon/authenticated grants | 108 | **0** |
| anon privilege pairs | 864 (108 × 8) | **0** |
| authenticated privilege pairs | 864 | **0** |
| service_role privilege pairs | 896 (112 × 8) | 896 (unchanged) |
| postgres default ACL (public, tables `r` / sequences `S`) | grants anon+authenticated+service_role | grants **service_role only** |
| default ACL `f` (functions) and all `supabase_admin` entries | full | unchanged (deliberate, §6/§7) |
| RLS census | 112/112 enabled, 0 policies | 112/112 enabled, 0 policies (unchanged) |

**Negative access (the intended hardened behavior — 42501 is success):**

- `SET ROLE anon; SELECT … "School"` → ERROR 42501 permission denied for
  table School ✓
- `SET ROLE anon; INSERT INTO "School"` → 42501 ✓
- `SET ROLE authenticated; SELECT … "Student"` → 42501 ✓
- `SET ROLE authenticated; INSERT INTO "Student"` → 42501 ✓
- `GET /rest/v1/School` with anon key → HTTP 401,
  `{"code":"42501","message":"permission denied for table School"}` ✓
  (before: `200 []` — RLS silent deny)
- future-table probe (transactional, rolled back): a table created as
  postgres receives **no** anon/authenticated grants, keeps service_role ✓

**Application access (unchanged, verified on production):**

- pipeline verify stage A–G green (row counts, credentials, indexes,
  account-recovery objects, health)
- Prisma (role postgres) live CRUD: SELECT (both tenants resolve;
  User=185, Student=82), INSERT + UPDATE + DELETE of a probe
  `GrowthEvent` row — net-zero (count back to baseline), tenant-guard
  trigger rejected a cross-tenant INSERT ✓
- both Vercel planes `/health/ready` → 200 `database:ok` post-migration
  (this endpoint runs a real Prisma query — production Prisma path proof)

**Rollback:** §12, unchanged and still valid (the §12 SQL was never needed
in this run).
