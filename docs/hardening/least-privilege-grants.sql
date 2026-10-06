-- LEAST-PRIVILEGE GRANTS — reference companion (audit 2026-10-06)
--
-- Status: MIGRATION CREATED, AWAITING OWNER APPROVAL FOR PRODUCTION.
-- The canonical forward SQL lives in the Prisma migration (the only
-- migration authority):
--
--   prisma/migrations/20261006123000_least_privilege_grants/migration.sql
--
-- This file is the dashboard/rollback/verification reference. Policy,
-- rationale, and procedures: docs/hardening/DATABASE_GRANTS.md.
--
-- Correction vs. the earlier draft (audit 2026-10-06):
--   · ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin was REMOVED —
--     postgres is not a member of supabase_admin, so that statement
--     fails with permission denied on Supabase, and platform default
--     privileges are out of scope by policy anyway.
--   · The blanket "REVOKE ALL ON ALL TABLES" was replaced by the
--     per-object loop in the migration (same effect, notices, portable).
--
-- Applying by hand (only if the prod-migration pipeline is unavailable):
--   1. Review docs/hardening/DATABASE_GRANTS.md §13 (the gate).
--   2. Get explicit owner approval for the production grant change.
--   3. Prefer: bun scripts/prod-migration/apply.ts … (records the
--      migration in _prisma_migrations). Hand-run the migration.sql
--      body only if you accept NOT having it recorded.
--   4. Verify with the queries below.
--
-- Idempotent: safe to re-run.

-- ── FORWARD (verbatim from the migration — see the file) ─────────────────
-- DO block 1: per-object REVOKE loop over public tables/views
-- DO block 2: REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
-- DO block 3: ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--             REVOKE ALL ON TABLES/SEQUENCES FROM anon, authenticated
-- NOTIFY pgrst, 'reload schema'

-- ── ROLLBACK (exact inverse — restores the Supabase baseline) ────────────
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

-- ── VERIFICATION ─────────────────────────────────────────────────────────
-- 1. Zero anon/authenticated grants remain on public objects (expect 0):
SELECT count(*) AS residual
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) x
JOIN pg_roles r ON r.oid = x.grantee
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
  AND r.rolname IN ('anon','authenticated');

-- 2. service_role still holds SELECT on every table (expect 112):
SELECT count(*) AS svc_tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) x
JOIN pg_roles r ON r.oid = x.grantee
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND r.rolname = 'service_role' AND x.privilege_type = 'SELECT';

-- 3. RLS census unchanged (expect rls_on = total = 112):
SELECT count(*) AS total, count(*) FILTER (WHERE c.relrowsecurity) AS rls_on
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = false;

-- 4. Default privileges: postgres/public, tables + sequences
--    (expect NO anon/authenticated, service_role present; functions unchanged):
SELECT d.defaclobjtype AS objtype, d.defaclacl::text AS acl
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public' AND pg_get_userbyid(d.defaclrole) = 'postgres'
ORDER BY 1;

-- 5. Negative probe as the client roles (expect 42501 permission denied,
--    NOT an empty set):
SET ROLE anon;
SELECT count(*) FROM "Student";   -- 42501: permission denied for table Student
RESET ROLE;

-- 6. Future table stays closed (end-to-end default-ACL proof):
CREATE TABLE public.__probe(id int);
SELECT has_table_privilege('anon', 'public.__probe', 'SELECT');          -- false
SELECT has_table_privilege('service_role', 'public.__probe', 'SELECT');  -- true
DROP TABLE public.__probe;
