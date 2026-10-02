/*
 * FINAL-ACCEPTANCE Phase 10 — ACCOUNT-level subscription lock.
 *
 * Adds User.subscriptionStatus ('ACTIVE' | 'LOCKED', default 'ACTIVE'):
 *
 *   ACTIVE → full access (the default; existing rows backfill to ACTIVE).
 *   LOCKED → the account still authenticates (login, session, /api/auth/me
 *            identity surfaces) but every protected school-module API
 *            rejects it server-side with 403 SUBSCRIPTION_REQUIRED —
 *            enforced in withUser, never by hiding UI buttons.
 *
 * This is deliberately DISTINCT from the existing tenant-lifecycle gate
 * (School.status + evaluateSchoolAccess): a LOCKED account on an ACTIVE
 * tenant keeps its session and identity surfaces; a suspended TENANT
 * blocks every school role at login. Two independent axes:
 *
 *   School.status  — "may this TENANT use the product?"  (platform-owned)
 *   User.subscriptionStatus — "may this ACCOUNT use the modules?" (per-seat)
 *
 * No RLS changes: the User table already carries the deny-by-default
 * census (migration 00000000000002_pg_rls_search) and a new column does
 * not alter that posture; the Prisma application role is the only writer
 * and every API read is session-scoped server-side.
 */
ALTER TABLE "User" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
