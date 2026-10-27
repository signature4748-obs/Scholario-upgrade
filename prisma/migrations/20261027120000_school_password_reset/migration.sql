-- SCHOOL-PLANE ACCOUNT RECOVERY — forgot-password tokens for school users
-- (Student & Staff), mirroring the platform plane's PlatformPasswordReset
-- contract (docs/PLATFORM_ACCOUNT_RECOVERY.md §1 → docs/SCHOOL_ACCOUNT_RECOVERY.md).
--
-- Additive ONLY: one new table + its indexes. No data changes; the existing
-- school authentication path is untouched.

CREATE TABLE "SchoolPasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "SchoolPasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolPasswordReset_tokenHash_key" ON "SchoolPasswordReset"("tokenHash");
CREATE INDEX "SchoolPasswordReset_userId_idx" ON "SchoolPasswordReset"("userId");
CREATE INDEX "SchoolPasswordReset_expiresAt_idx" ON "SchoolPasswordReset"("expiresAt");
ALTER TABLE "SchoolPasswordReset" ADD CONSTRAINT "SchoolPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
