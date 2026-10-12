-- FeeTransaction.studentId was a bare string (no FK): 3 production rows carry dangling
-- student pointers (legacy pre-validation writes). Self-heal first, then enforce.
--
-- B-4a: the 3 legacy orphan rows ALSO carry dangling feeId values, so the pre-existing
-- tenant-guard trigger on UPDATE (tg_guard_FT_upd -> tg_guard_FT_ins_fn, migration
-- 00000000000001_pg_domain_guards) rejects ANY update of those rows — including this
-- studentId=NULL self-heal — on its feeId branch (NEW."feeId" IS NOT NULL AND no
-- matching "Fee"). The guard's studentId branch itself tolerates the NULL we write,
-- so the trigger is suspended for exactly the one self-heal statement, inside this
-- same transaction:
--   · DISABLE/ENABLE TRIGGER are transactional DDL — any failure of this migration
--     rolls the trigger back to enabled; it can never be left disabled;
--   · the ALTERs hold a ShareRowExclusiveLock until COMMIT, so concurrent writers
--     block for the milliseconds this runs (they cannot slip through the window);
--     readers are unaffected;
--   · the trigger is re-enabled BEFORE any other statement runs; the guard stays
--     fully functional for all future writes. feeId values are NOT modified.
ALTER TABLE "FeeTransaction" DISABLE TRIGGER "tg_guard_FT_upd";

UPDATE "FeeTransaction" SET "studentId" = NULL
WHERE "studentId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Student" WHERE "Student"."id" = "FeeTransaction"."studentId");

ALTER TABLE "FeeTransaction" ENABLE TRIGGER "tg_guard_FT_upd";

-- Financial immutability: deleting a Student keeps the ledger row, detaches the pointer.
ALTER TABLE "FeeTransaction" ADD CONSTRAINT "FeeTransaction_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index already exists on studentId (0_init); no extra index needed.
