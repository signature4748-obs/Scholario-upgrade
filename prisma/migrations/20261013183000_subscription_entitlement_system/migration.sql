/*
 * SUBSCRIPTION & ENTITLEMENT SYSTEM — additive-only migration.
 *
 * Adds the commercial-plan registry (SubscriptionPlan), the online-order
 * lane (SubscriptionOrder), per-student entitlements + payments
 * (StudentEntitlement, StudentSubscriptionPayment), the activation-code
 * engine (ActivationCode, ActivationCodeEvent) and additive columns on
 * SchoolSubscription / PlatformSetting / PlatformPayment.
 *
 * Hand-written addition (Prisma cannot express partial unique indexes):
 *   StudentEntitlement_one_live_per_student — ONE live (PENDING|ACTIVE)
 *   entitlement per student, enforced by the database. This is the
 *   double-activation backstop for concurrent code claims / payments.
 *
 * Notes:
 *   · NO existing table or column is dropped or narrowed (diff-generated
 *     DROP INDEX statements for migration-carried extras — trgm/hand
 *     indexes — are intentionally EXCLUDED).
 *   · Production apply is owner-gated (release track); this migration
 *     queues chronologically after 20261013140000.
 */

-- AlterTable
ALTER TABLE "PlatformPayment" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN     "subscriptionConfig" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SchoolSubscription" ADD COLUMN     "billingModel" TEXT NOT NULL DEFAULT 'SCHOOL_WIDE',
ADD COLUMN     "currencySnapshot" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "interval" TEXT,
ADD COLUMN     "planCode" TEXT,
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "priceSnapshot" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'ANNUAL',
    "priceMonthly" DECIMAL(12,2),
    "priceAnnual" DECIMAL(12,2),
    "pricePerStudent" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "modules" TEXT NOT NULL DEFAULT '{}',
    "limits" TEXT NOT NULL DEFAULT '{}',
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "allowOnline" BOOLEAN NOT NULL DEFAULT true,
    "allowOffline" BOOLEAN NOT NULL DEFAULT true,
    "availableForNew" BOOLEAN NOT NULL DEFAULT true,
    "availableForRenewal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "initiatedByUserId" TEXT,
    "planId" TEXT,
    "planCode" TEXT,
    "interval" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "validityMonths" INTEGER NOT NULL DEFAULT 12,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "statusAfter" TEXT,
    "periodEndAfter" TIMESTAMP(3),
    "validityEndAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentEntitlement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
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

    CONSTRAINT "StudentEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSubscriptionPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
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
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationCode" (
    "id" TEXT NOT NULL,
    "publicRef" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "planId" TEXT,
    "planCode" TEXT,
    "interval" TEXT,
    "validityMonths" INTEGER NOT NULL DEFAULT 12,
    "validityStartOverride" TIMESTAMP(3),
    "validityEndOverride" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "claimWindowDays" INTEGER NOT NULL DEFAULT 30,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "entitlementId" TEXT,
    "paymentRef" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "replacedByCodeId" TEXT,
    "reissuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationCodeEvent" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "studentId" TEXT,
    "ip" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationCodeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_scope_status_idx" ON "SubscriptionPlan"("scope", "status");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_status_sortOrder_idx" ON "SubscriptionPlan"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionOrder_orderNo_key" ON "SubscriptionOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionOrder_providerOrderId_key" ON "SubscriptionOrder"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionOrder_providerPaymentId_key" ON "SubscriptionOrder"("providerPaymentId");

-- CreateIndex
CREATE INDEX "SubscriptionOrder_schoolId_status_createdAt_idx" ON "SubscriptionOrder"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionOrder_studentId_status_idx" ON "SubscriptionOrder"("studentId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionOrder_status_createdAt_idx" ON "SubscriptionOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentEntitlement_paymentId_key" ON "StudentEntitlement"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentEntitlement_activationCodeId_key" ON "StudentEntitlement"("activationCodeId");

-- CreateIndex
CREATE INDEX "StudentEntitlement_schoolId_status_idx" ON "StudentEntitlement"("schoolId", "status");

-- CreateIndex
CREATE INDEX "StudentEntitlement_studentId_validityEnd_idx" ON "StudentEntitlement"("studentId", "validityEnd");

-- CreateIndex
CREATE INDEX "StudentEntitlement_status_validityEnd_idx" ON "StudentEntitlement"("status", "validityEnd");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSubscriptionPayment_receiptNo_key" ON "StudentSubscriptionPayment"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSubscriptionPayment_orderId_key" ON "StudentSubscriptionPayment"("orderId");

-- CreateIndex
CREATE INDEX "StudentSubscriptionPayment_schoolId_paymentDate_idx" ON "StudentSubscriptionPayment"("schoolId", "paymentDate");

-- CreateIndex
CREATE INDEX "StudentSubscriptionPayment_studentId_paymentDate_idx" ON "StudentSubscriptionPayment"("studentId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_publicRef_key" ON "ActivationCode"("publicRef");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_codeHash_key" ON "ActivationCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_replacedByCodeId_key" ON "ActivationCode"("replacedByCodeId");

-- CreateIndex
CREATE INDEX "ActivationCode_schoolId_status_idx" ON "ActivationCode"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ActivationCode_studentId_status_idx" ON "ActivationCode"("studentId", "status");

-- CreateIndex
CREATE INDEX "ActivationCode_status_expiresAt_idx" ON "ActivationCode"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ActivationCodeEvent_codeId_createdAt_idx" ON "ActivationCodeEvent"("codeId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationCodeEvent_type_createdAt_idx" ON "ActivationCodeEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_orderId_key" ON "PlatformPayment"("orderId");

-- AddForeignKey
ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SubscriptionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEntitlement" ADD CONSTRAINT "StudentEntitlement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEntitlement" ADD CONSTRAINT "StudentEntitlement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEntitlement" ADD CONSTRAINT "StudentEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEntitlement" ADD CONSTRAINT "StudentEntitlement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "StudentSubscriptionPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEntitlement" ADD CONSTRAINT "StudentEntitlement_activationCodeId_fkey" FOREIGN KEY ("activationCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEntitlement" ADD CONSTRAINT "StudentEntitlement_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubscriptionPayment" ADD CONSTRAINT "StudentSubscriptionPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubscriptionPayment" ADD CONSTRAINT "StudentSubscriptionPayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubscriptionPayment" ADD CONSTRAINT "StudentSubscriptionPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubscriptionPayment" ADD CONSTRAINT "StudentSubscriptionPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SubscriptionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_replacedByCodeId_fkey" FOREIGN KEY ("replacedByCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_reissuedById_fkey" FOREIGN KEY ("reissuedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCodeEvent" ADD CONSTRAINT "ActivationCodeEvent_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ActivationCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCodeEvent" ADD CONSTRAINT "ActivationCodeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCodeEvent" ADD CONSTRAINT "ActivationCodeEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex (hand-written — partial unique: one LIVE entitlement per student)
-- The claim/settle transactions rely on this as the concurrency backstop:
-- a second live row for the same student is impossible at the DB level.
CREATE UNIQUE INDEX "StudentEntitlement_one_live_per_student"
  ON "StudentEntitlement"("studentId")
  WHERE "status" IN ('PENDING', 'ACTIVE');
