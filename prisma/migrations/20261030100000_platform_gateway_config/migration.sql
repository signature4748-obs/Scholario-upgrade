-- PlatformGatewayConfig — ADDITIVE migration (Payments & Gateways redesign).
--
-- Creates the PLATFORM-LEVEL payment gateway configuration (the deployment's
-- OWN provider account for Scholario subscription payments; the fee lane's
-- fallback rail) and adds a read-only verification timestamp to the existing
-- per-school fee gateway rows.
--
-- No existing column is dropped, retyped or rewritten; no data statements.
-- Every existing tenant's effective behavior is UNCHANGED by this migration
-- alone (the platform lane keeps resolving env-first until an operator
-- configures the platform gateway; school rows simply carry lastVerifiedAt
-- = NULL, which renders as "not verified yet" in the UI).

-- CreateTable
CREATE TABLE "PlatformGatewayConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "publicKeyId" TEXT,
    "secretKeyCipher" TEXT,
    "secretKeyNonce" TEXT,
    "webhookSecretCipher" TEXT,
    "webhookSecretNonce" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "configuredById" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformGatewayConfig_status_idx" ON "PlatformGatewayConfig"("status");

-- AddForeignKey
ALTER TABLE "PlatformGatewayConfig" ADD CONSTRAINT "PlatformGatewayConfig_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable — verification timestamp for school fee gateway rows
ALTER TABLE "SchoolPaymentGateway" ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);
