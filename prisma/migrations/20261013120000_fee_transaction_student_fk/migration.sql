-- FeeTransaction.studentId was a bare string (no FK): 3 production rows carry dangling
-- student pointers (legacy pre-validation writes). Self-heal first, then enforce.
UPDATE "FeeTransaction" SET "studentId" = NULL
WHERE "studentId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Student" WHERE "Student"."id" = "FeeTransaction"."studentId");

-- Financial immutability: deleting a Student keeps the ledger row, detaches the pointer.
ALTER TABLE "FeeTransaction" ADD CONSTRAINT "FeeTransaction_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index already exists on studentId (0_init); no extra index needed.
