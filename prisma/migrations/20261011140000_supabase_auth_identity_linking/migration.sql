-- SUPABASE AUTH PHASE 1 — identity linking columns (additive, reversible).
--
-- Implements the documented staged-adoption path from
-- docs/AUTH_ARCHITECTURE.md §7:
--   · deterministic mapping via a nullable, UNIQUE provider-id pointer;
--   · the Postgres row stays the application identity of record forever;
--   · linking happens per-user (first Supabase-auth sign-in with a
--     verified identity + proof of the existing Scholario password, or
--     provisioning-time cutover on natural password change) — never a
--     bulk credential reset and never a forced logout;
--   · authorization is untouched (withUser / withPlatform / RLS remain
--     the only authorities).
--
-- Both planes get the same pointer columns on their OWN credential
-- tables, preserving the Phase-6 invariant that the school identity
-- plane (User) and the platform identity plane (PlatformAdmin) never
-- share a credential store. authUserId values are unique per table, so
-- one provider identity can never map to two accounts on a plane.
-- Rollback: DROP COLUMN (no data loss beyond the pointer itself).

ALTER TABLE "User" ADD COLUMN "authUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "authLinkedAt" TIMESTAMP;
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

ALTER TABLE "PlatformAdmin" ADD COLUMN "authUserId" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN "authLinkedAt" TIMESTAMP;
CREATE UNIQUE INDEX "PlatformAdmin_authUserId_key" ON "PlatformAdmin"("authUserId");
