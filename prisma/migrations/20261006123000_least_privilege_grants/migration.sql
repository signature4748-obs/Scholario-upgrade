/*
 * LEAST-PRIVILEGE GRANTS — close the Supabase Data API surface on `public`.
 *
 * Audit evidence (live, 2026-10-06, read-only):
 *   · 112 tables in public (111 Prisma models + _prisma_migrations), all
 *     owned by postgres, all RLS-enabled, 0 policies (deny-by-default).
 *   · 108/112 tables carry the Supabase default grants: anon and
 *     authenticated hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
 *     TRIGGER/MAINTAIN. The other four (EmailDelivery, SalaryPayment,
 *     SalaryStructure, TenantDomain) were already cleaned by migration
 *     20261002000100_8c_rls_close_8b_gap — this migration generalizes that
 *     repair to the whole schema.
 *   · 0 views, 0 materialized views, 0 sequences in public.
 *   · No application code path uses anon/authenticated for data access:
 *     zero @supabase/supabase-js, zero PostgREST calls, zero GraphQL, zero
 *     RPC. All business access is Vercel → Prisma (role postgres) → PG.
 *   · RLS already denies every row for anon/authenticated; the grants are
 *     dormant, but would become live data access the moment RLS is ever
 *     accidentally disabled on any table. Removing them is defense-in-depth.
 *
 * What this migration does:
 *   1. REVOKE ALL table/view privileges in public from anon + authenticated
 *      (per-object loop with per-object notices — 108 tables change, the 4
 *      already-clean tables and _prisma_migrations-class objects are no-ops).
 *   2. REVOKE ALL sequence privileges in public from anon + authenticated
 *      (0 sequences exist today; covers any created before this runs).
 *   3. ALTER DEFAULT PRIVILEGES for ROLE postgres in public: future tables
 *      and sequences created by Prisma (or any postgres session) no longer
 *      auto-grant anon/authenticated. service_role keeps its default grants.
 *   4. NOTIFY pgrst 'reload schema' so PostgREST reflects the closed
 *      surface immediately (harmless no-op if no listener).
 *
 * What it deliberately does NOT touch:
 *   · service_role / postgres / supabase_admin privileges (retained fully).
 *   · Function EXECUTE (separate security surface — see
 *     docs/hardening/DATABASE_GRANTS.md: all 33 trigger functions return
 *     `trigger` and cannot be invoked directly or via RPC; rls_auto_enable
 *      is already locked by 20261002000300_8c_n_function_security_closure;
 *      pg_trgm extension functions are platform-managed).
 *   · Default privileges FOR ROLE supabase_admin (internal Supabase role —
 *      must not be changed; objects it creates in public are extension
 *      objects).
 *   · Schema USAGE on public for anon/authenticated (USAGE only, no CREATE;
 *      without table privileges it grants nothing — see docs).
 *   · storage / realtime / auth / extensions schemas (Supabase internals).
 *   · RLS state: 112/112 enabled, 0 policies — unchanged.
 *
 * Portability / idempotence:
 *   · Guarded by to_regrole('anon')/'authenticated' — on plain PostgreSQL
 *     (local dev, CI, Prisma shadow DB) the blocks no-op with a NOTICE,
 *     exactly like 20261002000100_8c_rls_close_8b_gap.
 *   · REVOKE of privileges not held is a NOTICE, not an error — re-running
 *     is safe.
 *
 * ROLLBACK (exact, restores the Supabase baseline):
 *   DO $$
 *   BEGIN
 *     IF to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL THEN
 *       GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
 *       GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
 *       ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 *         GRANT ALL ON TABLES TO anon, authenticated;
 *       ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 *         GRANT ALL ON SEQUENCES TO anon, authenticated;
 *       NOTIFY pgrst, 'reload schema';
 *     END IF;
 *   END $$;
 *
 * VERIFICATION (post-deploy):
 *   SELECT count(*) FROM pg_class c
 *   JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) x
 *   JOIN pg_roles r ON r.oid = x.grantee
 *   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
 *     AND r.rolname IN ('anon','authenticated');          -- expect 0
 *   see docs/hardening/DATABASE_GRANTS.md for the full checklist.
 *
 * Expected application impact: NONE (Vercel → Prisma → postgres path is
 * untouched). Expected Data API impact: anon/authenticated table access
 * now fails with 42501 instead of returning RLS-filtered empty sets.
 */

-- 1. Strip anon/authenticated privileges from every current table/view in
--    public (108 tables hold them; the rest are no-ops).
DO $$
DECLARE
  obj record;
  n int := 0;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE NOTICE 'least-privilege: anon/authenticated roles do not exist (plain PostgreSQL) — nothing to revoke';
  ELSE
    FOR obj IN
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
      WHERE nsp.nspname = 'public' AND c.relkind IN ('r','p','v','m')
      ORDER BY c.relname
    LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', obj.relname);
      n := n + 1;
    END LOOP;
    RAISE NOTICE 'least-privilege: anon/authenticated grants revoked on % public objects', n;
  END IF;
END $$;

-- 2. Sequences (none exist today — statement is a no-op until one does).
DO $$
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE NOTICE 'least-privilege: anon/authenticated roles do not exist — skipping sequence revoke';
  ELSE
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    RAISE NOTICE 'least-privilege: sequence grants revoked from anon/authenticated';
  END IF;
END $$;

-- 3. Default privileges: NEW postgres-created tables/sequences in public
--    must NOT silently become reachable through the Data API. Only the
--    postgres default ACL is touched (supabase_admin's is platform-owned).
DO $$
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE NOTICE 'least-privilege: anon/authenticated roles do not exist — skipping default-privilege hardening';
  ELSE
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    RAISE NOTICE 'least-privilege: default privileges hardened for ROLE postgres in public (service_role retained)';
  END IF;
END $$;

-- 4. Refresh the PostgREST schema cache so the Data API immediately stops
--    advertising public tables for anon/authenticated.
NOTIFY pgrst, 'reload schema';
