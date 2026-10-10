-- =====================================================================
-- 20261010040148_fee_admissions_mvp
-- FEE-ADMISSIONS MVP (H1-R2 contract). Expand/contract transition:
--
--   EXPAND  : additive columns (FeeHead.kind, FeeStructure(+Version)
--             .academicYear, User.credentialExpiresAt), new admission
--             tables (AdmissionApplication / Event / FeeSnapshot /
--             Sequence, FeeDiscountRule), CHECK constraints and the
--             partial unique indexes
--               FeeStructure_current_key   (schoolId,classId) WHERE status='current'
--               FeeStructure_scheduled_key (schoolId,classId) WHERE status='scheduled'
--
--   CONTRACT: drop the legacy compound unique
--             FeeStructure_schoolId_classId_status_key — AFTER the
--             partial uniques exist and are validated (same
--             transaction). Rollback limitation (one-way door): the old
--             constraint can only be re-added while every school holds
--             at most ONE row per (school, class, status); once any
--             school holds >1 archived/draft row per class, rollback is
--             app-revert + flag-off, never schema-revert.
--
-- Pre-validation (fail-loud, BEFORE any mutation): legacy FeeHead rows
-- with NULL mandatory or NULL/out-of-bounds amounts abort the whole
-- migration. The legacy backfill truth table (single source, mirrored
-- by zod validation and the DB CHECKs below):
--     mandatory = true  → kind = 'FIXED'
--     mandatory = false → kind = 'OPTIONAL'
--     QUANTITY is NEVER assigned by the backfill (explicit config only).
--     amount is preserved verbatim.
--
-- NOTE: prisma migrate dev generated spurious DROP INDEX statements for
-- hand-written indexes from earlier migrations (trgm search, hot-path
-- schoolId indexes) that the Prisma schema intentionally does not
-- model. Those drops were REMOVED — this migration never touches them.
-- =====================================================================

-- 0. PRE-VALIDATION (read-only; aborts before any DDL/DML) --------------
DO $$
DECLARE
  bad_mandatory INT;
  bad_amount INT;
BEGIN
  SELECT count(*) INTO bad_mandatory FROM "FeeHead" WHERE "mandatory" IS NULL;
  IF bad_mandatory > 0 THEN
    RAISE EXCEPTION 'FEEHEAD_BACKFILL_INVALID: % FeeHead rows have NULL mandatory', bad_mandatory;
  END IF;
  SELECT count(*) INTO bad_amount FROM "FeeHead" WHERE "amount" IS NULL OR "amount" < 0 OR "amount" > 500000;
  IF bad_amount > 0 THEN
    RAISE EXCEPTION 'FEEHEAD_BACKFILL_INVALID: % FeeHead rows have NULL/out-of-bounds amount (allowed 0..500000)', bad_amount;
  END IF;
END
$$;

-- 1. EXPAND — additive columns ------------------------------------------
ALTER TABLE "FeeHead" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FIXED';

ALTER TABLE "FeeStructure" ADD COLUMN "academicYear" TEXT;

ALTER TABLE "FeeStructureVersion" ADD COLUMN "academicYear" TEXT;

ALTER TABLE "User" ADD COLUMN "credentialExpiresAt" TIMESTAMP(3);

-- 2. Legacy FeeHead backfill (deterministic; amount untouched) -----------
UPDATE "FeeHead" SET "kind" = CASE WHEN "mandatory" THEN 'FIXED' ELSE 'OPTIONAL' END;

-- 3. CHECK constraints — the same truth table, DB layer ------------------
ALTER TABLE "FeeHead" ADD CONSTRAINT "FeeHead_kind_values" CHECK ("kind" IN ('FIXED', 'OPTIONAL', 'QUANTITY'));
ALTER TABLE "FeeHead" ADD CONSTRAINT "FeeHead_kind_mandatory_invariant" CHECK (
  ("kind" = 'FIXED' AND "mandatory" = true)
  OR ("kind" = 'OPTIONAL' AND "mandatory" = false)
  OR "kind" = 'QUANTITY'
);
ALTER TABLE "FeeHead" ADD CONSTRAINT "FeeHead_amount_bounds" CHECK ("amount" >= 0 AND "amount" <= 500000);

-- 4. Legacy academic-year normalization — ONLY from the school's own
--    configured year, ONLY in canonical YYYY-YYYY form (no invention;
--    unparseable/missing school years leave the structure NULL, which
--    the quote engine treats as fail-closed). Historical snapshots are
--    never rewritten after this one-time backfill.
UPDATE "FeeStructure" fs
SET "academicYear" = s."academicYear"
FROM "School" s
WHERE fs."schoolId" = s."id" AND s."academicYear" ~ '^\d{4}-\d{4}$';

UPDATE "FeeStructureVersion" fv
SET "academicYear" = fs."academicYear"
FROM "FeeStructure" fs
WHERE fv."structureId" = fs."id" AND fs."academicYear" IS NOT NULL;

-- 5. New tables ----------------------------------------------------------
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "academicYear" TEXT NOT NULL,
    "classId" TEXT,
    "className" TEXT NOT NULL,
    "section" TEXT,
    "applicantFirstName" TEXT NOT NULL,
    "applicantLastName" TEXT NOT NULL,
    "applicantDob" TEXT,
    "applicantGender" TEXT,
    "applicantEmail" TEXT,
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "guardianEmail" TEXT,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "decisionBy" TEXT,
    "decisionNotes" TEXT,
    "rejectionReason" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "enrolledStudentId" TEXT,
    "enrolResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdmissionApplicationEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdmissionFeeSnapshot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "studentId" TEXT,
    "structureId" TEXT,
    "structureVersion" INTEGER,
    "academicYear" TEXT NOT NULL,
    "lineItems" TEXT NOT NULL,
    "discountName" TEXT,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedBy" TEXT,

    CONSTRAINT "AdmissionFeeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdmissionSequence" (
    "schoolId" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL DEFAULT 'ADM-NNNNNN',
    "maxValue" INTEGER NOT NULL DEFAULT 999999,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionSequence_pkey" PRIMARY KEY ("schoolId")
);

CREATE TABLE "FeeDiscountRule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeDiscountRule_pkey" PRIMARY KEY ("id")
);

-- 6. Domain CHECK constraints on the new tables ---------------------------
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_status_values"
  CHECK ("status" IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ENROLLED', 'REJECTED'));
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_academic_year_format"
  CHECK ("academicYear" ~ '^\d{4}-\d{4}$');
ALTER TABLE "AdmissionApplicationEvent" ADD CONSTRAINT "AdmissionApplicationEvent_action_values"
  CHECK ("action" IN ('SUBMITTED', 'START_REVIEW', 'REQUEST_CORRECTION', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'ENROLLED', 'IDEMPOTENT_REPLAY'));
ALTER TABLE "AdmissionFeeSnapshot" ADD CONSTRAINT "AdmissionFeeSnapshot_amount_bounds"
  CHECK ("totalAmount" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "totalAmount");
ALTER TABLE "AdmissionFeeSnapshot" ADD CONSTRAINT "AdmissionFeeSnapshot_academic_year_format"
  CHECK ("academicYear" ~ '^\d{4}-\d{4}$');
-- Sequence range enforced DB-side: strict maximum 999999, no overflow.
ALTER TABLE "AdmissionSequence" ADD CONSTRAINT "AdmissionSequence_range"
  CHECK ("currentValue" >= 0 AND "currentValue" <= "maxValue" AND "maxValue" <= 999999 AND "maxValue" > 0);
ALTER TABLE "AdmissionSequence" ADD CONSTRAINT "AdmissionSequence_format"
  CHECK ("format" = 'ADM-NNNNNN');
ALTER TABLE "FeeDiscountRule" ADD CONSTRAINT "FeeDiscountRule_type_values"
  CHECK ("type" IN ('PERCENT', 'FLAT'));
ALTER TABLE "FeeDiscountRule" ADD CONSTRAINT "FeeDiscountRule_value_bounds"
  CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 100));

-- 7. Indexes ---------------------------------------------------------------
CREATE INDEX "AdmissionApplication_schoolId_status_createdAt_idx" ON "AdmissionApplication"("schoolId", "status", "createdAt");

CREATE INDEX "AdmissionApplication_schoolId_classId_status_idx" ON "AdmissionApplication"("schoolId", "classId", "status");

CREATE UNIQUE INDEX "AdmissionApplication_schoolId_clientRequestId_key" ON "AdmissionApplication"("schoolId", "clientRequestId");

CREATE INDEX "AdmissionApplicationEvent_schoolId_applicationId_createdAt_idx" ON "AdmissionApplicationEvent"("schoolId", "applicationId", "createdAt");

CREATE UNIQUE INDEX "AdmissionFeeSnapshot_applicationId_key" ON "AdmissionFeeSnapshot"("applicationId");

CREATE INDEX "AdmissionFeeSnapshot_schoolId_studentId_idx" ON "AdmissionFeeSnapshot"("schoolId", "studentId");

CREATE INDEX "FeeDiscountRule_schoolId_headId_idx" ON "FeeDiscountRule"("schoolId", "headId");

CREATE UNIQUE INDEX "FeeDiscountRule_schoolId_code_key" ON "FeeDiscountRule"("schoolId", "code");

CREATE INDEX "FeeStructure_schoolId_classId_status_idx" ON "FeeStructure"("schoolId", "classId", "status");

-- 8. Partial unique indexes (validated at creation: any existing
--    duplicate current/scheduled pair per (school, class) ABORTS the
--    migration here — BEFORE the legacy constraint is dropped) ----------
CREATE UNIQUE INDEX "FeeStructure_current_key" ON "FeeStructure"("schoolId", "classId") WHERE "status" = 'current';

CREATE UNIQUE INDEX "FeeStructure_scheduled_key" ON "FeeStructure"("schoolId", "classId") WHERE "status" = 'scheduled';

-- 9. Foreign keys -----------------------------------------------------------
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdmissionApplicationEvent" ADD CONSTRAINT "AdmissionApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdmissionFeeSnapshot" ADD CONSTRAINT "AdmissionFeeSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdmissionSequence" ADD CONSTRAINT "AdmissionSequence_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeeDiscountRule" ADD CONSTRAINT "FeeDiscountRule_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. CONTRACT — drop the legacy compound unique (AFTER the partial
--     uniques exist and were validated, same transaction). The old
--     constraint is STRICTLY STRONGER than the new partial uniques for
--     every state they admit (current/scheduled), so dropping it can
--     never violate them; drafts/archived become unconstrained by
--     design (a class may hold many archived versions).
DROP INDEX "FeeStructure_schoolId_classId_status_key";
