-- ACCOUNT-RECOVERY — Platform Admin password reset + Google identity linking
-- + dual-control root-recovery tickets.
--
-- Additive ONLY: new nullable columns, two new tables. No data changes; the
-- existing password authentication path is untouched.

-- 1. Google identity linking (explicit link only; login resolves by sub).
ALTER TABLE "PlatformAdmin" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN "googleEmail" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN "googleLinkedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PlatformAdmin_googleSub_key" ON "PlatformAdmin"("googleSub");

-- 2. Forgot-password tokens (hashed, single-use, 30-minute expiry).
CREATE TABLE "PlatformPasswordReset" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "PlatformPasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformPasswordReset_tokenHash_key" ON "PlatformPasswordReset"("tokenHash");
CREATE INDEX "PlatformPasswordReset_adminId_idx" ON "PlatformPasswordReset"("adminId");
CREATE INDEX "PlatformPasswordReset_expiresAt_idx" ON "PlatformPasswordReset"("expiresAt");
ALTER TABLE "PlatformPasswordReset" ADD CONSTRAINT "PlatformPasswordReset_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Dual-control recovery tickets (no FKs — security trail convention).
CREATE TABLE "PlatformRecoveryTicket" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetAdminId" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformRecoveryTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformRecoveryTicket_targetAdminId_idx" ON "PlatformRecoveryTicket"("targetAdminId");
CREATE INDEX "PlatformRecoveryTicket_expiresAt_idx" ON "PlatformRecoveryTicket"("expiresAt");
