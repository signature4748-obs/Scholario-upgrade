/*
 * CREDENTIAL NEUTRALIZATION — CRITICAL audit fix (production default
 * school credentials).
 *
 * 1. Tracking columns on "User":
 *    · mustChangePassword — true while the account has not yet
 *      established its own password. Login still succeeds (the
 *      authentication architecture is unchanged); withUser rejects
 *      business APIs with PASSWORD_CHANGE_REQUIRED until
 *      /api/auth/change-password completes, so a bootstrap/temp
 *      credential can never be used to run a tenant.
 *    · passwordChangedAt — when the user last set their own password
 *      (null = never). The migration uses it as the honest signal for
 *      "this account still runs on whatever password it was created
 *      with" (seeded/provisioned).
 *
 * 2. Data step — every SCHOOL-PLANE account that has never set its own
 *    password is flagged mustChangePassword = true. On production this
 *    covers every account planted by the seed corpus (the documented
 *    default-credential families); on fresh dev/CI databases the
 *    migration runs BEFORE the seeds, so the canonical test corpus is
 *    unaffected. Platform identities live in PlatformAdmin (a different
 *    table) and are excluded by the schoolId predicate.
 *
 * The migration deliberately does NOT rewrite passwordHash values:
 * neutralizing the two known production principal credentials happens
 * through the application's own audited change-password API (login with
 * the seed credential once, rotate to an owner-held secret), and the
 * platform reset-credentials endpoint provides the Super-Admin recovery
 * path. No ad-hoc production schema/data surgery beyond this
 * version-controlled migration.
 */
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

UPDATE "User"
   SET "mustChangePassword" = true
 WHERE "passwordChangedAt" IS NULL
   AND "schoolId" IS NOT NULL
   AND "role" <> 'SUPER_ADMIN';
