/*
 * PHASE 8C-N — Supabase security-advisor closure (function hygiene).
 *
 * Live advisor findings addressed (nothing silenced blindly):
 *
 *   1. function_search_path_mutable (34 WARN) — the 8A tenant-guard
 *      trigger family (tg_guard_*) and the ExamMark bound-check had
 *      unpinned search_path. For plain trigger functions the risk is
 *      schema-shadowing of their unqualified table references; pinning
 *      `public, pg_catalog` makes the resolution deterministic.
 *
 *   2. anon_/authenticated_security_definer_function_executable (2 WARN)
 *      on public.rls_auto_enable — the 8A event-trigger function carries
 *      the default PUBLIC EXECUTE grant, so client roles could invoke it
 *      directly. Direct invocation is useless-but-noisy (it errors when
 *      not in an event-trigger context); the grant is still removed:
 *      event-trigger execution is driven by the DDL machinery and does
 *      not consult function EXECUTE privileges, so auto-RLS keeps
 *      working (verified: fresh CREATE TABLE still auto-enables RLS
 *      after the revoke).
 *
 *      rls_auto_enable is ALSO codified here (CREATE OR REPLACE +
 *      matching event trigger) so a fresh-DB migration replay converges
 *      to the exact hardened state the production project has carried
 *      out-of-band since 8A — closing the lineage gap for good.
 *
 *      (NOTE: the DO-block create tolerates the event trigger already
 *      existing on Supabase — CREATE EVENT TRIGGER is skipped when the
 *      name is taken; on local/CI PG the function+trigger are simply
 *      created fresh.)
 *
 *   3. extension_in_public (pg_trgm) — investigated, ACCEPTED WITH
 *      RATIONALE (not silenced): the trgm-RLS filter-oracle vector
 *      requires RLS policies to exist; this database is deliberately
 *      deny-all (zero policies), so there is no row set to filter.
 *      pg_trgm lives in public on fresh CI databases too (migration
 *      00000000000002), keeping prod/CI convergent. show_trgm() only
 *      reveals trigrams of strings the CALLER supplies.
 *
 * Portability: local/CI PostgreSQL has no anon/authenticated roles —
 * the revokes are exception-wrapped no-ops there; the census tests
 * (pg-rls) remain the guard.
 */

-- 1) Pin search_path on every public trigger function lacking one.
--    Deterministic loop: covers the 8A guard family + ExamMark bound fn
--    and any trigger function later migrations introduce.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO public, pg_catalog', r.sig);
  END LOOP;
END $$;

-- 2) Codify the out-of-band 8A event trigger into the migration lineage.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls
      ON ddl_command_end
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL; -- environments without event-trigger support
END $$;

-- 3) Remove the client-role EXECUTE surface on the event-trigger fn.
--    Direct invocation by anon/authenticated becomes impossible; the DDL
--    machinery (which fires event triggers) does not consult EXECUTE.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
EXCEPTION
  WHEN OTHERS THEN NULL; -- roles absent on local/CI PG
END $$;
