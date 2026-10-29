-- STAFF ENTITLEMENTS + BATCH CODES (2026-10-30) — ADDITIVE ONLY.
--
-- Extends the subscription & entitlement system with:
--   · StaffEntitlement            — per-seat entitlement for TEACHER
--                                   accounts under PER_SEAT staff
--                                   coverage (the StudentEntitlement
--                                   analogue; ONE live row per user,
--                                   hand-written partial unique index
--                                   below — the DB-level double-activation
--                                   guard).
--   · StaffSubscriptionPayment    — the immutable per-seat ledger row
--                                   (mirrors StudentSubscriptionPayment;
--                                   A-domain money: the school pays
--                                   SCHOLARIO for staff seats).
--   · SchoolSubscription.staffCoverage — TENANT (default: every existing
--                                   tenant keeps today's behavior — the
--                                   tenant subscription covers teachers/
--                                   staff exactly as before) | PER_SEAT.
--                                   Zero behavior change until the
--                                   platform control plane opts a tenant
--                                   into PER_SEAT.
--   · ActivationCode.assignedUserId    — pre-assigned claimant for staff
--                                   codes (the studentId analogue).
--   · ActivationCode.staffEntitlementId — the resulting staff entitlement
--                                   link (entitlementId analogue).
--   · staff_payment_receipt_seq   — atomic receipt sequence for the staff
--                                   ledger (SCH-SSP-<year>-<seq>).
--
-- No existing column is dropped, retyped or rewritten; no data statements.
-- Every existing tenant's effective behavior is UNCHANGED by this
-- migration alone (staffCoverage defaults to TENANT everywhere).

-- CreateTable
CREATE TABLE "StaffEntitlement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "planCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "validityStart" TIMESTAMP(3) NOT NULL,
    "validityEnd" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "paymentId" TEXT,
    "activationCodeId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSubscriptionPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entitlementId" TEXT,
    "planId" TEXT,
    "planCode" TEXT,
    "interval" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "mode" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "validityMonths" INTEGER NOT NULL DEFAULT 12,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'VERIFIED',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusAfter" TEXT,
    "validityEndAfter" TIMESTAMP(3),
    "receiptNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffEntitlement_paymentId_key" ON "StaffEntitlement"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffEntitlement_activationCodeId_key" ON "StaffEntitlement"("activationCodeId");

-- CreateIndex
CREATE INDEX "StaffEntitlement_schoolId_status_idx" ON "StaffEntitlement"("schoolId", "status");

-- CreateIndex
CREATE INDEX "StaffEntitlement_userId_validityEnd_idx" ON "StaffEntitlement"("userId", "validityEnd");

-- CreateIndex
CREATE INDEX "StaffEntitlement_status_validityEnd_idx" ON "StaffEntitlement"("status", "validityEnd");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSubscriptionPayment_receiptNo_key" ON "StaffSubscriptionPayment"("receiptNo");

-- CreateIndex
CREATE INDEX "StaffSubscriptionPayment_schoolId_paymentDate_idx" ON "StaffSubscriptionPayment"("schoolId", "paymentDate");

-- CreateIndex
CREATE INDEX "StaffSubscriptionPayment_userId_paymentDate_idx" ON "StaffSubscriptionPayment"("userId", "paymentDate");

-- AlterTable (additive columns)
ALTER TABLE "ActivationCode" ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "staffEntitlementId" TEXT;

ALTER TABLE "SchoolSubscription" ADD COLUMN     "staffCoverage" TEXT NOT NULL DEFAULT 'TENANT';

-- AddForeignKey
ALTER TABLE "StaffEntitlement" ADD CONSTRAINT "StaffEntitlement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffEntitlement" ADD CONSTRAINT "StaffEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffEntitlement" ADD CONSTRAINT "StaffEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffEntitlement" ADD CONSTRAINT "StaffEntitlement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "StaffSubscriptionPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffEntitlement" ADD CONSTRAINT "StaffEntitlement_activationCodeId_fkey" FOREIGN KEY ("activationCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffEntitlement" ADD CONSTRAINT "StaffEntitlement_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSubscriptionPayment" ADD CONSTRAINT "StaffSubscriptionPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSubscriptionPayment" ADD CONSTRAINT "StaffSubscriptionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSubscriptionPayment" ADD CONSTRAINT "StaffSubscriptionPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: ActivationCode.staffEntitlementId is a PLAIN column (no FK
-- constraint) — exactly the student-side pattern (entitlementId):
-- the relation is modeled over StaffEntitlement.activationCodeId, and
-- the claim transaction writes the link by id.


-- CreateIndex (hand-written — partial unique: one LIVE staff entitlement
-- per user). The claim/settle transactions rely on this as the
-- concurrency backstop: a second live row for the same staff member is
-- impossible at the DB level (same discipline as
-- StudentEntitlement_one_live_per_student).
CREATE UNIQUE INDEX "StaffEntitlement_one_live_per_user"
  ON "StaffEntitlement"("userId")
  WHERE "status" IN ('PENDING', 'ACTIVE');

-- Reference sequence (atomic, race-free inside the staff settlement
-- transactions — same pattern as student_payment_receipt_seq).
CREATE SEQUENCE IF NOT EXISTS "staff_payment_receipt_seq" START 1;
