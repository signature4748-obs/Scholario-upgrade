/*
 * PHASE 8C — Close the Phase-8B RLS gap (defense-in-depth repair).
 *
 * The 8A invariant (migration 00000000000002_pg_rls_search) is "RLS ENABLE
 * on every application table, zero policies → deny-by-default". The 8B
 * migration 20261002000000_phase8b_domains_salary_email created four NEW
 * tables WITHOUT enabling RLS:
 *
 *   EmailDelivery, SalaryPayment, SalaryStructure, TenantDomain
 *
 * Why this matters ONLY on Supabase (and any future hosted PG with
 * client-facing roles): Supabase's platform bootstrap grants anon /
 * authenticated table privileges in the public schema by default. With RLS
 * disabled, those grants are EFFECTIVE — the four tables would have been
 * readable (and writable!) through the PostgREST auto-REST surface with
 * only the publishable anon key: salary amounts, email delivery payloads
 * and the tenant→domain map. Local/CI PostgreSQL has no such roles, so the
 * gap was invisible there.
 *
 * Repair (two layers):
 *   1. ENABLE ROW LEVEL SECURITY on the four tables (no policies added —
 *      the application connects as the privileged Prisma role and all
 *      client-facing roles get the same deny-by-default as every other
 *      table).
 *   2. REVOKE the Supabase default grants from anon/authenticated for
 *      these tables. The revokes are wrapped in DO blocks that tolerate
 *      environments where those roles do not exist (local PG / CI), so
 *      the migration stays portable; on Supabase they execute for real.
 *
 * The pg-rls census test (tests/security/pg-rls.test.ts) now also probes
 * these tables by name and asserts the full census.
 */

-- 1. Restore the deny-by-default census.
ALTER TABLE "EmailDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryStructure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantDomain" ENABLE ROW LEVEL SECURITY;

-- 2. Strip Supabase's default client-role grants on these tables
--    (no-op where the roles do not exist; belt-and-suspenders where
--    they do — RLS already denies, this makes the posture explicit and
--    guards against a future accidental policy addition).
DO $$
BEGIN
  REVOKE ALL ON TABLE "EmailDelivery", "SalaryPayment", "SalaryStructure", "TenantDomain"
    FROM anon, authenticated;
EXCEPTION
  WHEN OTHERS THEN NULL; -- roles absent (local PG / CI) — census is the guard
END $$;
