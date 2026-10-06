-- LEAST-PRIVILEGE GRANTS — PREPARED, NOT EXECUTED (audit 2026-10-06)
--
-- Status: DRAFT. Nothing in this file has been applied to production.
-- It lives in docs/ (NOT prisma/migrations/) on purpose: dropping it into
-- prisma/migrations/ makes the next `prisma migrate deploy` run it.
--
-- Why it is safe to apply (dependency audit, 2026-10-06):
--   · No @supabase/supabase-js anywhere in the repo; no PostgREST data
--     access from application code (verified by grep + live probes).
--   · All business DB access is server-side Prisma over DATABASE_URL
--     (role: postgres / pooler tenant). Unaffected by anon grants.
--   · The anon key reaches browsers ONLY as the Realtime websocket key
--     (broadcast channels; Realtime never reads public tables for it).
--   · Storage: server-side service-role wrapper (+ signed URLs);
--     public-bucket serving goes through the storage service's internal
--     admin path, not the anon role.
--   · tests/security/pg-rls.test.ts accepts `[]` OR 401/403 for the anon
--     REST surface ("equally closed") — it keeps passing after revocation.
--   · service_role keeps every grant (storage wrapper + realtime REST
--     publish + PostgREST probes in the test suite use it).
--
-- What it does:
--   1. Revoke ALL table + sequence privileges on schema `public` from
--      `anon` and `authenticated` (111 business tables + _prisma_migrations).
--      RLS (enabled everywhere, zero policies) already denies every row;
--      this removes the table-level grants that would become live data
--      access if RLS were ever accidentally disabled on any table.
--   2. Fixes DEFAULT PRIVILEGES so future tables in `public` no longer
--      auto-grant anon/authenticated (Supabase's default ACL).
--
-- What it deliberately does NOT touch:
--   · storage / auth / realtime / extensions schema grants (platform
--     managed; their RLS posture is deny-by-default already).
--   · EXECUTE on public functions (trigger guards + pg_trgm support
--     functions; PUBLIC default, no direct call surface — optional
--      phase 2, see notes at the bottom).
--   · Anything the service_role holds.
--
-- Promotion procedure (owner decision required):
--   1. Review this file.
--   2. mkdir prisma/migrations/<timestamp>_least_privilege_grants
--   3. Copy this SQL into migration.sql (keep the header comment trimmed).
--   4. Local/staging run first (docs/RELEASE.md pipeline).
--   5. Production: existing prod-migration workflow (scripts/prod-release).
--   6. Verify: anon REST probe → 401/403 (tests/security/pg-rls.test.ts
--      stays green); app health `database:ok` on both planes.
--   7. Rollback: re-grant (Supabase baseline) —
--        GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
--        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--          GRANT ALL ON TABLES TO anon, authenticated;
--        ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--          GRANT ALL ON TABLES TO anon, authenticated;
--
-- Idempotent: safe to re-run.

-- 1. Current tables + sequences
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 2. Future tables/sequences (Supabase creates these defaults per role)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ── Optional phase 2 (NOT part of this migration) ──────────────────────
-- Function EXECUTE is granted to PUBLIC by PostgreSQL default. The public
-- schema holds only pg_trgm support functions and trigger guards, none of
-- which offer a meaningful direct-call surface. If defense-in-depth is
-- wanted later:
--   REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- (Keep owner + service_role EXECUTE intact. Nothing in the app calls
--  public-schema functions directly.)
