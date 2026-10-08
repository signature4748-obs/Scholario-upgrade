-- PHASE 8 §7(G) — evidence-based FK hot-path indexes (hand-trimmed on purpose).
--
-- WHY THIS FILE IS RAW-SQL-TRIMMED: `prisma migrate dev` generated this
-- migration WITH ~35 `DROP INDEX` statements for the sanctioned raw-SQL
-- index families (24 *_trgm GIN search indexes from 00000000000002 +
-- 11 <T>_schoolId_idx tenant-scan indexes from 20261004154000) because
-- those indexes are INTENTIONALLY absent from the Prisma datamodel (the
-- documented drift-gate convention — .github/ci.yml.parked step 8 allows
-- exactly those two families in the DB↔datamodel diff). Committing the
-- generated file verbatim would DROP all of them in production at the
-- next deploy. The DROP statements were removed by hand; the two CREATE
-- INDEX statements below are byte-identical to the generated ones, and
-- the matching @@index declarations live in schema.prisma
-- (FeeTransaction @@index([settlementId, createdAt]) and ExamScheduleItem
-- @@index([examId, classId, subjectId])) — so the migrated DB and the
-- datamodel AGREE on these two indexes (zero drift for them).
--
-- EVIDENCE (production pg catalogs, 2026-10-08, 8.8-day stats window):
--   · FeeTransaction.settlementId — fees/settlements drill-down loads
--     transactions WHERE settlementId ORDER BY createdAt DESC (413 seq
--     scans observed; the ledger grows with every payment).
--   · ExamScheduleItem (examId, classId, subjectId) — the per-mark
--     attendance-sync findFirst loop + schedule conflict checks + the
--     Exam→Cascade delete path; the table had zero non-PK indexes
--     (219 rows, 420 seq scans observed).

-- CreateIndex
CREATE INDEX "ExamScheduleItem_examId_classId_subjectId_idx" ON "ExamScheduleItem"("examId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "FeeTransaction_settlementId_createdAt_idx" ON "FeeTransaction"("settlementId", "createdAt");
