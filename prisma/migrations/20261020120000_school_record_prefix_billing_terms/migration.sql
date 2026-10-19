-- ============================================================================
-- ADD-SCHOOL WIZARD — school record prefix + onboarding billing terms
-- ----------------------------------------------------------------------------
-- Additive, backward-compatible. No table is reset, truncated or reseeded;
-- every existing row keeps its behavior. Two changes:
--
--   1. School.recordPrefix (nullable + UNIQUE) — the stable internal school
--      record prefix (e.g. GVPS-0001). Allocated server-side at provisioning
--      under a Postgres advisory lock (see src/lib/platform/school-prefix.ts);
--      the UNIQUE index is the database-enforced backstop. Backfilled below
--      DETERMINISTICALLY (oldest school first, per-abbrev sequence) so
--      existing tenants get a prefix without any code change. Nullable keeps
--      every legacy reader working; the column is written on every provision
--      after this migration.
--
--   2. SchoolSubscription.licensedStudents (nullable, positive) — the licensed
--      student quantity agreed for PER_STUDENT billing at onboarding. Null
--      for SCHOOL_WIDE/MIXED tenants (existing behavior unchanged).
--
-- The prefix abbreviation rule mirrors src/lib/school/identity-derive.ts
-- EXACTLY (same words, same initials, same fallbacks) so allocation and
-- backfill agree on the per-abbrev sequence space:
--   · uppercase initials of the first 5 alphanumeric words of the name
--     ("Green Valley Public School" → GVPS)
--   · if that is shorter than 2 chars, the first 4 letters of the first
--     word ("Hawkings" → HAWK); if the name has no alphanumeric word at
--     all, "SCH"
--   · padded with 'X' ONLY when still shorter than 2 chars (rpad would
--     truncate, so it is guarded)
--   · number = (max existing number for that abbrev) + 1, zero-padded 4
-- ============================================================================

-- 1 ─ School.recordPrefix ────────────────────────────────────────────────────
ALTER TABLE "School" ADD COLUMN "recordPrefix" TEXT;
CREATE UNIQUE INDEX "School_recordPrefix_key" ON "School"("recordPrefix");

-- 2 ─ SchoolSubscription.licensedStudents ────────────────────────────────────
ALTER TABLE "SchoolSubscription" ADD COLUMN "licensedStudents" INTEGER;
ALTER TABLE "SchoolSubscription"
  ADD CONSTRAINT "SchoolSubscription_licensedStudents_positive"
  CHECK ("licensedStudents" IS NULL OR "licensedStudents" > 0);

-- 3 ─ Deterministic, collision-safe backfill of School.recordPrefix ────────
--    Processed oldest-first (createdAt, id) inside one DO block; each school
--    takes the NEXT free number in ITS abbreviation's sequence, so a
--    re-run is idempotent (WHERE recordPrefix IS NULL guard) and concurrent
--    school-name collisions can never share a prefix (MAX+1 per abbrev).
DO $$
DECLARE
  r RECORD;
  abbr TEXT;
  initials TEXT;
  first_word TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT id, name FROM "School"
    WHERE "recordPrefix" IS NULL
    ORDER BY "createdAt" ASC, "id" ASC
  LOOP
    -- initials of every alphanumeric word of the uppercased name, in order
    initials := (
      SELECT string_agg(LEFT(w, 1), '' ORDER BY ord)
      FROM (
        SELECT w, ROW_NUMBER() OVER () AS ord
        FROM regexp_split_to_table(upper(r.name), '[^A-Z0-9]+') AS w
        WHERE w <> ''
      ) t
    );
    abbr := LEFT(COALESCE(initials, ''), 5);
    IF length(abbr) < 2 THEN
      first_word := (
        SELECT w FROM regexp_split_to_table(upper(r.name), '[^A-Z0-9]+') AS w
        WHERE w <> ''
        LIMIT 1
      );
      abbr := LEFT(COALESCE(first_word, 'SCH'), 4);
    END IF;
    -- rpad TRUNCATES when the string is already longer, so the pad is
    -- guarded: only short abbreviations get 'X' fill (min 2 chars).
    IF length(abbr) < 2 THEN
      abbr := rpad(abbr, 2, 'X');
    END IF;

    SELECT COALESCE(MAX(CAST(SUBSTRING("recordPrefix" FROM '[0-9]+$') AS INTEGER)), 0)
      INTO n
      FROM "School"
      WHERE "recordPrefix" ~ ('^' || abbr || '-[0-9]+$');

    UPDATE "School"
      SET "recordPrefix" = abbr || '-' || lpad(CAST(n + 1 AS TEXT), 4, '0')
      WHERE id = r.id;
  END LOOP;
END $$;
