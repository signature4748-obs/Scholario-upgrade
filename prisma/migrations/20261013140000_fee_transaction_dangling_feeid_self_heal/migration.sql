-- FeeTransaction.feeId is a bare string with NO FK (schema comment: "the legacy
-- Fee row this collection applies to"): 3 production rows carry dangling fee
-- pointers — the referenced Fee rows were cascade-deleted with their Student
-- (Fee.studentId is onDelete: Cascade), while the ledger rows survived because
-- the soft feeId column had no referential enforcement. The affected financial
-- rows are SUCCESS ledger entries with immutable amounts and receipt numbers
-- (SCH-2026-000216…218): they are preserved byte-for-byte; only the dead
-- pointer is detached. feeId is NULLABLE by design — the online-payment
-- order-creation routes persist feeId: null by design and the ledger
-- application path (applyPaymentToLedger) explicitly no-ops on a NULL feeId,
-- so NULL is the sanctioned state for "no live Fee row to apply to".
--
-- This mirrors the 20261013120000 studentId hardening: self-heal first, then
-- enforce. The same tenant-guard interplay applies — the pre-existing guard
-- trigger on UPDATE (tg_guard_FT_upd -> tg_guard_FT_ins_fn, migration
-- 00000000000001_pg_domain_guards) rejects ANY update of a row whose feeId is
-- dangling (its feeId branch: NEW."feeId" IS NOT NULL AND no same-school Fee),
-- which includes this very self-heal. The guard's NULL branches tolerate the
-- NULL we write, so the trigger is suspended for exactly the one self-heal
-- statement, inside this same transaction:
--   · DISABLE/ENABLE TRIGGER are transactional DDL — any failure of this
--     migration rolls the trigger back to enabled; it can never be left
--     disabled;
--   · the ALTERs hold a ShareRowExclusiveLock until COMMIT, so concurrent
--     writers block for the milliseconds this runs; readers are unaffected;
--   · the trigger is re-enabled BEFORE any other statement runs; the guard
--     stays fully functional for all future writes. studentId values are NOT
--     modified (20261013120000 already healed them and its FK is live).
-- The heal predicate is SCHOOL-SCOPED and matches the guard's feeId branch
-- exactly: a feeId pointing at ANOTHER school's Fee is healed to NULL too, so
-- after this migration every FeeTransaction.feeId is either NULL or points at
-- a same-school Fee — no cross-tenant pointer can survive.
ALTER TABLE "FeeTransaction" DISABLE TRIGGER "tg_guard_FT_upd";

UPDATE "FeeTransaction" SET "feeId" = NULL
WHERE "feeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Fee" WHERE "Fee"."id" = "FeeTransaction"."feeId" AND "Fee"."schoolId" = "FeeTransaction"."schoolId");

ALTER TABLE "FeeTransaction" ENABLE TRIGGER "tg_guard_FT_upd";

-- Financial immutability: deleting a Fee (directly, or via the Fee.studentId
-- cascade when a Student goes) keeps the ledger row and detaches the pointer —
-- the same contract the studentId FK established. The FK also closes the
-- recurrence path: no future Fee deletion can strand a dangling feeId again.
-- NOTE (guard/RI interplay, verified on PG 18.4): hard-deleting a Student
-- whose transactions still hold LIVE feeId pointers is refused by the guard
-- (the Fee cascade removes the Fee, then the studentId SET NULL RI update
-- fires tg_guard_FT_upd, whose feeId branch sees the just-deleted Fee →
-- P0001). That is PRE-EXISTING behaviour — identical without this FK (it
-- comes from the guard + 20261013120000) — and it is fail-closed BY DESIGN:
-- the application has no hard-delete flow for Students, and direct-DB
-- deletion with live fee references is refused instead of silently orphaning
-- pointers, which is the exact incident that created the 3 rows this
-- migration heals. Students whose transactions carry NULL (detached) feeId
-- pointers delete cleanly.
-- Index FeeTransaction_feeId_idx already exists (fee_admissions_mvp era); no
-- extra index is needed for the reverse lookup.
ALTER TABLE "FeeTransaction" ADD CONSTRAINT "FeeTransaction_feeId_fkey"
  FOREIGN KEY ("feeId") REFERENCES "Fee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
