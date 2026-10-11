-- Corrective migration (CI drift gate finding, 2026-10-11):
-- migration 20261011140000 (Supabase Auth identity linking) created
-- "authLinkedAt" as bare TIMESTAMP (PostgreSQL default precision 6),
-- while prisma/schema.prisma models DateTime? → TIMESTAMP(3) (the
-- contract every other DateTime column in the schema follows).
-- Non-destructive precision alignment: nullable audit columns
-- (User.authLinkedAt, PlatformAdmin.authLinkedAt) with at most a few
-- rows; microsecond → millisecond rounding only.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "authLinkedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PlatformAdmin" ALTER COLUMN "authLinkedAt" SET DATA TYPE TIMESTAMP(3);
